import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  DailyGuide,
  GoalBrief,
  LearningGoal,
  RoadmapStage,
  NearTermPlanItem,
  StudyWindow
} from '../../../shared/types';
import type {
  DailyGuideAgentOutput,
  RoadmapAgentOutput,
  ShortPlanAgentOutput
} from '../../../shared/schemas';
import type { Database } from '../../db/client';
import {
  learningActions,
  learningGuides,
  learningTasks,
  nearTermPlanItems,
  planVersions,
  roadmapStages
} from '../../db/schema';
import { createId, nowIso } from '../id';
import { mapNearTermPlanItem, mapRoadmapStage } from './serialization';

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
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: NearTermPlanItem[]; guide: DailyGuide }> {
    validateRoadmapTargetDates(
      params.goal.dueDate,
      params.roadmap.stages,
      params.date
    );
    for (const item of params.shortPlan.items) {
      if (item.roadmapStagePosition < 1 || item.roadmapStagePosition > params.roadmap.stages.length) {
        throw new Error(`近期计划项 ${item.itemIndex} 引用了不存在的 Roadmap Stage。`);
      }
    }
    const now = nowIso();
    const result = await this.db.transaction(async (tx) => {
      const roadmap: RoadmapStage[] = [];
      for (const [position, stage] of params.roadmap.stages.entries()) {
        const row = {
          id: createId('stage'),
          goalId: params.goal.id,
          title: stage.title,
          objective: stage.objective,
          direction: stage.direction,
          successCriteria: stage.successCriteria,
          targetDate: stage.targetDate,
          status: position === 0 ? 'active' as const : 'pending' as const,
          position,
          createdAt: now,
          updatedAt: now
        };
        await tx.insert(roadmapStages).values(row);
        roadmap.push(row);
      }
      const shortPlan: NearTermPlanItem[] = [];
      let firstItemId: string | null = null;
      for (const item of params.shortPlan.items) {
        const stage = roadmap[item.roadmapStagePosition - 1];
        if (!stage) throw new Error('近期计划项无法映射到 Roadmap Stage。');
        const row = {
          id: createId('plan_item'),
          goalId: params.goal.id,
          roadmapStageId: stage.id,
          itemIndex: item.itemIndex,
          suggestedDate: null,
          status: item.itemIndex === 1 ? 'active' as const : 'pending' as const,
          title: item.title,
          focus: item.focus,
          tasksJson: JSON.stringify(item.tasks),
          expectedOutput: item.expectedOutput,
          successCriteria: item.successCriteria,
          createdAt: now
        };
        await tx.insert(nearTermPlanItems).values(row);
        firstItemId ??= row.id;
        shortPlan.push(mapNearTermPlanItem(row));
      }
      if (!firstItemId || !roadmap[0]) throw new Error('分层计划缺少首个可执行项。');
      const guideId = createId('guide');
      await tx.insert(learningGuides).values({
        id: guideId,
        goalId: params.goal.id,
        nearTermPlanItemId: firstItemId,
        suggestedDate: null,
        status: 'draft',
        weekFocus: params.shortPlan.weekFocus,
        learningGoal: params.dailyGuide.todayGoal,
        deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
        boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
        acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
        nextActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
        createdAt: now,
        confirmedAt: null
      });
      for (const [position, task] of params.dailyGuide.tasks.entries()) {
        const taskId = createId('task');
        await tx.insert(learningTasks).values({
          id: taskId,
          goalId: params.goal.id,
          guideId,
          roadmapStageId: roadmap[0].id,
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
      await tx.insert(planVersions).values({
        id: createId('plan_version'),
        goalId: params.goal.id,
        version: 1,
        changeSummary: '建立初始分层学习路径',
        snapshotJson: JSON.stringify({
          brief: params.brief,
          roadmap: params.roadmap,
          shortPlan: params.shortPlan,
          guideId
        }),
        createdAt: now
      });
      return { roadmap, shortPlan, guideId };
    });
    const guide = await this.getDailyGuideById(result.guideId);
    if (!guide) throw new Error('初始 Learning Guide 保存后无法读取。');
    return { goal: params.goal, roadmap: result.roadmap, shortPlan: result.shortPlan, guide };
  }

  async findActiveOrActivateStage(
    goalId: string
  ): Promise<RoadmapStage | 'goal_completed' | 'stage_review_required' | null> {
    const active = await this.db.select().from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position));
    if (active[0]) return mapRoadmapStage(active[0]);
    const review = await this.db.select({ id: roadmapStages.id }).from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'ready_for_review'))).limit(1);
    if (review[0]) return 'stage_review_required';
    const pending = (await this.db.select().from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'pending')))
      .orderBy(asc(roadmapStages.position)).limit(1))[0];
    if (pending) {
      const now = nowIso();
      await this.db.update(roadmapStages).set({ status: 'active', updatedAt: now })
        .where(eq(roadmapStages.id, pending.id));
      return mapRoadmapStage({ ...pending, status: 'active', updatedAt: now });
    }
    const all = await this.db.select({ status: roadmapStages.status }).from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId));
    return all.length > 0 && all.every((item) => item.status === 'completed')
      ? 'goal_completed'
      : null;
  }

  async saveRollingPlanDays(params: {
    goalId: string;
    roadmapStageId: string;
    items: Array<{
      itemIndex: number;
      title: string;
      focus: string;
      tasks: string[];
      expectedOutput: string;
      successCriteria: string;
    }>;
  }): Promise<NearTermPlanItem[]> {
    const now = nowIso();
    const max = (await this.db.select({ itemIndex: nearTermPlanItems.itemIndex }).from(nearTermPlanItems)
      .where(eq(nearTermPlanItems.goalId, params.goalId))
      .orderBy(desc(nearTermPlanItems.itemIndex)).limit(1))[0]?.itemIndex ?? 0;
    const rows: NearTermPlanItem[] = [];
    for (const item of params.items) {
      const row = {
        id: createId('plan_item'),
        goalId: params.goalId,
        roadmapStageId: params.roadmapStageId,
        itemIndex: max + item.itemIndex,
        suggestedDate: null,
        status: 'pending' as const,
        title: item.title,
        focus: item.focus,
        tasksJson: JSON.stringify(item.tasks),
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria,
        createdAt: now
      };
      await this.db.insert(nearTermPlanItems).values(row);
      rows.push(mapNearTermPlanItem(row));
    }
    return rows;
  }
}

function validateRoadmapTargetDates(
  goalDueDate: string | null,
  stages: RoadmapAgentOutput['stages'],
  planDate: string
): void {
  if (!goalDueDate) {
    if (stages.some((stage) => stage.targetDate !== null)) {
      throw new Error('Goal 没有截止日期，Roadmap 不得自行创建阶段日期。');
    }
    return;
  }
  if (stages.some((stage) => stage.targetDate === null)) {
    throw new Error('有截止日期的 Goal 必须为每个 Roadmap Stage 提供检查点日期。');
  }
  let previous = planDate;
  for (const stage of stages) {
    const targetDate = stage.targetDate!;
    if (targetDate < previous) {
      throw new Error('Roadmap Stage 检查点日期必须按阶段顺序排列。');
    }
    if (targetDate > goalDueDate) {
      throw new Error('Roadmap Stage 检查点日期不能超过 Goal 截止日期。');
    }
    previous = targetDate;
  }
}
