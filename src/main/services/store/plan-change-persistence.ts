import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type {
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  RoadmapStage,
  NearTermPlanItem
} from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  goals,
  learningEvaluations,
  learningGuides,
  nearTermPlanItems,
  planVersions,
  roadmapStages
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  mapPlanAdjustmentProposal,
  mapRoadmapStage,
  mapNearTermPlanItem
} from './serialization';

export class PlanChangePersistence {
  constructor(private readonly db: Database) {}

  private async applyReviewPlanAdjustments(params: {
    goalId: string;
    adjustments: Array<{
      itemIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>;
  }): Promise<NearTermPlanItem[]> {
    if (params.adjustments.length === 0) return [];
    const activeStage = (await this.db.select({ id: roadmapStages.id }).from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, params.goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position)).limit(1))[0];
    const candidates = await this.db.select().from(nearTermPlanItems).where(and(
      eq(nearTermPlanItems.goalId, params.goalId),
      eq(nearTermPlanItems.status, 'pending'),
      ...(activeStage ? [eq(nearTermPlanItems.roadmapStageId, activeStage.id)] : [])
    )).orderBy(asc(nearTermPlanItems.itemIndex));
    const updated: NearTermPlanItem[] = [];
    await this.db.transaction(async (tx) => {
      for (const adjustment of params.adjustments) {
        const target = candidates.find((item) => item.itemIndex === adjustment.itemIndex);
        if (!target) continue;
        const values = {
          title: adjustment.title,
          focus: adjustment.focus,
          expectedOutput: adjustment.expectedOutput,
          successCriteria: adjustment.successCriteria
        };
        await tx.update(nearTermPlanItems).set(values)
          .where(eq(nearTermPlanItems.id, target.id));
        updated.push(mapNearTermPlanItem({ ...target, ...values }));
      }
      if (updated.length > 0) {
        const version = (await tx.select({ version: planVersions.version }).from(planVersions)
          .where(eq(planVersions.goalId, params.goalId))
          .orderBy(desc(planVersions.version)).limit(1))[0]?.version ?? 0;
        await tx.insert(planVersions).values({
          id: createId('plan_version'),
          goalId: params.goalId,
          version: version + 1,
          changeSummary: params.adjustments.map((item) => item.reason).filter(Boolean).join('；') || '应用复盘调整',
          snapshotJson: JSON.stringify({ shortPlan: updated }),
          createdAt: nowIso()
        });
      }
    });
    return updated;
  }

  async markRoadmapStageReadyForReview(goalId: string): Promise<void> {
    const active = (await this.db.select().from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position)).limit(1))[0];
    if (!active) return;
    const items = await this.db.select().from(nearTermPlanItems)
      .where(and(
        eq(nearTermPlanItems.goalId, goalId),
        eq(nearTermPlanItems.roadmapStageId, active.id)
      ));
    if (items.length === 0 || items.some((item) => !['completed', 'skipped'].includes(item.status))) return;
    const guides = await this.db.select({ status: learningGuides.status }).from(learningGuides)
      .where(inArray(learningGuides.nearTermPlanItemId, items.map((item) => item.id)));
    if (guides.length === 0 || guides.some((guide) => guide.status !== 'closed' && guide.status !== 'archived')) return;
    await this.db.update(roadmapStages).set({
      status: 'ready_for_review',
      updatedAt: nowIso()
    }).where(eq(roadmapStages.id, active.id));
  }

  async confirmRoadmapStageCompletion(goalId: string, stageId: string): Promise<RoadmapStage[]> {
    await this.db.transaction(async (tx) => {
      const stage = (await tx.select().from(roadmapStages).where(and(
        eq(roadmapStages.id, stageId),
        eq(roadmapStages.goalId, goalId)
      )).limit(1))[0];
      if (!stage) throw new Error('找不到需要确认的 Roadmap Stage。');
      if (stage.status === 'completed') return;
      if (stage.status !== 'ready_for_review') throw new Error('当前 Stage 尚未进入待复盘状态。');
      const now = nowIso();
      await tx.update(roadmapStages).set({ status: 'completed', updatedAt: now })
        .where(eq(roadmapStages.id, stageId));
      const next = (await tx.select().from(roadmapStages).where(and(
        eq(roadmapStages.goalId, goalId),
        eq(roadmapStages.status, 'pending'),
        gt(roadmapStages.position, stage.position)
      )).orderBy(asc(roadmapStages.position)).limit(1))[0];
      if (next) {
        await tx.update(roadmapStages).set({ status: 'active', updatedAt: now })
          .where(eq(roadmapStages.id, next.id));
      } else {
        await tx.update(goals).set({ status: 'done', updatedAt: now })
          .where(eq(goals.id, goalId));
      }
    });
    return this.listRoadmap(goalId);
  }

  async getPlanAdjustmentProposal(proposalId: string): Promise<PlanAdjustmentProposal | null> {
    const row = (await this.db.select().from(learningEvaluations)
      .where(and(
        eq(learningEvaluations.id, proposalId),
        eq(learningEvaluations.kind, 'goal_review')
      )).limit(1))[0];
    return row ? mapPlanAdjustmentProposal(row) : null;
  }

  async listPlanAdjustmentProposals(
    status?: PlanAdjustmentProposal['status']
  ): Promise<PlanAdjustmentProposal[]> {
    const rows = await this.db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.kind, 'goal_review'))
      .orderBy(desc(learningEvaluations.createdAt));
    const mapped = rows.map(mapPlanAdjustmentProposal);
    return status ? mapped.filter((item) => item.status === status) : mapped;
  }

  async decidePlanAdjustment(
    proposalId: string,
    status: 'accepted' | 'rejected'
  ): Promise<PlanAdjustmentProposal> {
    return status === 'accepted'
      ? this.recordAcceptedDecision(proposalId)
      : this.rejectProposal(proposalId);
  }

  async recordAcceptedDecision(proposalId: string): Promise<PlanAdjustmentProposal> {
    const row = (await this.db.select().from(learningEvaluations).where(and(
      eq(learningEvaluations.id, proposalId),
      eq(learningEvaluations.kind, 'goal_review')
    )).limit(1))[0];
    if (!row) throw new Error(`Goal review recommendation not found: ${proposalId}`);
    if (row.recommendationDecision === 'accepted' && row.applicationStatus === 'applied') {
      return mapPlanAdjustmentProposal(row);
    }
    if (row.recommendationDecision === 'declined') {
      throw new Error('已拒绝的建议不能再次应用。');
    }
    if (!row.goalId || !row.recommendationJson) throw new Error('建议缺少可执行的 Goal 或 Payload。');
    const updated = (await this.db.update(learningEvaluations).set({
      recommendationDecision: 'accepted',
      applicationStatus: 'pending',
      applicationError: null
    }).where(eq(learningEvaluations.id, proposalId)).returning())[0];
    return mapPlanAdjustmentProposal(updated);
  }

  async applyAcceptedProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    const row = (await this.db.select().from(learningEvaluations).where(and(
      eq(learningEvaluations.id, proposalId),
      eq(learningEvaluations.kind, 'goal_review')
    )).limit(1))[0];
    if (!row) throw new Error(`Goal review recommendation not found: ${proposalId}`);
    if (row.recommendationDecision !== 'accepted') {
      throw new Error('建议尚未被接受，不能应用。');
    }
    if (row.applicationStatus === 'applied') {
      return mapPlanAdjustmentProposal(row);
    }
    if (!row.goalId || !row.recommendationJson) throw new Error('建议缺少可执行的 Goal 或 Payload。');
    const payload = parseRecommendation(row.recommendationJson);
    const now = nowIso();
    try {
      await this.applyReviewPlanAdjustments({
        goalId: row.goalId,
        adjustments: payload.adjustments.map((item) => ({ ...item, reason: row.feedback }))
      });
      const updated = (await this.db.update(learningEvaluations).set({
        applicationStatus: 'applied',
        appliedAt: now
      }).where(eq(learningEvaluations.id, proposalId)).returning())[0];
      return mapPlanAdjustmentProposal(updated);
    } catch (error) {
      await this.db.update(learningEvaluations).set({
        applicationStatus: 'failed',
        applicationError: error instanceof Error ? error.message : 'plan_application_failed'
      }).where(eq(learningEvaluations.id, proposalId));
      throw error;
    }
  }

  async getPlanVersionsForGoal(goalId: string): Promise<PlanVersionEntry[]> {
    const rows = await this.db.select().from(planVersions)
      .where(eq(planVersions.goalId, goalId))
      .orderBy(desc(planVersions.version)).limit(20);
    return rows.map((row) => ({
      version: row.version,
      changeSummary: row.changeSummary,
      createdAt: row.createdAt,
      snapshot: parsePlanSnapshot(row.snapshotJson)
    }));
  }

  async createProposal(
    goalId: string,
    proposal: PlanProposalInput
  ): Promise<PlanAdjustmentProposal> {
    const row = {
      id: createId('goal_review'),
      kind: 'goal_review' as const,
      submissionId: null,
      goalId,
      result: 'unclear' as const,
      evidenceJson: '[]',
      correctPartsJson: '[]',
      misconceptionsJson: '[]',
      missingRequirementsJson: '[]',
      feedback: proposal.reason,
      direction: 'replan' as const,
      selfNote: null,
      recommendationJson: JSON.stringify({ adjustments: proposal.adjustments }),
      recommendationDecision: 'pending' as const,
      recommendationDecisionReason: null,
      applicationStatus: null,
      applicationError: null,
      appliedAt: null,
      source: 'ai' as const,
      supersedesEvaluationId: null,
      correctionReason: null,
      aiReviewId: null,
      createdAt: nowIso()
    };
    await this.db.insert(learningEvaluations).values(row);
    return mapPlanAdjustmentProposal(row);
  }

  async rejectProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    const rows = await this.db.update(learningEvaluations).set({
      recommendationDecision: 'declined',
      applicationStatus: null,
      applicationError: null,
      appliedAt: null
    }).where(and(
      eq(learningEvaluations.id, proposalId),
      eq(learningEvaluations.kind, 'goal_review')
    )).returning();
    if (!rows[0]) throw new Error(`Goal review recommendation not found: ${proposalId}`);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  private async listRoadmap(goalId: string): Promise<RoadmapStage[]> {
    const rows = await this.db.select().from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId)).orderBy(asc(roadmapStages.position));
    return rows.map(mapRoadmapStage);
  }
}

