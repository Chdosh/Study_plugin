import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type {
  PlanAdjustmentProposal,
  PlanProposalInput,
  PlanVersionEntry,
  RoadmapStage,
  ShortPlanDay
} from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  dailyGuides,
  dailyGuideTasks,
  dailyPlans,
  learningRuntimeStates,
  planAdjustmentProposals,
  planVersions,
  roadmapStages,
  shortPlanDays,
  taskItems
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  difficultyFromRecommendedAction,
  mapPlanAdjustmentProposal,
  mapRoadmapStage,
  mapShortPlanDay,
  readProposedChanges,
  truncateText
} from './serialization';

export class PlanChangePersistence {
  constructor(private readonly db: Database) {}

  async applyReviewPlanAdjustments(params: {
    goalId: string;
    adjustments: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    if (params.adjustments.length === 0) return [];
    const activeStageRows = await this.db
      .select({ id: roadmapStages.id })
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, params.goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    const activeStageId = activeStageRows[0]?.id ?? null;
    const allDays = await this.db
      .select()
      .from(shortPlanDays)
      .where(and(
        eq(shortPlanDays.goalId, params.goalId),
        eq(shortPlanDays.sessionStatus, 'pending'),
        ...(activeStageId ? [eq(shortPlanDays.roadmapStageId, activeStageId)] : [])
      ))
      .orderBy(asc(shortPlanDays.dayIndex));
    const updated: ShortPlanDay[] = [];
    for (const adj of params.adjustments) {
      const target = allDays.find((d) => d.dayIndex === adj.dayIndex);
      if (!target || target.locked) continue;
      await this.db
        .update(shortPlanDays)
        .set({
          title: adj.title,
          focus: adj.focus,
          expectedOutput: adj.expectedOutput,
          successCriteria: adj.successCriteria
        })
        .where(eq(shortPlanDays.id, target.id));
      const mapped = mapShortPlanDay({ ...target, title: adj.title, focus: adj.focus, expectedOutput: adj.expectedOutput, successCriteria: adj.successCriteria });
      updated.push(mapped);
    }
    return updated;
  }

  async markRoadmapStageReadyForReview(goalId: string): Promise<void> {
    if (!goalId) return;

    const activeStageRows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    const activeStage = activeStageRows[0];
    if (!activeStage) return;

    const spDayRows = await this.db
      .select({ id: shortPlanDays.id, sessionStatus: shortPlanDays.sessionStatus })
      .from(shortPlanDays)
      .where(and(eq(shortPlanDays.goalId, goalId), eq(shortPlanDays.roadmapStageId, activeStage.id)));
    const spDayIdsForStage = new Set(spDayRows.map((d) => d.id));

    const guideRows = await this.db
      .select({ id: dailyGuides.id, sessionStatus: dailyGuides.sessionStatus, shortPlanDayId: dailyGuides.shortPlanDayId })
      .from(dailyGuides)
      .where(eq(dailyGuides.goalId, goalId));
    const guidesForStage = guideRows.filter((g) => g.shortPlanDayId && spDayIdsForStage.has(g.shortPlanDayId));

    const allDaysActivated = spDayRows.every((d) => {
      if (d.sessionStatus === 'pending') return false;
      return guidesForStage.some((g) => g.shortPlanDayId === d.id);
    });
    const allGuidesComplete = allDaysActivated && guidesForStage.length > 0 && guidesForStage.every((g) => g.sessionStatus === 'closed');

    if (!allGuidesComplete) return;

    const now = nowIso();
    await this.db
      .update(roadmapStages)
      .set({ status: 'ready_for_review', updatedAt: now })
      .where(eq(roadmapStages.id, activeStage.id));
  }

  async confirmRoadmapStageCompletion(goalId: string, stageId: string): Promise<RoadmapStage[]> {
    await this.db.transaction(async (tx) => {
      const stageRows = await tx
        .select()
        .from(roadmapStages)
        .where(and(eq(roadmapStages.id, stageId), eq(roadmapStages.goalId, goalId)))
        .limit(1);
      const stage = stageRows[0];
      if (!stage) throw new Error('找不到需要复核的学习阶段。');
      if (stage.status === 'completed') return;
      if (stage.status !== 'ready_for_review') throw new Error('当前阶段尚未达到待复核状态。');

      const now = nowIso();
      await tx.update(roadmapStages).set({ status: 'completed', updatedAt: now }).where(eq(roadmapStages.id, stage.id));
      const nextRows = await tx
        .select()
        .from(roadmapStages)
        .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'pending'), gt(roadmapStages.position, stage.position)))
        .orderBy(asc(roadmapStages.position))
        .limit(1);
      const next = nextRows[0];
      if (next) {
        await tx.update(roadmapStages).set({ status: 'active', updatedAt: now }).where(eq(roadmapStages.id, next.id));
        await tx.update(learningRuntimeStates).set({ activeStageId: next.id, updatedAt: now }).where(eq(learningRuntimeStates.id, 'default'));
      } else {
        await tx.update(learningRuntimeStates).set({ activeStageId: null, updatedAt: now }).where(eq(learningRuntimeStates.id, 'default'));
      }
    });
    return this.listRoadmap(goalId);
  }

  async getPlanAdjustmentProposal(proposalId: string): Promise<PlanAdjustmentProposal | null> {
    const rows = await this.db.select().from(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, proposalId)).limit(1);
    return rows[0] ? mapPlanAdjustmentProposal(rows[0]) : null;
  }

  async listPlanAdjustmentProposals(status?: PlanAdjustmentProposal['status']): Promise<PlanAdjustmentProposal[]> {
    const rows = status
      ? await this.db
          .select()
          .from(planAdjustmentProposals)
          .where(eq(planAdjustmentProposals.status, status))
          .orderBy(desc(planAdjustmentProposals.createdAt))
      : await this.db.select().from(planAdjustmentProposals).orderBy(desc(planAdjustmentProposals.createdAt));
    return rows.map(mapPlanAdjustmentProposal);
  }

  async decidePlanAdjustment(proposalId: string, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> {
    const existingRows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!existingRows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);

    const existing = mapPlanAdjustmentProposal(existingRows[0]);
    const now = nowIso();
    let appliedTaskId = existing.appliedTaskId;
    let appliedAt = existing.appliedAt;

    if (status === 'accepted' && !appliedTaskId) {
      appliedTaskId = await this.createFollowUpTaskFromAdjustment(existing);
      appliedAt = appliedTaskId ? now : null;
    }

    await this.db
      .update(planAdjustmentProposals)
      .set({
        status,
        decidedAt: now,
        appliedTaskId,
        appliedAt
      })
      .where(eq(planAdjustmentProposals.id, proposalId));
    const rows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!rows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  async getPlanVersionsForGoal(goalId: string): Promise<PlanVersionEntry[]> {
    const rows = await this.db
      .select({ version: planVersions.version, changeSummary: planVersions.changeSummary, createdAt: planVersions.createdAt, snapshotJson: planVersions.snapshotJson })
      .from(planVersions)
      .innerJoin(dailyPlans, eq(planVersions.planId, dailyPlans.id))
      .innerJoin(dailyGuides, eq(dailyGuides.planId, dailyPlans.id))
      .where(eq(dailyGuides.goalId, goalId))
      .orderBy(desc(planVersions.createdAt))
      .limit(10);
    return rows.map((r) => {
      let snapshot: PlanVersionEntry['snapshot'] = null;
      try {
        const raw = r.snapshotJson ? JSON.parse(r.snapshotJson) : null;
        if (raw && typeof raw === 'object') {
          const record = raw as Record<string, unknown>;
          const sp = record.shortPlan;
          const shortPlan = Array.isArray(sp) ? sp.map((d: Record<string, unknown>) => ({
            dayIndex: Number(d.dayIndex) || 0,
            title: String(d.title ?? ''),
            focus: String(d.focus ?? ''),
            expectedOutput: String(d.expectedOutput ?? ''),
            successCriteria: String(d.successCriteria ?? '')
          })) : undefined;
          snapshot = { shortPlan, reason: typeof record.reason === 'string' ? record.reason : undefined };
        }
      } catch {
        snapshot = null;
      }
      return {
        version: r.version,
        changeSummary: r.changeSummary ?? '',
        createdAt: r.createdAt,
        snapshot
      };
    });
  }

  async createProposal(goalId: string, proposal: PlanProposalInput): Promise<PlanAdjustmentProposal> {
    const now = nowIso();
    const id = createId('pap');
    await this.db.insert(planAdjustmentProposals).values({
      id,
      goalId,
      stageId: null,
      taskId: null,
      sourceDecisionId: null,
      status: 'pending',
      reason: proposal.reason,
      proposedChangesJson: JSON.stringify({ adjustments: proposal.adjustments }),
      appliedTaskId: null,
      createdAt: now,
      decidedAt: null,
      appliedAt: null
    });
    const rows = await this.db.select().from(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, id)).limit(1);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  async confirmProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    const existingRows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!existingRows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);

    const existing = mapPlanAdjustmentProposal(existingRows[0]);
    if (existing.status === 'accepted') return existing;
    if (existing.status === 'rejected') throw new Error('Cannot confirm a rejected proposal');

    const proposed = (typeof existing.proposedChanges === 'string'
      ? JSON.parse(existing.proposedChanges)
      : existing.proposedChanges) as { adjustments: Array<{ dayIndex: number; title: string; focus: string; expectedOutput: string; successCriteria: string; reason?: string }> };
    const adjustments = (proposed.adjustments ?? []).map((adj) => ({
      dayIndex: adj.dayIndex,
      title: adj.title,
      focus: adj.focus,
      expectedOutput: adj.expectedOutput,
      successCriteria: adj.successCriteria,
      reason: adj.reason ?? existing.reason
    }));

    const updated = await this.applyReviewPlanAdjustments({ goalId: existing.goalId!, adjustments });

    const now = nowIso();
    const planId = await this.findLatestPlanIdForGoal(existing.goalId!);
    if (planId && updated.length > 0) {
      const maxVersionRow = await this.db
        .select({ maxVersion: sql<number>`max(${planVersions.version})` })
        .from(planVersions)
        .where(eq(planVersions.planId, planId))
        .limit(1);
      const nextVersion = ((maxVersionRow[0]?.maxVersion as number) ?? 0) + 1;
      await this.db.insert(planVersions).values({
        id: createId('plan_version'),
        planId,
        version: nextVersion,
        changeSummary: `应用计划调整：${existing.reason}`,
        snapshotJson: JSON.stringify({ reason: existing.reason, shortPlan: adjustments.map((a) => ({ dayIndex: a.dayIndex, title: a.title, focus: a.focus, expectedOutput: a.expectedOutput, successCriteria: a.successCriteria })) }),
        createdAt: now
      });
    }

    await this.db
      .update(planAdjustmentProposals)
      .set({ status: 'accepted', decidedAt: now, appliedAt: updated.length > 0 ? now : null })
      .where(eq(planAdjustmentProposals.id, proposalId));
    const rows = await this.db.select().from(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, proposalId)).limit(1);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  async rejectProposal(proposalId: string): Promise<PlanAdjustmentProposal> {
    const existingRows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!existingRows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);

    const now = nowIso();
    await this.db
      .update(planAdjustmentProposals)
      .set({ status: 'rejected', decidedAt: now })
      .where(eq(planAdjustmentProposals.id, proposalId));
    const rows = await this.db.select().from(planAdjustmentProposals).where(eq(planAdjustmentProposals.id, proposalId)).limit(1);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  private async createFollowUpTaskFromAdjustment(proposal: PlanAdjustmentProposal): Promise<string | null> {
    const sourceTaskRows = proposal.taskId
      ? await this.db.select().from(taskItems).where(eq(taskItems.id, proposal.taskId)).limit(1)
      : [];
    const sourceTask = sourceTaskRows[0] ?? null;
    const proposed = readProposedChanges(proposal.proposedChanges);
    const nextFocus = proposed.nextFocus || proposed.carryForward || proposal.reason;
    const cleanFocus = nextFocus.trim();
    if (!cleanFocus) return null;

    const now = nowIso();
    const id = createId('task');
    const missing = proposed.missingRequirements.length > 0
      ? proposed.missingRequirements.join('；')
      : cleanFocus;
    const misconceptions = proposed.misconceptions.length > 0
      ? `\n需要纠正：${proposed.misconceptions.join('；')}`
      : '';

    await this.db.insert(taskItems).values({
      id,
      goalId: proposal.goalId ?? sourceTask?.goalId ?? null,
      sourceImportId: null,
      title: `跟进：${truncateText(cleanFocus, 42)}`,
      description: `由学习评估生成的后续计划调整。\n原因：${proposal.reason}${misconceptions}`,
      status: 'backlog',
      priority: sourceTask?.priority ?? 3,
      difficulty: sourceTask?.difficulty ?? difficultyFromRecommendedAction(proposed.recommendedAction),
      estimateMinutes: Math.max(10, Math.min(sourceTask?.estimateMinutes ?? 10, 60)),
      acceptanceCriteria: missing,
      createdAt: now,
      updatedAt: now
    });

    return id;
  }

  private async findLatestPlanIdForGoal(goalId: string): Promise<string | null> {
    const rows = await this.db
      .select({ planId: dailyPlans.id })
      .from(dailyPlans)
      .innerJoin(dailyGuides, eq(dailyGuides.planId, dailyPlans.id))
      .where(eq(dailyGuides.goalId, goalId))
      .orderBy(desc(dailyPlans.createdAt))
      .limit(1);
    return rows[0]?.planId ?? null;
  }

  private async listRoadmap(goalId: string): Promise<RoadmapStage[]> {
    const rows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goalId)).orderBy(asc(roadmapStages.position));
    return rows.map(mapRoadmapStage);
  }
}
