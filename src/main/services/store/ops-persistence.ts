import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import type { PromptProfile, ReviewResult } from '../../../shared/types';
import type { ReviewAgentOutput } from '../../../shared/schemas';
import type { AiCallMetrics } from '../../ai/ai-client';
import type { Database } from '../../db/client';
import { defaultPromptProfiles } from '../../db/default-prompts';
import {
  aiReviews,
  appSettings,
  generationLocks,
  promptProfiles,
  promptVersions
} from '../../db/schema';
import { createId, nowIso } from '../id';

export class OpsPersistence {
  constructor(private readonly db: Database) {}

  async seedDefaults(): Promise<void> {
    const now = nowIso();
    for (const prompt of defaultPromptProfiles) {
      const existing = await this.db
        .select()
        .from(promptProfiles)
        .where(eq(promptProfiles.key, prompt.key))
        .limit(1);
      if (existing.length > 0) {
        const profile = existing[0];
        await this.db
          .update(promptProfiles)
          .set({
            name: prompt.name,
            description: prompt.description,
            updatedAt: now
          })
          .where(eq(promptProfiles.id, profile.id));

        const latestVersions = await this.db
          .select()
          .from(promptVersions)
          .where(eq(promptVersions.profileId, profile.id))
          .orderBy(desc(promptVersions.version))
          .limit(1);
        const latest = latestVersions[0];
        if (!latest || latest.content.startsWith('Act as ')) {
          const versionId = createId('prompt_version');
          await this.db.insert(promptVersions).values({
            id: versionId,
            profileId: profile.id,
            version: (latest?.version ?? 0) + 1,
            content: prompt.content,
            createdAt: now
          });
          await this.db
            .update(promptProfiles)
            .set({ activeVersionId: versionId, updatedAt: now })
            .where(eq(promptProfiles.id, profile.id));
        }
        continue;
      }

      const profileId = createId('prompt_profile');
      const versionId = createId('prompt_version');
      await this.db.insert(promptProfiles).values({
        id: profileId,
        key: prompt.key,
        name: prompt.name,
        description: prompt.description,
        activeVersionId: versionId,
        createdAt: now,
        updatedAt: now
      });
      await this.db.insert(promptVersions).values({
        id: versionId,
        profileId,
        version: 1,
        content: prompt.content,
        createdAt: now
      });
    }

    await this.putSettingIfMissing('deepseekBaseUrl', 'https://api.deepseek.com');
    await this.putSettingIfMissing('deepseekModel', 'deepseek-chat');
    await this.putSettingIfMissing('autoLaunch', 'false');
    await this.putSettingIfMissing('defaultBlockMinutes', '10');
    await this.putSettingIfMissing(
      'dailyStudyWindows',
      JSON.stringify([
        {
          start: '20:00',
          end: '22:00'
        }
      ])
    );
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async putSetting(key: string, value: string): Promise<void> {
    const now = nowIso();
    await this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: now }
      });
  }

  async getTokenCostStats(opts: { fromDate?: string; toDate?: string }): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCalls: number;
    byOperation: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    byDate: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  }> {
    const conditions = [sql`${aiReviews.inputTokens} IS NOT NULL`];
    if (opts.fromDate) {
      conditions.push(sql`${aiReviews.date} >= ${opts.fromDate}`);
    }
    if (opts.toDate) {
      conditions.push(sql`${aiReviews.date} <= ${opts.toDate}`);
    }
    const rows = await this.db
      .select({
        kind: aiReviews.kind,
        date: aiReviews.date,
        inputTokens: sql<number>`COALESCE(SUM(${aiReviews.inputTokens}), 0)`,
        outputTokens: sql<number>`COALESCE(SUM(${aiReviews.outputTokens}), 0)`,
        calls: sql<number>`COUNT(*)`
      })
      .from(aiReviews)
      .where(and(...conditions))
      .groupBy(aiReviews.kind, aiReviews.date);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCalls = 0;
    const byOperation: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};
    const byDate: Record<string, { inputTokens: number; outputTokens: number; calls: number }> = {};

    for (const row of rows) {
      totalInputTokens += row.inputTokens;
      totalOutputTokens += row.outputTokens;
      totalCalls += row.calls;

      const kind = row.kind ?? 'unknown';
      if (!byOperation[kind]) {
        byOperation[kind] = { inputTokens: 0, outputTokens: 0, calls: 0 };
      }
      byOperation[kind].inputTokens += row.inputTokens;
      byOperation[kind].outputTokens += row.outputTokens;
      byOperation[kind].calls += row.calls;

      const date = row.date ?? 'unknown';
      if (!byDate[date]) {
        byDate[date] = { inputTokens: 0, outputTokens: 0, calls: 0 };
      }
      byDate[date].inputTokens += row.inputTokens;
      byDate[date].outputTokens += row.outputTokens;
      byDate[date].calls += row.calls;
    }

    return { totalInputTokens, totalOutputTokens, totalCalls, byOperation, byDate };
  }

  async acquireGenerationLock(lockKey: string, ttlMs: number = 120_000): Promise<boolean> {
    const now = Date.now();
    const staleThreshold = new Date(now - ttlMs).toISOString();
    await this.db
      .delete(generationLocks)
      .where(lt(generationLocks.lockedAt, staleThreshold));
    const existing = await this.db
      .select()
      .from(generationLocks)
      .where(eq(generationLocks.lockKey, lockKey))
      .limit(1);
    if (existing.length > 0) return false;
    try {
      await this.db.insert(generationLocks).values({
        lockKey,
        lockedAt: nowIso()
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseGenerationLock(lockKey: string): Promise<void> {
    await this.db
      .delete(generationLocks)
      .where(eq(generationLocks.lockKey, lockKey));
  }

  async listPromptProfiles(): Promise<PromptProfile[]> {
    const profiles = await this.db.select().from(promptProfiles).orderBy(asc(promptProfiles.name));
    const results: PromptProfile[] = [];
    for (const profile of profiles) {
      const versions = await this.db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.profileId, profile.id))
        .orderBy(desc(promptVersions.version))
        .limit(1);
      const active = versions[0];
      results.push({
        id: profile.id,
        key: profile.key,
        name: profile.name,
        description: profile.description,
        activeVersionId: profile.activeVersionId,
        version: active?.version ?? 0,
        content: active?.content ?? ''
      });
    }
    return results;
  }

  async getPromptProfile(profileId?: string): Promise<PromptProfile> {
    const profiles = await this.listPromptProfiles();
    const selected = profileId
      ? profiles.find((profile) => profile.id === profileId)
      : profiles.find((profile) => profile.key === 'foundation') ?? profiles[0];
    if (!selected) throw new Error('No prompt profiles exist.');
    return selected;
  }

  async updatePrompt(profileId: string, content: string): Promise<PromptProfile> {
    const versions = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.profileId, profileId))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const versionId = createId('prompt_version');
    const now = nowIso();
    await this.db.insert(promptVersions).values({
      id: versionId,
      profileId,
      version: nextVersion,
      content,
      createdAt: now
    });
    await this.db
      .update(promptProfiles)
      .set({ activeVersionId: versionId, updatedAt: now })
      .where(eq(promptProfiles.id, profileId));
    return this.getPromptProfile(profileId);
  }

  async saveAiReview(params: {
    kind:
      | 'import'
      | 'plan'
      | 'goal_intake'
      | 'roadmap'
      | 'short_plan'
      | 'daily_guide'
      | 'stage_outline'
      | 'teach_step'
      | 'question'
      | 'submission_evaluation'
      | 'next_step'
      | 'evaluation'
      | 'replan'
      | 'reflection'
      | 'rolling_plan';
    date?: string;
    provider: string;
    model: string;
    promptProfileId?: string;
    promptVersionId?: string | null;
    inputSnapshot: unknown;
    output: unknown;
    outputSchemaVersion: string;
    status: 'success' | 'failed';
    errorMessage?: string;
    metrics?: AiCallMetrics;
  }): Promise<string> {
    const id = createId('ai_review');
    const metrics = params.metrics;
    await this.db.insert(aiReviews).values({
      id,
      kind: params.kind,
      date: params.date,
      provider: params.provider,
      model: params.model,
      promptProfileId: params.promptProfileId,
      promptVersionId: params.promptVersionId,
      inputSnapshotJson: JSON.stringify(params.inputSnapshot),
      outputJson: JSON.stringify(params.output),
      outputSchemaVersion: params.outputSchemaVersion,
      status: params.status,
      errorMessage: params.errorMessage,
      inputTokens: metrics?.inputTokens ?? null,
      outputTokens: metrics?.outputTokens ?? null,
      latencyMs: metrics?.latencyMs ?? null,
      errorCategory: metrics?.errorCategory ?? null,
      traceId: metrics?.traceId ?? null,
      createdAt: nowIso()
    });
    return id;
  }

  async getLatestReview(date?: string): Promise<ReviewResult | null> {
    const filters = date
      ? and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success'), eq(aiReviews.date, date))
      : and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success'));
    const rows = await this.db
      .select()
      .from(aiReviews)
      .where(filters)
      .orderBy(desc(aiReviews.createdAt));

    for (const row of rows) {
      if (!row.date) continue;
      try {
        const output = JSON.parse(row.outputJson) as ReviewAgentOutput;
        return {
          reviewId: row.id,
          date: row.date,
          completionScore: output.completionScore,
          focusScore: output.focusScore,
          summary: output.summary,
          nextActions: output.nextActions,
          planAdjustments: output.planAdjustments ?? []
        };
      } catch {
        // Ignore malformed historical review payloads and continue to older records.
      }
    }

    return null;
  }

  private async putSettingIfMissing(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing === null) {
      await this.putSetting(key, value);
    }
  }
}
