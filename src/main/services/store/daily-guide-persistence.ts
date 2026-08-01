import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type {
  DailyGuide,
  LearningGoal,
  RoadmapStage,
  NearTermPlanItem,
  StudyWindow
} from '../../../shared/types';
import type { DailyGuideAgentOutput } from '../../../shared/schemas';
import type { Database } from '../../db/client';
import {
  goals,
  learningActions,
  learningGuides,
  learningTasks,
  nearTermPlanItems,
  planVersions,
  roadmapStages
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  mapDailyGuide,
  mapDailyGuideAction,
  mapDailyGuideTask,
  mapGoal,
  mapRoadmapStage,
  mapNearTermPlanItem
} from './serialization';
import type { CurrentLearningContextPersistence } from './current-learning-context';

export class DailyGuidePersistence {
  constructor(
    private readonly db: Database,
    private readonly currentLearningContext: CurrentLearningContextPersistence
  ) {}

  async confirmLearningGuide(guideId: string): Promise<DailyGuide> {
    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Learning guide not found: ${guideId}`);
    const confirmedAt = nowIso();
    await this.db.transaction(async (tx) => {
      await tx.update(learningGuides).set({
        status: 'active',
        confirmedAt
      }).where(eq(learningGuides.id, guideId));
      await this.currentLearningContext.makeGuideCurrent(guideId, tx);
    });
    const updated = await this.getDailyGuideById(guideId);
    if (!updated) throw new Error('Learning guide confirmation failed.');
    return updated;
  }

  async getUsedNearTermPlanItemIds(goalId: string): Promise<Set<string>> {
    const rows = await this.db.select({ id: learningGuides.nearTermPlanItemId }).from(learningGuides)
      .where(eq(learningGuides.goalId, goalId));
    return new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)));
  }

  async listAvailableNearTermPlanItemsForStage(goalId: string, roadmapStageId: string): Promise<NearTermPlanItem[]> {
    const used = await this.getUsedNearTermPlanItemIds(goalId);
    const rows = await this.db.select().from(nearTermPlanItems).where(and(
      eq(nearTermPlanItems.goalId, goalId),
      eq(nearTermPlanItems.roadmapStageId, roadmapStageId),
      inArray(nearTermPlanItems.status, ['pending', 'active'])
    )).orderBy(asc(nearTermPlanItems.itemIndex));
    return rows.map(mapNearTermPlanItem).filter((item) => !used.has(item.id));
  }

  async ensureDraftDailyGuide(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    nearTermPlanItemId: string;
  }): Promise<DailyGuide> {
    const existing = (await this.db.select({ id: learningGuides.id }).from(learningGuides)
      .where(eq(learningGuides.nearTermPlanItemId, params.nearTermPlanItemId)).limit(1))[0];
    if (existing) {
      const guide = await this.getDailyGuideById(existing.id);
      if (guide) return guide;
    }
    const now = nowIso();
    const row = {
      id: createId('guide'),
      goalId: params.goal.id,
      nearTermPlanItemId: params.nearTermPlanItemId,
      suggestedDate: null,
      status: 'draft' as const,
      weekFocus: '',
      learningGoal: '',
      deliverablesJson: '[]',
      boundariesJson: '[]',
      acceptanceCriteriaJson: '[]',
      nextActionsJson: '[]',
      createdAt: now,
      confirmedAt: null
    };
    await this.db.insert(learningGuides).values(row);
    return mapDailyGuide(row);
  }

  async saveDailyGuideWithTransaction(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    nearTermPlanItemId: string;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: NearTermPlanItem[]; guide: DailyGuide }> {
    const now = nowIso();
    const result = await this.db.transaction(async (tx) => {
      const planItem = (await tx.select().from(nearTermPlanItems).where(and(
        eq(nearTermPlanItems.id, params.nearTermPlanItemId),
        eq(nearTermPlanItems.goalId, params.goal.id)
      )).limit(1))[0];
      if (!planItem) throw new Error('近期计划项不存在或不属于当前 Goal。');
      const existing = (await tx.select().from(learningGuides)
        .where(eq(learningGuides.nearTermPlanItemId, params.nearTermPlanItemId)).limit(1))[0] ?? null;
      if (existing && existing.status !== 'draft') {
        throw new Error('该近期计划项已有生效的 Learning Guide。');
      }
      const guideId = existing?.id ?? createId('guide');
      if (existing) {
        const oldTasks = await tx.select({ id: learningTasks.id }).from(learningTasks)
          .where(eq(learningTasks.guideId, guideId));
        if (oldTasks.length > 0) {
          await tx.delete(learningActions).where(inArray(learningActions.taskId, oldTasks.map((item) => item.id)));
          await tx.delete(learningTasks).where(eq(learningTasks.guideId, guideId));
        }
        await tx.update(learningGuides).set({
          suggestedDate: null,
          learningGoal: params.dailyGuide.todayGoal,
          deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
          boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
          acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
          nextActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions)
        }).where(eq(learningGuides.id, guideId));
      } else {
        await tx.insert(learningGuides).values({
          id: guideId,
          goalId: params.goal.id,
          nearTermPlanItemId: params.nearTermPlanItemId,
          suggestedDate: null,
          status: 'draft',
          weekFocus: '',
          learningGoal: params.dailyGuide.todayGoal,
          deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
          boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
          acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
          nextActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
          createdAt: now,
          confirmedAt: null
        });
      }
      for (const [position, task] of params.dailyGuide.tasks.entries()) {
        const taskId = createId('task');
        await tx.insert(learningTasks).values({
          id: taskId,
          goalId: params.goal.id,
          guideId,
          roadmapStageId: planItem.roadmapStageId,
          title: task.title,
          objective: task.objective,
          scope: task.scope,
          estimatedMinMinutes: task.estimatedMinutes.min,
          estimatedTargetMinutes: task.estimatedMinutes.target,
          estimatedMaxMinutes: task.estimatedMinutes.max,
          deliverable: task.deliverable,
          doneWhenJson: JSON.stringify(task.doneWhen),
          quickHint: task.quickHint,
          evaluationMode: task.evaluationMode,
          difficulty: 'foundation',
          taskMode: 'learning',
          status: 'planned',
          closureKind: null,
          nextStartPoint: task.actions[0]?.title ?? null,
          position,
          createdAt: now,
          updatedAt: now
        });
        for (const [actionPosition, action] of task.actions.entries()) {
          await tx.insert(learningActions).values({
            id: createId('action'),
            taskId,
            title: action.title,
            instruction: action.instruction,
            checkpoint: action.checkpoint,
            requirement: 'optional',
            status: 'planned',
            progressNote: null,
            completedAt: null,
            position: actionPosition
          });
        }
      }
      const latestVersion = (await tx.select({ version: planVersions.version }).from(planVersions)
        .where(eq(planVersions.goalId, params.goal.id))
        .orderBy(desc(planVersions.version)).limit(1))[0]?.version ?? 0;
      await tx.insert(planVersions).values({
        id: createId('plan_version'),
        goalId: params.goal.id,
        version: latestVersion + 1,
        changeSummary: '生成 Learning Guide',
        snapshotJson: JSON.stringify({ guideId, nearTermPlanItemId: params.nearTermPlanItemId }),
        createdAt: now
      });
      return guideId;
    });
    const guide = await this.getDailyGuideById(result);
    if (!guide) throw new Error('Learning Guide 保存后无法读取。');
    return {
      goal: params.goal,
      roadmap: await this.listRoadmap(params.goal.id),
      shortPlan: await this.listNearTermPlan(params.goal.id),
      guide
    };
  }

  async getActiveGuide(activeOnly = false): Promise<{
    goal: LearningGoal | null;
    roadmap: RoadmapStage[];
    shortPlan: NearTermPlanItem[];
    guide: DailyGuide | null;
  }> {
    const resolved = await this.currentLearningContext.resolve();
    const guide = resolved.displayGuideId ? await this.getDailyGuideById(resolved.displayGuideId) : null;
    if (activeOnly && guide?.sessionStatus !== 'active') {
      return { goal: null, roadmap: [], shortPlan: [], guide: null };
    }
    const goalId = guide?.goalId ?? resolved.goalId;
    return {
      goal: goalId ? await this.getGoal(goalId) : null,
      roadmap: goalId ? await this.listRoadmap(goalId) : [],
      shortPlan: goalId ? await this.listNearTermPlan(goalId) : [],
      guide
    };
  }

  async getGuideByDate(date: string): Promise<DailyGuide | null> {
    const row = (await this.db.select({ id: learningGuides.id }).from(learningGuides)
      .where(sql`${learningGuides.createdAt} LIKE ${date + '%'}`)
      .orderBy(desc(learningGuides.createdAt)).limit(1))[0];
    return row ? this.getDailyGuideById(row.id) : null;
  }

  async activateNearTermPlanItem(nearTermPlanItemId: string): Promise<boolean> {
    const item = (await this.db.select().from(nearTermPlanItems)
      .where(eq(nearTermPlanItems.id, nearTermPlanItemId)).limit(1))[0];
    if (!item) return false;
    await this.db.transaction(async (tx) => {
      await tx.update(nearTermPlanItems).set({ status: 'pending' })
        .where(and(eq(nearTermPlanItems.goalId, item.goalId), eq(nearTermPlanItems.status, 'active')));
      await tx.update(nearTermPlanItems).set({ status: 'active' })
        .where(eq(nearTermPlanItems.id, nearTermPlanItemId));
    });
    return true;
  }

  async getPendingNearTermPlanItemsForGoal(goalId: string): Promise<NearTermPlanItem[]> {
    const rows = await this.db.select().from(nearTermPlanItems).where(and(
      eq(nearTermPlanItems.goalId, goalId),
      or(eq(nearTermPlanItems.status, 'pending'), eq(nearTermPlanItems.status, 'active'))
    )).orderBy(asc(nearTermPlanItems.itemIndex));
    return rows.map(mapNearTermPlanItem);
  }

  async getCompletedGuidesForGoal(goalId: string): Promise<DailyGuide[]> {
    const rows = await this.db.select({ id: learningGuides.id }).from(learningGuides)
      .where(and(eq(learningGuides.goalId, goalId), eq(learningGuides.status, 'closed')))
      .orderBy(desc(learningGuides.createdAt));
    const guides = await Promise.all(rows.map((row) => this.getDailyGuideById(row.id)));
    return guides.filter((item): item is DailyGuide => Boolean(item));
  }

  async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    const guide = (await this.db.select().from(learningGuides)
      .where(eq(learningGuides.id, guideId)).limit(1))[0];
    if (!guide) return null;
    const taskRows = await this.db.select().from(learningTasks)
      .where(eq(learningTasks.guideId, guideId)).orderBy(asc(learningTasks.position));
    const tasks = [];
    for (const task of taskRows) {
      const actions = await this.db.select().from(learningActions)
        .where(eq(learningActions.taskId, task.id)).orderBy(asc(learningActions.position));
      tasks.push(mapDailyGuideTask(task, actions.map(mapDailyGuideAction)));
    }
    return mapDailyGuide(guide, tasks);
  }

  private async getGoal(goalId: string): Promise<LearningGoal | null> {
    const row = (await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1))[0];
    return row ? mapGoal(row) : null;
  }

  private async listRoadmap(goalId: string): Promise<RoadmapStage[]> {
    const rows = await this.db.select().from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId)).orderBy(asc(roadmapStages.position));
    return rows.map(mapRoadmapStage);
  }

  private async listNearTermPlan(goalId: string): Promise<NearTermPlanItem[]> {
    const rows = await this.db.select().from(nearTermPlanItems)
      .where(eq(nearTermPlanItems.goalId, goalId)).orderBy(asc(nearTermPlanItems.itemIndex));
    return rows.map(mapNearTermPlanItem);
  }
}
