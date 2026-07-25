import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { KnowledgeItem, KnowledgeItemSourceType, KnowledgeItemStatus, LearnerFact, LearnerFactScope, LearnerFactSource, QualitativeMasteryState } from '../../../shared/types';
import type { Database } from '../../db/client';
import { knowledgeItemEvidence, knowledgeItems, learnerFacts } from '../../db/schema';
import { createId, nowIso } from '../id';

export class KnowledgeStore {
  constructor(public readonly db: Database) {}

async recordKnowledgeItems(params: {
    goalId: string;
    items: Array<{
      key: string;
      summary: string;
      detail?: string;
      sourceType: KnowledgeItemSourceType;
      sourceId?: string;
      evidence?: {
        submissionId?: string;
        evaluationId?: string;
        taskId?: string;
      };
    }>;
  }): Promise<KnowledgeItem[]> {
    if (params.items.length === 0) return [];
    const now = nowIso();
    const result: KnowledgeItem[] = [];
    for (const item of params.items) {
      const canonicalKey = normalizeKnowledgeKey(item.key || item.summary);
      const existingRows = await this.db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.goalId, params.goalId));
      const existing = existingRows.find((row) =>
        normalizeKnowledgeKey(row.key) === canonicalKey ||
        normalizeKnowledgeKey(row.summary) === canonicalKey
      );
      let knowledgeItemId: string;
      if (existing) {
        knowledgeItemId = existing.id;
        if (item.sourceId) {
          const recorded = await this.db
            .select({ id: knowledgeItemEvidence.id })
            .from(knowledgeItemEvidence)
            .where(and(
              eq(knowledgeItemEvidence.knowledgeItemId, existing.id),
              eq(knowledgeItemEvidence.sourceId, item.sourceId)
            ))
            .limit(1);
          if (recorded[0]) {
            result.push(mapKnowledgeItem(existing));
            continue;
          }
        }
        await this.db
          .update(knowledgeItems)
          .set({
            key: canonicalKey,
            occurrenceCount: existing.occurrenceCount + 1,
            lastSeenAt: now,
            updatedAt: now
          })
          .where(eq(knowledgeItems.id, existing.id));
        result.push({
          ...mapKnowledgeItem(existing),
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          updatedAt: now,
          status: existing.status
        });
      } else {
        const id = createId('knowledge_item');
        knowledgeItemId = id;
        await this.db.insert(knowledgeItems).values({
          id,
          goalId: params.goalId,
          key: canonicalKey,
          summary: item.summary,
          detail: item.detail ?? null,
          sourceType: item.sourceType,
          sourceId: item.sourceId ?? null,
          occurrenceCount: 1,
          lastSeenAt: now,
          status: 'active',
          createdAt: now,
          updatedAt: now
        });
        result.push(mapKnowledgeItem({
          id,
          goalId: params.goalId,
          key: canonicalKey,
          summary: item.summary,
          detail: item.detail ?? null,
          sourceType: item.sourceType,
          sourceId: item.sourceId ?? null,
          occurrenceCount: 1,
          lastSeenAt: now,
          status: 'active',
          createdAt: now,
          updatedAt: now
        }));
      }

      if (item.sourceId || item.evidence) {
        await this.db.insert(knowledgeItemEvidence).values({
          id: createId('knowledge_evidence'),
          knowledgeItemId,
          sourceType: item.sourceType,
          sourceId: item.sourceId ?? null,
          submissionId: item.evidence?.submissionId ?? null,
          evaluationId: item.evidence?.evaluationId ?? null,
          taskId: item.evidence?.taskId ?? null,
          createdAt: now
        }).onConflictDoNothing();
      }
    }
    return result;
  }