function parseRecommendation(raw: string): {
  adjustments: Array<{
    itemIndex: number;
    title: string;
    focus: string;
    expectedOutput: string;
    successCriteria: string;
  }>;
} {
  const value = JSON.parse(raw) as { adjustments?: unknown };
  if (!Array.isArray(value.adjustments)) throw new Error('建议 Payload 不符合 V2 Command Schema。');
  const adjustments = value.adjustments.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('建议 Payload 不符合 V2 Command Schema。');
    const record = item as Record<string, unknown>;
    const mapped = {
      itemIndex: Number(record.itemIndex),
      title: String(record.title ?? ''),
      focus: String(record.focus ?? ''),
      expectedOutput: String(record.expectedOutput ?? ''),
      successCriteria: String(record.successCriteria ?? '')
    };
    if (!Number.isInteger(mapped.itemIndex) || !mapped.title || !mapped.focus) {
      throw new Error('建议 Payload 不符合 V2 Command Schema。');
    }
    return mapped;
  });
  return { adjustments };
}

function parsePlanSnapshot(raw: string): PlanVersionEntry['snapshot'] {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const plan = Array.isArray(value.shortPlan)
      ? value.shortPlan.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            itemIndex: Number(row.itemIndex ?? 0),
            title: String(row.title ?? ''),
            focus: String(row.focus ?? ''),
            expectedOutput: String(row.expectedOutput ?? ''),
            successCriteria: String(row.successCriteria ?? '')
          };
        })
      : undefined;
    return {
      shortPlan: plan,
      reason: typeof value.reason === 'string' ? value.reason : undefined
    };
  } catch {
    return null;
  }
}
