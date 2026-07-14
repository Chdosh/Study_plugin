import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideBlock,
  DailyGuideTask,
  DailyPlanBlock,
  GoalBrief,
  LearningGoal,
  RoadmapStage,
  ShortPlanDay,
  StudyWindow
} from '../../../shared/types';
import type { DailyGuideAgentOutput } from '../../../shared/schemas';
import { localDateIso } from '../../../shared/date';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  goals,
  planVersions,
  roadmapStages,
  shortPlanDays
} from '../../db/schema';
import { createId, nowIso } from '../id';
import {
  addMinutesToClock,
  mapDailyGuide,
  mapDailyGuideAction,
  mapDailyGuideBlock,
  mapDailyGuideTask,
  mapGoal,
  mapPlanBlock,
  mapRoadmapStage,
  mapShortPlanDay
} from './serialization';
import type { CurrentLearningContextPersistence } from './current-learning-context';

export class DailyGuidePersistence {
  constructor(
    private readonly db: Database,
    private readonly currentLearningContext: CurrentLearningContextPersistence
  ) {}

  async confirmDailyGuide(guideId: string): Promise<DailyGuide> {
    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Daily guide not found: ${guideId}`);
    const confirmedAt = nowIso();
    await this.db
      .update(dailyPlans)
      .set({
        status: 'confirmed',
        confirmedAt
      })
      .where(eq(dailyPlans.id, guide.planId));
    await this.db
      .update(dailyGuides)
      .set({
        status: 'confirmed',
        confirmedAt
      })
      .where(eq(dailyGuides.id, guideId));
    await this.currentLearningContext.makeGuideCurrent(guideId);
    if (guide.shortPlanDayId) {
      await this.db
        .update(shortPlanDays)
        .set({ locked: true })
        .where(eq(shortPlanDays.id, guide.shortPlanDayId));
    }
    const updated = await this.getDailyGuideById(guideId);
    if (!updated) throw new Error(`Daily guide not found after confirm: ${guideId}`);
    return updated;
  }

  async getUsedShortPlanDayIds(goalId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ shortPlanDayId: dailyGuides.shortPlanDayId })
      .from(dailyGuides)
      .where(eq(dailyGuides.goalId, goalId));
    return new Set(rows.map((row) => row.shortPlanDayId).filter((id): id is string => Boolean(id)));
  }

  async listAvailableShortPlanDaysForStage(goalId: string, roadmapStageId: string): Promise<ShortPlanDay[]> {
    const usedShortPlanDayIds = await this.getUsedShortPlanDayIds(goalId);
    const rows = await this.db
      .select()
      .from(shortPlanDays)
      .where(and(
        eq(shortPlanDays.goalId, goalId),
        eq(shortPlanDays.roadmapStageId, roadmapStageId),
        eq(shortPlanDays.sessionStatus, 'pending'),
        isNull(shortPlanDays.date)
      ))
      .orderBy(asc(shortPlanDays.dayIndex));
    return rows
      .map(mapShortPlanDay)
      .filter((day) => !usedShortPlanDayIds.has(day.id));
  }

  async ensureDraftDailyGuide(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    shortPlanDayId: string;
  }): Promise<DailyGuide> {
    const existing = await this.db.select({ id: dailyGuides.id }).from(dailyGuides)
      .where(eq(dailyGuides.shortPlanDayId, params.shortPlanDayId)).limit(1);
    if (existing[0]) {
      const guide = await this.getDailyGuideById(existing[0].id);
      if (!guide) throw new Error('待生成执行稿读取失败。');
      return guide;
    }

    const now = nowIso();
    const planId = createId('plan');
    const guideId = createId('daily_guide');
    await this.db.transaction(async (tx) => {
      await tx.insert(dailyPlans).values({
        id: planId, date: params.date, status: 'draft',
        availableWindowsJson: JSON.stringify(params.windows), shortPlanDayId: params.shortPlanDayId,
        createdAt: now, confirmedAt: null, sourceReviewId: null, version: 1
      });
      await tx.insert(dailyGuides).values({
        id: guideId, goalId: params.goal.id, planId, shortPlanDayId: params.shortPlanDayId,
        date: params.date, status: 'draft', sessionStatus: 'draft', weekFocus: '', todayGoal: '',
        deliverablesJson: '[]', boundariesJson: '[]', acceptanceCriteriaJson: '[]', tomorrowActionsJson: '[]',
        createdAt: now, confirmedAt: null
      });
    });
    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error('待生成执行稿创建失败。');
    return guide;
  }

  async saveDailyGuideWithTransaction(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    shortPlanDayId: string;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    const now = nowIso();

    return await this.db.transaction(async (tx) => {
      const activeStageRows = await tx
        .select()
        .from(roadmapStages)
        .where(and(eq(roadmapStages.goalId, params.goal.id), eq(roadmapStages.status, 'active')))
        .orderBy(asc(roadmapStages.position))
        .limit(1);
      const activeStageId = activeStageRows[0]?.id ?? null;

      const existingRows = await tx.select().from(dailyGuides)
        .where(eq(dailyGuides.shortPlanDayId, params.shortPlanDayId)).limit(1);
      const existing = existingRows[0] ?? null;
      if (existing && existing.sessionStatus !== 'draft') {
        throw new Error('该学习单元已经存在有效执行稿。');
      }

      const planId = existing?.planId ?? createId('plan');
      const guideId = existing?.id ?? createId('daily_guide');
      if (existing) {
        await tx.update(dailyPlans).set({
          date: params.date,
          availableWindowsJson: JSON.stringify(params.windows)
        }).where(eq(dailyPlans.id, planId));
        await tx.update(dailyGuides).set({
          date: params.date, sessionStatus: 'active', todayGoal: params.dailyGuide.todayGoal,
          deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
          boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
          acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
          tomorrowActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions)
        }).where(eq(dailyGuides.id, guideId));
      } else {
        await tx.insert(dailyPlans).values({
          id: planId, date: params.date, status: 'draft',
          availableWindowsJson: JSON.stringify(params.windows), shortPlanDayId: params.shortPlanDayId,
          createdAt: now, confirmedAt: null, sourceReviewId: null, version: 1
        });
        await tx.insert(dailyGuides).values({
          id: guideId, goalId: params.goal.id, planId, shortPlanDayId: params.shortPlanDayId,
          date: params.date, status: 'draft', sessionStatus: 'active', weekFocus: '',
          todayGoal: params.dailyGuide.todayGoal,
          deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
          boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
          acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
          tomorrowActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
          createdAt: now, confirmedAt: null
        });
      }

      let blockPosition = 0;
      let cursorTime = params.windows[0]?.start ?? '20:00';
      for (const task of params.dailyGuide.tasks) {
        const planBlockId = createId('block');
        const startTime = cursorTime;
        const endTime = addMinutesToClock(startTime, task.estimatedMinutes.target);
        cursorTime = endTime;

        await tx.insert(dailyPlanBlocks).values({
          id: planBlockId, planId, taskId: null,
          startTime, endTime, durationMinutes: task.estimatedMinutes.target,
          objective: task.objective,
          action: task.actions.map((a) => `${a.title}：${a.instruction}`).join('\n'),
          expectedOutput: task.deliverable, difficulty: 'foundation',
          material: '今日主任务',
          successCheck: task.doneWhen.join('；') || task.deliverable,
          fallback: task.quickHint, status: 'planned', position: blockPosition
        });

        const guideTaskId = createId('daily_guide_task');
        await tx.insert(dailyGuideTasks).values({
          id: guideTaskId, guideId, roadmapStageId: activeStageId, legacyPlanBlockId: planBlockId,
          title: task.title, objective: task.objective, scope: task.scope,
          estimatedMinMinutes: task.estimatedMinutes.min,
          estimatedTargetMinutes: task.estimatedMinutes.target,
          estimatedMaxMinutes: task.estimatedMinutes.max,
          deliverable: task.deliverable,
          doneWhenJson: JSON.stringify(task.doneWhen),
          quickHint: task.quickHint,
          evaluationMode: task.evaluationMode,
          submissionPolicy: task.submissionPolicy,
          carryoverAllowed: task.carryoverAllowed,
          status: 'planned', progressPercent: 0, currentActionId: null,
          nextStartPoint: task.actions[0]?.title ?? null,
          totalElapsedMinutes: 0, position: blockPosition,
          createdAt: now, updatedAt: now
        });

        let actionPosition = 0;
        for (const action of task.actions) {
          await tx.insert(dailyGuideActions).values({
            id: createId('daily_guide_action'), taskId: guideTaskId,
            title: action.title, instruction: action.instruction,
            checkpoint: action.checkpoint, status: 'planned',
            progressNote: null, completedAt: null, position: actionPosition++
          });
        }

        await tx.insert(dailyGuideBlocks).values({
          id: createId('daily_guide_block'), guideId, planBlockId,
          title: task.title, position: blockPosition
        });
        blockPosition += 1;
      }

      await tx.insert(planVersions).values({
        id: createId('plan_version'), planId, version: 1,
        changeSummary: `Daily guide for short plan day`,
        snapshotJson: JSON.stringify({ guide: params.dailyGuide }),
        createdAt: now
      });

      const roadmap = await this.listRoadmap(params.goal.id);
      const shortPlan = await this.listShortPlan(params.goal.id);
      const guide = await this.getDailyGuideInTx(tx, guideId);
      if (!guide) throw new Error('Daily guide not found after save');
      return { goal: params.goal, roadmap, shortPlan, guide };
    });
  }

  async getActiveGuide(activeOnly: boolean = false): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide | null }> {
    const context = await this.currentLearningContext.resolve();
    const guideId = activeOnly ? context.activeGuideId : context.displayGuideId;
    const guide = guideId ? await this.getDailyGuideById(guideId) : null;
    const goal = guide
      ? await this.getGoal(guide.goalId)
      : (await this.listGoals()).find((item) => item.status === 'active') ?? null;
    const roadmap = goal ? await this.listRoadmap(goal.id) : [];
    const shortPlan = goal ? await this.listShortPlan(goal.id) : [];
    return { goal, roadmap, shortPlan, guide };
  }

  async getGuideByDate(date: string): Promise<DailyGuide | null> {
    const rows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(eq(dailyGuides.date, date), inArray(dailyGuides.status, ['draft', 'confirmed', 'completed'])))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    return rows[0] ? this.getDailyGuideById(rows[0].id) : null;
  }

  async activateShortPlanDay(shortPlanDayId: string): Promise<boolean> {
    const rows = await this.db
      .update(shortPlanDays)
      .set({ sessionStatus: 'active', date: localDateIso() })
      .where(and(eq(shortPlanDays.id, shortPlanDayId), eq(shortPlanDays.sessionStatus, 'pending')))
      .returning({ id: shortPlanDays.id });
    return rows.length > 0;
  }

  async getPendingShortPlanDaysForGoal(goalId: string): Promise<ShortPlanDay[]> {
    const rows = await this.db
      .select()
      .from(shortPlanDays)
      .where(and(eq(shortPlanDays.goalId, goalId), eq(shortPlanDays.sessionStatus, 'pending')))
      .orderBy(asc(shortPlanDays.dayIndex));
    return rows.map(mapShortPlanDay);
  }

  async updateShortPlanDay(shortPlanDayId: string, patch: Partial<ShortPlanDay>): Promise<ShortPlanDay | null> {
    const rows = await this.db
      .update(shortPlanDays)
      .set(patch)
      .where(eq(shortPlanDays.id, shortPlanDayId))
      .returning();
    return rows[0] ? mapShortPlanDay(rows[0]) : null;
  }

  async getCompletedGuidesForGoal(goalId: string): Promise<DailyGuide[]> {
    const rows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(eq(dailyGuides.goalId, goalId), eq(dailyGuides.sessionStatus, 'closed')))
      .orderBy(desc(dailyGuides.createdAt));
    const guides: DailyGuide[] = [];
    for (const row of rows) {
      const guide = await this.getDailyGuideById(row.id);
      if (guide) guides.push(guide);
    }
    return guides;
  }

  async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) return null;
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of taskRows) {
      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, task.id))
        .orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    const guideBlockRows = await this.db
      .select()
      .from(dailyGuideBlocks)
      .where(eq(dailyGuideBlocks.guideId, guideId))
      .orderBy(asc(dailyGuideBlocks.position));
    const blocks: DailyGuideBlock[] = [];
    for (const guideBlock of guideBlockRows) {
      const planBlock = await this.getBlock(guideBlock.planBlockId);
      if (planBlock) {
        blocks.push(mapDailyGuideBlock(guideBlock, planBlock));
      }
    }
    return mapDailyGuide(guide, blocks, tasks);
  }

  private async getDailyGuideInTx(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    guideId: string
  ): Promise<DailyGuide | null> {
    const guideRows = await tx.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    if (guideRows.length === 0) return null;
    const guideRow = guideRows[0];

    const guideBlockRows = await tx.select().from(dailyGuideBlocks).where(eq(dailyGuideBlocks.guideId, guideId)).orderBy(asc(dailyGuideBlocks.position));
    const blocks: DailyGuideBlock[] = [];
    for (const guideBlock of guideBlockRows) {
      const planBlockRows = await tx.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, guideBlock.planBlockId)).limit(1);
      if (planBlockRows.length > 0) {
        blocks.push(mapDailyGuideBlock(guideBlock, mapPlanBlock(planBlockRows[0])));
      }
    }

    const taskRows = await tx.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideId)).orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const taskRow of taskRows) {
      const actionRows = await tx.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, taskRow.id)).orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(taskRow, actionRows.map(mapDailyGuideAction)));
    }
    return mapDailyGuide(guideRow, blocks, tasks);
  }

  private async getBlock(blockId: string): Promise<DailyPlanBlock | null> {
    const rows = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    return rows[0] ? mapPlanBlock(rows[0]) : null;
  }

  private async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

  private async listGoals(): Promise<LearningGoal[]> {
    const rows = await this.db.select().from(goals).orderBy(desc(goals.createdAt));
    return rows.map(mapGoal);
  }

  private async listRoadmap(goalId: string): Promise<RoadmapStage[]> {
    const rows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goalId)).orderBy(asc(roadmapStages.position));
    return rows.map(mapRoadmapStage);
  }

  private async listShortPlan(goalId: string): Promise<ShortPlanDay[]> {
    const rows = await this.db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goalId)).orderBy(asc(shortPlanDays.dayIndex));
    return rows.map(mapShortPlanDay);
  }
}