async getKnowledgeItemsForGoal(params: {
    goalId: string;
    status?: KnowledgeItemStatus;
    goalKey?: string;
    limit?: number;
  }): Promise<KnowledgeItem[]> {
    const conditions = [eq(knowledgeItems.goalId, params.goalId)];
    if (params.status) conditions.push(eq(knowledgeItems.status, params.status));
    if (params.goalKey) conditions.push(sql`${knowledgeItems.key} LIKE ${'%' + params.goalKey + '%'}`);
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(...conditions))
      .orderBy(
        desc(sql`CASE WHEN ${knowledgeItems.sourceType} = 'correction' THEN 1 ELSE 0 END`),
        desc(knowledgeItems.occurrenceCount),
        desc(knowledgeItems.lastSeenAt)
      )
      .limit(params.limit ?? 20);
    return enrichKnowledgeRows(this.db, rows);
  }

async getReviewWorthyKnowledgeItems(goalId: string, minOccurrences = 2): Promise<KnowledgeItem[]> {
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(
        eq(knowledgeItems.goalId, goalId),
        eq(knowledgeItems.status, 'active'),
        sql`${knowledgeItems.occurrenceCount} >= ${minOccurrences}`
      ))
      .orderBy(desc(knowledgeItems.occurrenceCount))
      .limit(5);
    return enrichKnowledgeRows(this.db, rows);
  }

  async getKnowledgeContextForGoal(goalId: string): Promise<{ knowledgeItems: KnowledgeItem[]; reviewKnowledgeItems: KnowledgeItem[] }> {
    const [knowledgeItems, reviewKnowledgeItems] = await Promise.all([
      this.getKnowledgeItemsForGoal({ goalId, status: 'active', limit: 3 }),
      this.getReviewWorthyKnowledgeItems(goalId)
    ]);
    return { knowledgeItems, reviewKnowledgeItems };
  }

  async setKnowledgeItemStatus(
    itemId: string,
    status: KnowledgeItemStatus
  ): Promise<KnowledgeItem> {
    const rows = await this.db
      .update(knowledgeItems)
      .set({ status, updatedAt: nowIso() })
      .where(eq(knowledgeItems.id, itemId))
      .returning();
    if (!rows[0]) throw new Error('找不到需要更新的知识判断。');
    return (await enrichKnowledgeRows(this.db, [rows[0]]))[0];
  }

async proposeFact(goalId: string, fact: { scope: LearnerFactScope; taskId?: string; key: string; value: string; source: LearnerFactSource; confidence?: number }): Promise<LearnerFact> {
    if (fact.scope === 'task' && !fact.taskId) {
      throw new Error('任务级学习事实必须绑定具体主任务。');
    }
    const factGoalId = fact.scope === 'global' ? null : goalId;
    const taskId = fact.scope === 'task' ? fact.taskId! : null;
    const now = nowIso();
    const existingRows = await this.db
      .select()
      .from(learnerFacts)
      .where(and(
        factGoalId ? eq(learnerFacts.goalId, factGoalId) : isNull(learnerFacts.goalId),
        eq(learnerFacts.scope, fact.scope),
        eq(learnerFacts.key, fact.key),
        taskId ? eq(learnerFacts.taskId, taskId) : isNull(learnerFacts.taskId)
      ))
      .limit(1);
    const existing = existingRows[0];
    if (existing) {
      // 已确认事实只能被另一个显式确认值覆盖。AI 推断和待确认的用户陈述
      // 不得静默降级或改写已经影响后续学习行为的稳定事实。
      if (existing.source === 'confirmed' && fact.source !== 'confirmed') {
        return {
          id: existing.id,
          goalId: existing.goalId,
          taskId: existing.taskId,
          scope: existing.scope as LearnerFactScope,
          key: existing.key,
          value: existing.value,
          source: existing.source as LearnerFactSource,
          confidence: existing.confidence,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        };
      }
      await this.db
        .update(learnerFacts)
        .set({
          value: fact.value,
          source: fact.source,
          confidence: fact.confidence ?? existing.confidence,
          updatedAt: now
        })
        .where(eq(learnerFacts.id, existing.id));
      return {
        id: existing.id,
        goalId: existing.goalId,
        taskId: existing.taskId,
        scope: existing.scope as LearnerFactScope,
        key: existing.key,
        value: fact.value,
        source: fact.source,
        confidence: fact.confidence ?? existing.confidence,
        createdAt: existing.createdAt,
        updatedAt: now
      };
    }
    const id = createId('learner_fact');
    await this.db.insert(learnerFacts).values({
      id,
      goalId: factGoalId,
      taskId,
      scope: fact.scope,
      key: fact.key,
      value: fact.value,
      source: fact.source,
      confidence: fact.confidence ?? 0.8,
      createdAt: now,
      updatedAt: now
    });
    return {
      id,
      goalId: factGoalId,
      taskId,
      scope: fact.scope,
      key: fact.key,
      value: fact.value,
      source: fact.source,
      confidence: fact.confidence ?? 0.8,
      createdAt: now,
      updatedAt: now
    };
  }

async getFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string): Promise<LearnerFact | null> {
    const goalCondition = scope === 'global' ? isNull(learnerFacts.goalId) : eq(learnerFacts.goalId, goalId);
    const rows = await this.db
      .select()
      .from(learnerFacts)
      .where(and(
        goalCondition,
        eq(learnerFacts.key, key),
        eq(learnerFacts.scope, scope),
        scope === 'task' && taskId ? eq(learnerFacts.taskId, taskId) : isNull(learnerFacts.taskId)
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      goalId: row.goalId,
      taskId: row.taskId,
      scope: row.scope as LearnerFactScope,
      key: row.key,
      value: row.value,
      source: row.source as LearnerFactSource,
      confidence: row.confidence,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

async listFactsForGoal(goalId: string, scope?: LearnerFactScope): Promise<LearnerFact[]> {
    const conditions = [or(eq(learnerFacts.goalId, goalId), and(isNull(learnerFacts.goalId), eq(learnerFacts.scope, 'global')))];
    if (scope) conditions.push(eq(learnerFacts.scope, scope));
    const rows = await this.db
      .select()
      .from(learnerFacts)
      .where(and(...conditions))
      .orderBy(asc(learnerFacts.scope), asc(learnerFacts.key));
    return rows.map((row) => ({
      id: row.id,
      goalId: row.goalId,
      taskId: row.taskId,
      scope: row.scope as LearnerFactScope,
      key: row.key,
      value: row.value,
      source: row.source as LearnerFactSource,
      confidence: row.confidence,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

async deleteFact(goalId: string, key: string, scope: LearnerFactScope, taskId?: string): Promise<void> {
    const goalCondition = scope === 'global' ? isNull(learnerFacts.goalId) : eq(learnerFacts.goalId, goalId);
    await this.db
      .delete(learnerFacts)
      .where(and(
        goalCondition,
        eq(learnerFacts.key, key),
        eq(learnerFacts.scope, scope),
        scope === 'task' && taskId ? eq(learnerFacts.taskId, taskId) : isNull(learnerFacts.taskId)
      ));
  }
}

function mapKnowledgeItem(row: typeof knowledgeItems.$inferSelect): KnowledgeItem {
  const baseState: QualitativeMasteryState =
    row.sourceType === 'insight' || row.sourceType === 'correction'
      ? 'initial_understanding'
      : 'needs_reinforcement';
  return {
    id: row.id,
    goalId: row.goalId,
    key: row.key,
    summary: row.summary,
    detail: row.detail,
    sourceType: row.sourceType as KnowledgeItemSourceType,
    sourceId: row.sourceId,
    occurrenceCount: row.occurrenceCount,
    lastSeenAt: row.lastSeenAt,
    status: (row.status ?? 'active') as KnowledgeItemStatus,
    masteryState: baseState,
    masteryLabel: masteryLabel(baseState),
    masteryReason: baseState === 'needs_reinforcement'
      ? '现有证据包含需要继续验证的误区或缺口。'
      : '已有一次正确表现或用户纠正，仍需更多独立证据。',
    evidenceCount: row.occurrenceCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function enrichKnowledgeRows(
  db: Database,
  rows: Array<typeof knowledgeItems.$inferSelect>
): Promise<KnowledgeItem[]> {
  if (rows.length === 0) return [];
  const evidenceRows = await db.select().from(knowledgeItemEvidence)
    .where(inArray(knowledgeItemEvidence.knowledgeItemId, rows.map((row) => row.id)));
  return rows.map((row) => {
    const base = mapKnowledgeItem(row);
    const evidence = evidenceRows.filter((item) => item.knowledgeItemId === row.id);
    const positive = evidence.filter((item) => item.sourceType === 'insight');
    const weaknesses = evidence.filter((item) => item.sourceType === 'weakness');
    const misconceptions = evidence.filter((item) => item.sourceType === 'misconception');
    const corrections = evidence.filter((item) => item.sourceType === 'correction');
    const distinctPositiveTasks = new Set(positive.map((item) => item.taskId).filter(Boolean));
    const independentOutput = positive.some((item) => Boolean(item.submissionId));
    const positiveTimes = positive.map((item) => Date.parse(item.createdAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const timeSeparated = positiveTimes.length >= 2
      && positiveTimes[positiveTimes.length - 1] - positiveTimes[0] >= 24 * 60 * 60 * 1000;

    let masteryState: QualitativeMasteryState;
    let masteryReason: string;
    if (row.status === 'resolved') {
      masteryState = positive.length > 0 ? 'can_apply' : 'initial_understanding';
      masteryReason = '用户已明确纠正该判断或标记为已掌握；原始证据仍保留。';
    } else if (timeSeparated && positive.length >= 2) {
      masteryState = 'stable';
      masteryReason = '存在时间分隔的多次有效正确证据。';
    } else if (independentOutput || distinctPositiveTasks.size >= 2) {
      masteryState = 'can_apply';
      masteryReason = independentOutput
        ? '存在独立成果中的正确表现。'
        : '在不同 Task 情境中出现了正确表现。';
    } else if (positive.length > 0 || corrections.length > 0) {
      masteryState = 'initial_understanding';
      masteryReason = corrections.length > 0
        ? '用户纠正优先于冲突的 AI 判断，仍等待后续表现验证。'
        : '已出现正确表现，但有效证据还不足。';
    } else if (
      weaknesses.length > 0
      || misconceptions.length >= 2
      || row.sourceType === 'weakness'
      || row.occurrenceCount >= 2
    ) {
      masteryState = 'needs_reinforcement';
      masteryReason = weaknesses.length > 0 || row.sourceType === 'weakness'
        ? '仍有未满足要求，需要继续巩固。'
        : '同一误区重复出现，需要再次教学和检查。';
    } else {
      masteryState = 'needs_reinforcement';
      masteryReason = '已有误区证据，尚无足够的正确表现。';
    }
    return {
      ...base,
      masteryState,
      masteryLabel: masteryLabel(masteryState),
      masteryReason,
      evidenceCount: Math.max(evidence.length, row.occurrenceCount)
    };
  });
}

function masteryLabel(
  state: QualitativeMasteryState
): KnowledgeItem['masteryLabel'] {
  switch (state) {
    case 'needs_reinforcement':
      return '需要巩固';
    case 'initial_understanding':
      return '初步理解';
    case 'can_apply':
      return '能够应用';
    case 'stable':
      return '较稳定';
  }
}

function normalizeKnowledgeKey(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase();
  const technicalTokens = [...new Set(normalized.match(/[a-z][a-z0-9.+#_-]*/gu) ?? [])];
  if (technicalTokens.length > 0) {
    return technicalTokens.slice(0, 3).join(':').slice(0, 50);
  }

  const withoutDiagnosisWords = normalized
    .replace(/仍有|存在|概念|理解|混淆|错误|薄弱|缺失|不足|未能|没有|需要|掌握|不清楚|对于|关于|的|对/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return (withoutDiagnosisWords || normalized.replace(/\s+/gu, '')).slice(0, 50);
}
