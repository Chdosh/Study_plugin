import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { KnowledgeItem, KnowledgeItemSourceType, KnowledgeItemStatus, LearnerFact, LearnerFactScope, LearnerFactSource } from '../../../shared/types';
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
        await this.db
          .update(knowledgeItems)
          .set({
            key: canonicalKey,
            occurrenceCount: existing.occurrenceCount + 1,
            lastSeenAt: now,
            updatedAt: now,
            status: 'active'
          })
          .where(eq(knowledgeItems.id, existing.id));
        result.push({
          ...mapKnowledgeItem(existing),
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          updatedAt: now,
          status: 'active'
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
        result.push({ id, goalId: params.goalId, key: canonicalKey, summary: item.summary, detail: item.detail ?? null, sourceType: item.sourceType, sourceId: item.sourceId ?? null, occurrenceCount: 1, lastSeenAt: now, status: 'active', createdAt: now, updatedAt: now });
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
      .orderBy(desc(knowledgeItems.occurrenceCount))
      .limit(params.limit ?? 20);
    return rows.map(mapKnowledgeItem);
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
    return rows.map(mapKnowledgeItem);
  }

async getKnowledgeContextForGoal(goalId: string): Promise<{ knowledgeItems: KnowledgeItem[]; reviewKnowledgeItems: KnowledgeItem[] }> {
    const [knowledgeItems, reviewKnowledgeItems] = await Promise.all([
      this.getKnowledgeItemsForGoal({ goalId, status: 'active', limit: 3 }),
      this.getReviewWorthyKnowledgeItems(goalId)
    ]);
    return { knowledgeItems, reviewKnowledgeItems };
  }

private extractTechnicalTokens(value: string): string[] {
    const normalized = value.normalize('NFKC').toLowerCase();
    return [...new Set(normalized.match(/[a-z][a-z0-9.+#_-]*/gu) ?? [])];
  }

async resolveKnowledgeItems(goalId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const now = nowIso();
    const activeItems = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(
        eq(knowledgeItems.goalId, goalId),
        eq(knowledgeItems.status, 'active')
      ));
    for (const item of activeItems) {
      const matches = keys.some((k) => {
        const candidateTokens = this.extractTechnicalTokens(k);
        const itemTokens = this.extractTechnicalTokens(item.key || item.summary);
        if (candidateTokens.length > 0 && itemTokens.length > 0) {
          return candidateTokens.some((ct) => itemTokens.some((it) => ct.includes(it) || it.includes(ct)));
        }
        const lowerK = k.toLowerCase();
        const lowerItem = (item.key || item.summary).toLowerCase();
        return lowerItem.includes(lowerK) || lowerK.includes(lowerItem);
      });
      if (matches) {
        await this.db
          .update(knowledgeItems)
          .set({ status: 'resolved', updatedAt: now })
          .where(eq(knowledgeItems.id, item.id));
      }
    }
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
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
