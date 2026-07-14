import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  DailyGuide,
  GoalBrief,
  LearningGoal,
  RoadmapStage,
  ShortPlanDay,
  StudyWindow
} from '../../../shared/types';
import type {
  DailyGuideAgentOutput,
  RoadmapAgentOutput,
  ShortPlanAgentOutput
} from '../../../shared/schemas';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  planVersions,
  roadmapStages,
  shortPlanDays
} from '../../db/schema';
import { createId, nowIso } from '../id';
import { addMinutesToClock, mapRoadmapStage, mapShortPlanDay } from './serialization';

type GetDailyGuideById = (guideId: string) => Promise<DailyGuide | null>;

export class LayeredPlanPersistence {
  constructor(
    private readonly db: Database,
    private readonly getDailyGuideById: GetDailyGuideById
  ) {}

  async saveLayeredPlan(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    date: string;
    windows: StudyWindow[];
    roadmap: RoadmapAgentOutput;
    shortPlan: ShortPlanAgentOutput;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    const now = nowIso();
    const roadmapRows: RoadmapStage[] = [];
    let position = 0;
    for (const stage of params.roadmap.stages) {
      const row = {
        id: createId('roadmap_stage'),
        goalId: params.goal.id,
        title: stage.title,
        objective: stage.objective,
        direction: stage.direction,
        successCriteria: stage.successCriteria,
        position: position++,
        createdAt: now,
        updatedAt: now
      };
      await this.db.insert(roadmapStages).values(row);
      roadmapRows.push({ ...row, status: 'pending' as const });
    }

    if (roadmapRows[0]) {
      await this.db
        .update(roadmapStages)
        .set({ status: 'active' })
        .where(eq(roadmapStages.id, roadmapRows[0].id));
      roadmapRows[0].status = 'active';
    }

    const shortRows: ShortPlanDay[] = [];
    let day1ShortPlanDayId: string | null = null;
    for (const day of params.shortPlan.days) {
      const row = {
        id: createId('short_plan_day'),
        goalId: params.goal.id,
        roadmapStageId: roadmapRows[0]?.id ?? null,
        dayIndex: day.dayIndex,
        date: day.dayIndex === 1 ? params.date : null,
        sessionStatus: 'pending' as const,
        title: day.title,
        focus: day.focus,
        tasksJson: JSON.stringify(day.tasks),
        expectedOutput: day.expectedOutput,
        successCriteria: day.successCriteria,
        locked: false,
        createdAt: now
      };
      await this.db.insert(shortPlanDays).values(row);
      if (day.dayIndex === 1) {
        day1ShortPlanDayId = row.id;
      }
      shortRows.push(mapShortPlanDay(row));
    }

    const planId = createId('plan');
    await this.db.insert(dailyPlans).values({
      id: planId,
      date: params.date,
      status: 'draft',
      availableWindowsJson: JSON.stringify(params.windows),
      shortPlanDayId: day1ShortPlanDayId,
      createdAt: now,
      confirmedAt: null,
      sourceReviewId: null,
      version: 1
    });

    const guideId = createId('daily_guide');
    await this.db.insert(dailyGuides).values({
      id: guideId,
      goalId: params.goal.id,
      planId,
      shortPlanDayId: day1ShortPlanDayId,
      date: params.date,
      status: 'draft',
      weekFocus: params.shortPlan.weekFocus,
      todayGoal: params.dailyGuide.todayGoal,
      deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
      boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
      acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
      tomorrowActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
      createdAt: now,
      confirmedAt: null
    });

    let blockPosition = 0;
    let cursorTime = params.windows[0]?.start ?? '20:00';
    for (const task of params.dailyGuide.tasks) {
      const planBlockId = createId('block');
      const startTime = cursorTime;
      const endTime = addMinutesToClock(startTime, task.estimatedMinutes.target);
      cursorTime = endTime;
      await this.db.insert(dailyPlanBlocks).values({
        id: planBlockId,
        planId,
        taskId: null,
        startTime,
        endTime,
        durationMinutes: task.estimatedMinutes.target,
        objective: task.objective,
        action: task.actions.map((action) => `${action.title}：${action.instruction}`).join('\n'),
        expectedOutput: task.deliverable,
        difficulty: 'foundation',
        material: '今日主任务',
        successCheck: task.doneWhen.join('；') || task.deliverable,
        fallback: task.quickHint,
        status: 'planned',
        position: blockPosition
      });
      const guideTaskId = createId('daily_guide_task');
      const nowForTask = nowIso();
      await this.db.insert(dailyGuideTasks).values({
        id: guideTaskId,
        guideId,
        roadmapStageId: roadmapRows[0]?.id ?? null,
        legacyPlanBlockId: planBlockId,
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
        submissionPolicy: task.submissionPolicy,
        carryoverAllowed: task.carryoverAllowed,
        status: 'planned',
        progressPercent: 0,
        currentActionId: null,
        nextStartPoint: task.actions[0]?.title ?? null,
        totalElapsedMinutes: 0,
        position: blockPosition,
        createdAt: nowForTask,
        updatedAt: nowForTask
      });
      let actionPosition = 0;
      for (const action of task.actions) {
        await this.db.insert(dailyGuideActions).values({
          id: createId('daily_guide_action'),
          taskId: guideTaskId,
          title: action.title,
          instruction: action.instruction,
          checkpoint: action.checkpoint,
          status: 'planned',
          progressNote: null,
          completedAt: null,
          position: actionPosition++
        });
      }
      await this.db.insert(dailyGuideBlocks).values({
        id: createId('daily_guide_block'),
        guideId,
        planBlockId,
        title: task.title,
        position: blockPosition
      });
      blockPosition += 1;
    }

    await this.db.insert(planVersions).values({
      id: createId('plan_version'),
      planId,
      version: 1,
      changeSummary: 'Initial layered guide draft.',
      snapshotJson: JSON.stringify({
        brief: params.brief,
        roadmap: params.roadmap,
        shortPlan: params.shortPlan,
        dailyGuide: params.dailyGuide
      }),
      createdAt: now
    });

    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Daily guide not found after save: ${guideId}`);
    return { goal: params.goal, roadmap: roadmapRows, shortPlan: shortRows, guide };
  }

  async findActiveOrActivateStage(goalId: string): Promise<RoadmapStage | 'goal_completed' | 'stage_review_required' | null> {
    const activeRows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position));

    if (activeRows.length > 1) {
      const now = nowIso();
      const [keep, ...dupes] = activeRows;
      for (const dup of dupes) {
        await this.db
          .update(roadmapStages)
          .set({ status: 'completed', updatedAt: now })
          .where(eq(roadmapStages.id, dup.id));
      }
      return mapRoadmapStage(keep);
    }

    if (activeRows.length === 1) return mapRoadmapStage(activeRows[0]);

    const reviewRows = await this.db
      .select({ id: roadmapStages.id })
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'ready_for_review')))
      .limit(1);
    if (reviewRows.length > 0) return 'stage_review_required';

    const pendingRows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'pending')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    if (pendingRows[0]) {
      const now = nowIso();
      await this.db
        .update(roadmapStages)
        .set({ status: 'active', updatedAt: now })
        .where(eq(roadmapStages.id, pendingRows[0].id));
      return mapRoadmapStage({ ...pendingRows[0], status: 'active', updatedAt: now });
    }

    const allRows = await this.db
      .select({ status: roadmapStages.status })
      .from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId));
    if (allRows.length > 0 && allRows.every((r) => r.status === 'completed')) {
      return 'goal_completed';
    }
    return null;
  }

  async saveRollingPlanDays(params: {
    goalId: string;
    roadmapStageId: string;
    items: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      tasks: string[];
      expectedOutput: string;
      successCriteria: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    const now = nowIso();
    const existingMaxRows = await this.db
      .select({ maxDay: shortPlanDays.dayIndex })
      .from(shortPlanDays)
      .where(eq(shortPlanDays.goalId, params.goalId))
      .orderBy(desc(shortPlanDays.dayIndex))
      .limit(1);
    const baseIndex = existingMaxRows[0]?.maxDay ?? 0;
    const result: ShortPlanDay[] = [];
    for (const item of params.items) {
      const id = createId('short_plan_day');
      const dayIndex = baseIndex + item.dayIndex;
      await this.db.insert(shortPlanDays).values({
        id,
        goalId: params.goalId,
        roadmapStageId: params.roadmapStageId,
        dayIndex,
        date: null,
        sessionStatus: 'pending',
        title: item.title,
        focus: item.focus,
        tasksJson: JSON.stringify(item.tasks),
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria,
        locked: false,
        createdAt: now
      });
      result.push({
        id,
        goalId: params.goalId,
        roadmapStageId: params.roadmapStageId,
        dayIndex,
        date: null,
        sessionStatus: 'pending',
        title: item.title,
        focus: item.focus,
        tasks: item.tasks,
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria,
        locked: false,
        createdAt: now
      });
    }
    return result;
  }
}
