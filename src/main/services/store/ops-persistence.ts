import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PromptProfile, ReviewResult } from '../../../shared/types';
import type { ReviewAgentOutput } from '../../../shared/schemas';
import type {
  CreatePendingInteractionInput,
  PendingAgentInteraction,
  SaveAiReviewInput,
  UpdateAiReviewInput
} from '../../agent/agent-types';
import type { Database } from '../../db/client';
import { defaultPromptProfiles } from '../../db/default-prompts';
import {
  aiReviews,
  appSettings,
  pendingInteractions,
  promptProfiles,
  promptVersions
} from '../../db/schema';
import { createId, nowIso } from '../id';

export interface AiProviderDiagnostic {
  status: 'completed' | 'failed';
  model: string;
  errorCategory: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class OpsPersistence {
  private readonly generationLocks = new Set<string>();

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

  async getLatestAiProviderDiagnostic(params: {
    goalId?: string;
    kinds?: string[];
  } = {}): Promise<AiProviderDiagnostic | null> {
    const conditions = [
      ne(aiReviews.provider, 'local'),
      eq(aiReviews.recordType, 'run'),
      inArray(aiReviews.status, ['completed', 'failed'])
    ];
    if (params.goalId) conditions.push(eq(aiReviews.goalId, params.goalId));
    if (params.kinds?.length) conditions.push(inArray(aiReviews.kind, params.kinds));
    const row = (await this.db.select({
      status: aiReviews.status,
      model: aiReviews.model,
      errorCategory: aiReviews.errorCategory,
      errorMessage: aiReviews.errorMessage,
      createdAt: aiReviews.createdAt,
      completedAt: aiReviews.completedAt
    }).from(aiReviews)
      .where(and(...conditions))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1))[0];
    if (!row || (row.status !== 'completed' && row.status !== 'failed')) return null;
    return {
      ...row,
      status: row.status
    };
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
        kind: sql<string>`COALESCE(${aiReviews.toolName}, ${aiReviews.kind})`,
        date: aiReviews.date,
        inputTokens: sql<number>`COALESCE(SUM(${aiReviews.inputTokens}), 0)`,
        outputTokens: sql<number>`COALESCE(SUM(${aiReviews.outputTokens}), 0)`,
        calls: sql<number>`COUNT(*)`
      })
      .from(aiReviews)
      .where(and(...conditions))
      .groupBy(sql`COALESCE(${aiReviews.toolName}, ${aiReviews.kind})`, aiReviews.date);

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
    void ttlMs;
    if (this.generationLocks.has(lockKey)) return false;
    this.generationLocks.add(lockKey);
    return true;
  }

  async releaseGenerationLock(lockKey: string): Promise<void> {
    this.generationLocks.delete(lockKey);
  }

  private async listPromptProfiles(): Promise<PromptProfile[]> {
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

  async saveAiReview(params: SaveAiReviewInput): Promise<string> {
    const id = createId('ai_review');
    const metrics = params.metrics;
    await this.db.insert(aiReviews).values({
      id,
      kind: params.kind as typeof aiReviews.$inferInsert.kind,
      date: params.date,
      provider: params.provider,
      model: params.model,
      promptProfileId: params.promptProfileId,
      promptVersionId: params.promptVersionId,
      inputSnapshotJson: JSON.stringify(params.inputSnapshot),
      outputJson: JSON.stringify(params.output),
      outputSchemaVersion: params.outputSchemaVersion,
      status: params.status as typeof aiReviews.$inferInsert.status,
      errorMessage: params.errorMessage,
      inputTokens: metrics?.inputTokens ?? null,
      outputTokens: metrics?.outputTokens ?? null,
      latencyMs: metrics?.latencyMs ?? null,
      errorCategory: metrics?.errorCategory ?? null,
      traceId: metrics?.traceId ?? null,
      recordType: params.recordType ?? 'legacy_call',
      parentReviewId: params.parentReviewId,
      toolName: params.toolName,
      toolSequence: params.toolSequence,
      idempotencyKey: params.idempotencyKey,
      goalId: params.goalId,
      conversationScope: params.conversationScope,
      conversationRefId: params.conversationRefId,
      messageRefId: params.messageRefId,
      contextVersion: params.contextVersion,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      createdAt: nowIso()
    });
    return id;
  }

  async updateAiReview(id: string, patch: UpdateAiReviewInput): Promise<void> {
    const values: Partial<typeof aiReviews.$inferInsert> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if ('output' in patch) values.outputJson = JSON.stringify(patch.output ?? {});
    if ('errorMessage' in patch) values.errorMessage = patch.errorMessage;
    if ('completedAt' in patch) values.completedAt = patch.completedAt;
    if (patch.metrics) {
      values.inputTokens = patch.metrics.inputTokens;
      values.outputTokens = patch.metrics.outputTokens;
      values.latencyMs = patch.metrics.latencyMs;
      values.errorCategory = patch.metrics.errorCategory ?? null;
      values.traceId = patch.metrics.traceId;
    }
    if (Object.keys(values).length === 0) return;
    await this.db.update(aiReviews).set(values).where(eq(aiReviews.id, id));
  }

  async getAgentRunState(id: string): Promise<{
    id: string;
    status: 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';
    output: unknown;
  } | null> {
    const rows = await this.db
      .select({
        id: aiReviews.id,
        status: aiReviews.status,
        outputJson: aiReviews.outputJson
      })
      .from(aiReviews)
      .where(and(eq(aiReviews.id, id), eq(aiReviews.recordType, 'run')))
      .limit(1);
    const row = rows[0];
    if (!row || !['running', 'waiting_user', 'completed', 'failed', 'cancelled'].includes(row.status)) {
      return null;
    }
    return {
      id: row.id,
      status: row.status as 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled',
      output: JSON.parse(row.outputJson)
    };
  }

  async getActiveAgentRun(
    scopeType: string,
    scopeId: string
  ): Promise<{ id: string; status: 'running' | 'waiting_user' } | null> {
    const rows = await this.db
      .select({ id: aiReviews.id, status: aiReviews.status })
      .from(aiReviews)
      .where(and(
        eq(aiReviews.recordType, 'run'),
        eq(aiReviews.conversationScope, scopeType),
        eq(aiReviews.conversationRefId, scopeId),
        inArray(aiReviews.status, ['running', 'waiting_user'])
      ))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row || (row.status !== 'running' && row.status !== 'waiting_user')) return null;
    return { id: row.id, status: row.status };
  }

  async getNextAgentToolSequence(runReviewId: string): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`COALESCE(MAX(${aiReviews.toolSequence}), 0)` })
      .from(aiReviews)
      .where(eq(aiReviews.parentReviewId, runReviewId));
    return Number(rows[0]?.value ?? 0) + 1;
  }

  async createPendingInteraction(
    params: CreatePendingInteractionInput
  ): Promise<PendingAgentInteraction> {
    const id = createId('pending_interaction');
    const createdAt = nowIso();
    await this.db.insert(pendingInteractions).values({
      id,
      runReviewId: params.runReviewId,
      toolReviewId: params.toolReviewId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      question: params.request.question,
      reason: params.request.reason,
      answerMode: params.request.answerMode,
      optionsJson: JSON.stringify(params.request.options ?? []),
      canSkip: params.request.canSkip,
      intent: params.request.intent,
      expectedContextVersion: params.expectedContextVersion,
      status: 'open',
      createdAt
    });
    return {
      id,
      runReviewId: params.runReviewId,
      toolReviewId: params.toolReviewId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      question: params.request.question,
      reason: params.request.reason,
      answerMode: params.request.answerMode,
      options: params.request.options ?? [],
      canSkip: params.request.canSkip,
      intent: params.request.intent,
      expectedContextVersion: params.expectedContextVersion,
      status: 'open',
      answerText: null,
      answerMessageRefId: null,
      createdAt,
      resolvedAt: null
    };
  }

  async getPendingInteraction(id: string): Promise<PendingAgentInteraction | null> {
    const rows = await this.db
      .select()
      .from(pendingInteractions)
      .where(eq(pendingInteractions.id, id))
      .limit(1);
    return rows[0] ? mapPendingInteraction(rows[0]) : null;
  }

  async getOpenPendingInteraction(
    scopeType: string,
    scopeId: string
  ): Promise<PendingAgentInteraction | null> {
    const rows = await this.db
      .select()
      .from(pendingInteractions)
      .where(and(
        eq(pendingInteractions.scopeType, scopeType),
        eq(pendingInteractions.scopeId, scopeId),
        eq(pendingInteractions.status, 'open')
      ))
      .orderBy(desc(pendingInteractions.createdAt))
      .limit(1);
    return rows[0] ? mapPendingInteraction(rows[0]) : null;
  }

  async answerPendingInteraction(
    id: string,
    answer: string,
    answerMessageRefId?: string
  ): Promise<boolean> {
    const rows = await this.db
      .update(pendingInteractions)
      .set({
        status: 'answered',
        answerText: answer,
        answerMessageRefId,
        resolvedAt: nowIso()
      })
      .where(and(
        eq(pendingInteractions.id, id),
        eq(pendingInteractions.status, 'open')
      ))
      .returning({ id: pendingInteractions.id });
    return rows.length === 1;
  }

  async cancelPendingInteraction(id: string): Promise<boolean> {
    const rows = await this.db
      .update(pendingInteractions)
      .set({ status: 'cancelled', resolvedAt: nowIso() })
      .where(and(
        eq(pendingInteractions.id, id),
        eq(pendingInteractions.status, 'open')
      ))
      .returning({ id: pendingInteractions.id });
    return rows.length === 1;
  }

  async skipPendingInteraction(id: string, answerMessageRefId?: string): Promise<boolean> {
    const rows = await this.db
      .update(pendingInteractions)
      .set({
        status: 'skipped',
        answerMessageRefId,
        resolvedAt: nowIso()
      })
      .where(and(
        eq(pendingInteractions.id, id),
        eq(pendingInteractions.status, 'open')
      ))
      .returning({ id: pendingInteractions.id });
    return rows.length === 1;
  }

  async failInterruptedAgentRuns(): Promise<number> {
    const rows = await this.db
      .update(aiReviews)
      .set({
        status: 'failed',
        errorMessage: '应用在 AI 操作完成前中断，可由用户重试。',
        completedAt: nowIso()
      })
      .where(and(
        inArray(aiReviews.recordType, ['run', 'tool_call']),
        eq(aiReviews.status, 'running')
      ))
      .returning({ id: aiReviews.id });
    return rows.length;
  }

  async getLatestReview(date?: string): Promise<ReviewResult | null> {
    const filters = date
      ? and(
          eq(aiReviews.kind, 'reflection'),
          inArray(aiReviews.status, ['success', 'completed']),
          eq(aiReviews.date, date)
        )
      : and(eq(aiReviews.kind, 'reflection'), inArray(aiReviews.status, ['success', 'completed']));
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

function mapPendingInteraction(
  row: typeof pendingInteractions.$inferSelect
): PendingAgentInteraction {
  return {
    id: row.id,
    runReviewId: row.runReviewId,
    toolReviewId: row.toolReviewId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    question: row.question,
    reason: row.reason,
    answerMode: row.answerMode,
    options: JSON.parse(row.optionsJson) as string[],
    canSkip: row.canSkip,
    intent: row.intent,
    expectedContextVersion: row.expectedContextVersion,
    status: row.status,
    answerText: row.answerText,
    answerMessageRefId: row.answerMessageRefId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}
