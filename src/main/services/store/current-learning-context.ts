import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CurrentGuideChoice, LearningRuntimeState, LearningStageConflict, LearningUnitRecoveryChoice, StudySession } from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideTasks,
  dailyGuides,
  dailyPlans,
  goals,
  learningRuntimeStates,
  roadmapStages,
  shortPlanDays,
  studySessions
} from '../../db/schema';
import { nowIso } from '../id';
import { mapSession } from './serialization';

const resumableSessionStatuses = ['active', 'paused'] as const;
const sessionTerminalTaskStatuses = ['done', 'skipped'] as const;
const executableTaskStatuses = ['active', 'planned', 'deferred'] as const;

export interface ResolvedCurrentLearningContext {
  goalId: string | null;
  activeGuideId: string | null;
  displayGuideId: string | null;
  taskId: string | null;
  actionId: string | null;
  stageId: string | null;
  stageConflict: LearningStageConflict | null;
  session: StudySession | null;
  state: LearningRuntimeState;
}

export interface LearningContextRepairResult {
  consistent: boolean;
  fixed: string[];
  conflicts: Array<{ field: string; expected: string; actual: string }>;
}

export class CurrentLearningContextPersistence {
  constructor(private readonly db: Database) {}

  async resolve(): Promise<ResolvedCurrentLearningContext> {
    const stateRows = await this.db.select().from(learningRuntimeStates).where(eq(learningRuntimeStates.id, 'default')).limit(1);
    const storedState = stateRows[0] ?? null;
    const activeGoalRows = await this.db.select().from(goals).where(eq(goals.status, 'active')).orderBy(desc(goals.createdAt));
    const storedGoal = storedState?.activeGoalId
      ? activeGoalRows.find((goal) => goal.id === storedState.activeGoalId) ?? null
      : null;
    const goalId = storedGoal?.id ?? activeGoalRows[0]?.id ?? null;

    const guideRows = goalId
      ? await this.db.select().from(dailyGuides).where(eq(dailyGuides.goalId, goalId)).orderBy(desc(dailyGuides.createdAt))
      : [];
    const activeGuideRows = guideRows.filter((guide) =>
      guide.status !== 'archived' && (guide.sessionStatus === 'active' || guide.sessionStatus === 'draft')
    );
    const activeDayRows = goalId
      ? await this.db.select({ id: shortPlanDays.id }).from(shortPlanDays).where(and(
          eq(shortPlanDays.goalId, goalId),
          eq(shortPlanDays.sessionStatus, 'active')
        ))
      : [];
    const usedDayIds = new Set(guideRows.map((guide) => guide.shortPlanDayId).filter(Boolean));
    const hasRecoverableDayWithoutGuide = activeDayRows.some((day) => !usedDayIds.has(day.id));
    const activeGuideIds = activeGuideRows.map((guide) => guide.id);
    const allTaskRows = activeGuideIds.length > 0
      ? await this.db.select().from(dailyGuideTasks).where(inArray(dailyGuideTasks.guideId, activeGuideIds)).orderBy(dailyGuideTasks.position)
      : [];
    const allExecutableTasks = allTaskRows.filter((task) => executableTaskStatuses.includes(task.status as typeof executableTaskStatuses[number]));
    const resumableRows = allExecutableTasks.length > 0
      ? await this.db.select().from(studySessions).where(and(
          inArray(studySessions.taskId, allExecutableTasks.map((task) => task.id)),
          inArray(studySessions.status, resumableSessionStatuses)
        )).orderBy(desc(studySessions.startedAt))
      : [];
    const storedTaskAcrossGuides = storedState?.activeDailyTaskId
      ? allExecutableTasks.find((task) => task.id === storedState.activeDailyTaskId) ?? null
      : null;
    const sessionTaskAcrossGuides = resumableRows[0]?.taskId
      ? allExecutableTasks.find((task) => task.id === resumableRows[0].taskId) ?? null
      : null;
    const activeGuide = activeGuideRows.find((guide) => guide.id === storedTaskAcrossGuides?.guideId)
      ?? activeGuideRows.find((guide) => guide.id === sessionTaskAcrossGuides?.guideId)
      ?? activeGuideRows.find((guide) => allExecutableTasks.some((task) => task.guideId === guide.id))
      ?? activeGuideRows[0]
      ?? null;
    const displayGuide = activeGuide
      ?? (hasRecoverableDayWithoutGuide ? null : guideRows.find((guide) => guide.status !== 'archived') ?? null);
    const executableTasks = activeGuide
      ? allExecutableTasks.filter((task) => task.guideId === activeGuide.id)
      : [];
    const storedTask = storedTaskAcrossGuides?.guideId === activeGuide?.id ? storedTaskAcrossGuides : null;
    const sessionTaskId = sessionTaskAcrossGuides && sessionTaskAcrossGuides.guideId === activeGuide?.id
      ? sessionTaskAcrossGuides.id
      : null;
    const task = executableTasks.find((candidate) => candidate.id === sessionTaskId)
      ?? storedTask
      ?? executableTasks.find((candidate) => candidate.status === 'active')
      ?? executableTasks[0]
      ?? null;
    const sessionRow = task
      ? resumableRows.find((session) => session.taskId === task.id) ?? null
      : null;
    const actionRows = task
      ? await this.db.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, task.id)).orderBy(dailyGuideActions.position)
      : [];
    const storedAction = storedState?.activeStepId
      ? actionRows.find((action) => action.id === storedState.activeStepId) ?? null
      : null;
    const currentAction = task?.currentActionId
      ? actionRows.find((action) => action.id === task.currentActionId && action.status === 'planned') ?? null
      : null;
    const actionId = (
      currentAction
      ?? actionRows.find((action) => action.status === 'planned')
      ?? storedAction
      ?? actionRows.at(-1)
    )?.id ?? null;

    const currentDayRows = activeGuide?.shortPlanDayId
      ? await this.db.select({ roadmapStageId: shortPlanDays.roadmapStageId })
          .from(shortPlanDays)
          .where(eq(shortPlanDays.id, activeGuide.shortPlanDayId))
          .limit(1)
      : [];
    const taskStageId = task?.roadmapStageId ?? null;
    const dayStageId = currentDayRows[0]?.roadmapStageId ?? null;
    const stageRows = goalId
      ? await this.db.select({
          id: roadmapStages.id,
          title: roadmapStages.title,
          status: roadmapStages.status,
          position: roadmapStages.position
        })
          .from(roadmapStages)
          .where(eq(roadmapStages.goalId, goalId))
      : [];
    const stageTitle = new Map(stageRows.map((stage) => [stage.id, stage.title]));
    let stageConflict: LearningStageConflict | null = taskStageId && dayStageId && taskStageId !== dayStageId
      ? {
          kind: 'task_day_mismatch',
          message: '当前任务与近期学习单元的阶段归属不一致，数据已保留，请先确认后再继续。',
          taskStage: { id: taskStageId, title: stageTitle.get(taskStageId) ?? '任务所属阶段' },
          shortPlanDayStage: { id: dayStageId, title: stageTitle.get(dayStageId) ?? '学习单元所属阶段' }
        }
      : null;
    const learningUnitStageId = taskStageId ?? dayStageId;
    const formalStage = [...stageRows]
      .sort((a, b) => a.position - b.position)
      .find((stage) => ['active', 'ready_for_review', 'blocked', 'adjusted'].includes(stage.status));
    if (!stageConflict && learningUnitStageId && formalStage && learningUnitStageId !== formalStage.id) {
      stageConflict = {
        kind: 'formal_stage_mismatch',
        message: '当前学习单元已经进入后续阶段，但学习路线仍停留在前一阶段，数据已保留，请先确认阶段推进。',
        formalStage: { id: formalStage.id, title: formalStage.title },
        learningUnitStage: {
          id: learningUnitStageId,
          title: stageTitle.get(learningUnitStageId) ?? '当前学习单元所属阶段'
        }
      };
    }
    let stageId = stageConflict ? null : taskStageId ?? dayStageId ?? storedState?.activeStageId ?? null;
    if (!stageId && !stageConflict && goalId) {
      const activeStageRows = await this.db.select({ id: roadmapStages.id }).from(roadmapStages).where(and(
        eq(roadmapStages.goalId, goalId),
        inArray(roadmapStages.status, ['active', 'ready_for_review'])
      )).orderBy(roadmapStages.position).limit(1);
      stageId = activeStageRows[0]?.id ?? null;
    }

    const taskUnchanged = Boolean(task && storedState?.activeDailyTaskId === task.id);
    const state: LearningRuntimeState = {
      id: 'default',
      activeGoalId: goalId,
      activeStageId: stageId,
      activeDailyTaskId: task?.id ?? null,
      activeStepId: actionId,
      activeQuestionThreadId: taskUnchanged ? storedState?.activeQuestionThreadId ?? null : null,
      sessionStatus: sessionRow?.status === 'active'
        ? 'active'
        : sessionRow?.status === 'paused'
          ? 'paused'
          : !activeGuide && displayGuide?.sessionStatus === 'closed'
            ? 'completed'
            : 'idle',
      updatedAt: storedState?.updatedAt ?? nowIso()
    };

    return {
      goalId,
      activeGuideId: activeGuide?.id ?? null,
      displayGuideId: displayGuide?.id ?? null,
      taskId: task?.id ?? null,
      actionId,
      stageId,
      stageConflict,
      session: sessionRow ? mapSession(sessionRow) : null,
      state
    };
  }

  async prepareSessionStart(taskId: string): Promise<void> {
    const taskRows = await this.db.select({
      id: dailyGuideTasks.id,
      status: dailyGuideTasks.status,
      guideId: dailyGuideTasks.guideId,
      goalId: dailyGuides.goalId,
      roadmapStageId: dailyGuideTasks.roadmapStageId
    }).from(dailyGuideTasks)
      .innerJoin(dailyGuides, eq(dailyGuides.id, dailyGuideTasks.guideId))
      .where(eq(dailyGuideTasks.id, taskId))
      .limit(1);
    const task = taskRows[0];
    if (!task) throw new Error(`找不到主任务：${taskId}`);
    if (!executableTaskStatuses.includes(task.status as typeof executableTaskStatuses[number])) {
      throw new Error(task.status === 'done'
        ? '当前主任务已完成，不能重新开始学习。'
        : '当前主任务已结束，不能重新开始学习。');
    }
    await this.assertStageCanRun(task.goalId, task.roadmapStageId);
    const current = await this.resolve();
    if (current.goalId !== task.goalId || current.activeGuideId !== task.guideId) {
      throw new Error('所选任务不属于当前学习日，请刷新后从当前任务开始。');
    }

    const goalTaskRows = await this.db.select({ id: dailyGuideTasks.id }).from(dailyGuideTasks)
      .innerJoin(dailyGuides, eq(dailyGuides.id, dailyGuideTasks.guideId))
      .where(eq(dailyGuides.goalId, task.goalId));
    const otherTaskIds = goalTaskRows.map((row) => row.id).filter((id) => id !== taskId);
    if (otherTaskIds.length === 0) return;
    const staleSessions = await this.db.select().from(studySessions).where(and(
      inArray(studySessions.taskId, otherTaskIds),
      inArray(studySessions.status, resumableSessionStatuses)
    ));
    for (const session of staleSessions) await this.completeSessionRow(session);
  }

  async makeGuideCurrent(guideId: string): Promise<void> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) throw new Error(`Daily guide not found: ${guideId}`);
    if (guide.shortPlanDayId) {
      const dayRows = await this.db.select({ roadmapStageId: shortPlanDays.roadmapStageId })
        .from(shortPlanDays)
        .where(eq(shortPlanDays.id, guide.shortPlanDayId))
        .limit(1);
      await this.assertStageCanRun(guide.goalId, dayRows[0]?.roadmapStageId ?? null);
    }
    const otherActiveGuides = await this.db.select().from(dailyGuides).where(and(
      eq(dailyGuides.goalId, guide.goalId),
      inArray(dailyGuides.sessionStatus, ['active', 'draft'])
    ));
    for (const other of otherActiveGuides.filter((candidate) => candidate.id !== guideId)) {
      const tasks = await this.db.select({ status: dailyGuideTasks.status }).from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, other.id));
      if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) {
        await this.completeGuide(other.id);
        continue;
      }
      const unfinished = tasks.some((task) => task.status !== 'done' && task.status !== 'skipped');
      await this.db.update(dailyGuides).set({ sessionStatus: 'closed' }).where(eq(dailyGuides.id, other.id));
      if (other.shortPlanDayId) {
        await this.db.update(shortPlanDays).set({ sessionStatus: unfinished ? 'pending' : 'skipped' }).where(eq(shortPlanDays.id, other.shortPlanDayId));
      }
      await this.completeGuideSessions(other.id);
    }
    await this.db.update(dailyGuides).set({
      sessionStatus: guide.status === 'draft' ? 'draft' : 'active'
    }).where(eq(dailyGuides.id, guideId));
    if (guide.shortPlanDayId) {
      await this.db.update(shortPlanDays).set({
        sessionStatus: 'active',
        locked: guide.status === 'confirmed'
      }).where(eq(shortPlanDays.id, guide.shortPlanDayId));
    }
    const tasks = await this.db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideId)).orderBy(dailyGuideTasks.position);
    const task = tasks.find((candidate) => executableTaskStatuses.includes(candidate.status as typeof executableTaskStatuses[number])) ?? null;
    const actions = task
      ? await this.db.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, task.id)).orderBy(dailyGuideActions.position)
      : [];
    const action = actions.find((candidate) => candidate.status === 'planned') ?? actions.at(-1) ?? null;
    const currentRows = await this.db.select().from(learningRuntimeStates).where(eq(learningRuntimeStates.id, 'default')).limit(1);
    const current = currentRows[0];
    const nextState: typeof learningRuntimeStates.$inferInsert = {
      id: 'default',
      activeGoalId: guide.goalId,
      activeStageId: task?.roadmapStageId ?? current?.activeStageId ?? null,
      activeDailyTaskId: task?.id ?? null,
      activeStepId: action?.id ?? null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle',
      updatedAt: nowIso()
    };
    await this.db.insert(learningRuntimeStates).values(nextState).onConflictDoUpdate({
      target: learningRuntimeStates.id,
      set: nextState
    });
  }

  private async assertStageCanRun(goalId: string, stageId: string | null): Promise<void> {
    if (!stageId) return;
    const stages = await this.db.select().from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId))
      .orderBy(roadmapStages.position);
    const target = stages.find((stage) => stage.id === stageId);
    if (!target) throw new Error('当前任务关联的学习阶段不存在，请重新生成学习单元。');
    if (target.status !== 'pending') return;

    const blocking = stages.find((stage) => stage.position < target.position && stage.status !== 'completed');
    if (blocking) {
      throw new Error(`“${blocking.title}”尚未完成并确认，不能开始“${target.title}”。请先完成阶段复盘。`);
    }
    throw new Error(`“${target.title}”尚未正式激活，请先确认上一阶段成果。`);
  }

  async listGuideChoices(): Promise<CurrentGuideChoice[]> {
    const context = await this.resolve();
    if (!context.goalId) return [];
    const guides = await this.getActiveGuideRows(context.goalId);
    if (guides.length < 2) return [];
    const guideIds = guides.map((guide) => guide.id);
    const tasks = await this.db.select().from(dailyGuideTasks).where(inArray(dailyGuideTasks.guideId, guideIds)).orderBy(dailyGuideTasks.position);
    const candidateGuides = guides.filter((guide) => tasks.some((task) =>
      task.guideId === guide.id && executableTaskStatuses.includes(task.status as typeof executableTaskStatuses[number])
    ));
    const candidateIds = new Set(candidateGuides.map((guide) => guide.id));
    const candidateTasks = tasks.filter((task) => candidateIds.has(task.guideId));
    const sessions = candidateTasks.length > 0
      ? await this.db.select().from(studySessions).where(inArray(studySessions.taskId, candidateTasks.map((task) => task.id))).orderBy(desc(studySessions.startedAt))
      : [];
    const taskGuide = new Map(candidateTasks.map((task) => [task.id, task.guideId]));
    const recentSessionGuideId = sessions.map((session) => session.taskId ? taskGuide.get(session.taskId) : null).find(Boolean) ?? null;
    const recommendedGuideId = recentSessionGuideId ?? context.activeGuideId ?? candidateGuides[0]?.id ?? null;
    const dayIds = candidateGuides.map((guide) => guide.shortPlanDayId).filter((id): id is string => Boolean(id));
    const days = dayIds.length > 0
      ? await this.db.select().from(shortPlanDays).where(inArray(shortPlanDays.id, dayIds))
      : [];
    const dayTitle = new Map(days.map((day) => [day.id, day.title]));

    return candidateGuides.map((guide) => {
      const guideTasks = candidateTasks.filter((task) => task.guideId === guide.id);
      const task = guideTasks.find((item) => item.status === 'active')
        ?? guideTasks.find((item) => item.status === 'planned' || item.status === 'deferred')
        ?? guideTasks[0];
      return {
        guideId: guide.id,
        date: guide.date,
        dayTitle: (guide.shortPlanDayId && dayTitle.get(guide.shortPlanDayId)) || guide.todayGoal,
        taskTitle: task?.title ?? '等待选择任务',
        completedTaskCount: guideTasks.filter((item) => item.status === 'done').length,
        totalTaskCount: guideTasks.length,
        hasRecentSession: guide.id === recentSessionGuideId,
        isRecommended: guide.id === recommendedGuideId,
        isCurrent: guide.id === context.activeGuideId
      };
    });
  }

  async selectCurrentGuide(guideId: string): Promise<void> {
    const choices = await this.listGuideChoices();
    if (!choices.some((choice) => choice.guideId === guideId)) {
      throw new Error('这个学习日已不在待确认列表中，请重新检查学习进度。');
    }
    await this.makeGuideCurrent(guideId);
  }

  async listAmbiguousLearningUnits(): Promise<LearningUnitRecoveryChoice[]> {
    const activeGoals = await this.db.select({ id: goals.id }).from(goals).where(eq(goals.status, 'active'));
    const choices: LearningUnitRecoveryChoice[] = [];
    for (const goal of activeGoals) {
      const closedGuides = await this.db.select().from(dailyGuides).where(and(
        eq(dailyGuides.goalId, goal.id),
        eq(dailyGuides.sessionStatus, 'closed')
      ));
      for (const guide of closedGuides) {
        if (!guide.shortPlanDayId) continue;
        const days = await this.db.select().from(shortPlanDays).where(and(
          eq(shortPlanDays.id, guide.shortPlanDayId),
          eq(shortPlanDays.sessionStatus, 'pending')
        )).limit(1);
        if (!days[0]) continue;
        const tasks = await this.db.select().from(dailyGuideTasks)
          .where(eq(dailyGuideTasks.guideId, guide.id))
          .orderBy(dailyGuideTasks.position);
        const hasUnfinished = tasks.some((task) => !sessionTerminalTaskStatuses.includes(task.status as typeof sessionTerminalTaskStatuses[number]));
        if (!hasUnfinished) continue;
        choices.push({
          guideId: guide.id,
          date: guide.date,
          dayTitle: days[0].title || guide.todayGoal,
          taskTitles: tasks.map((task) => task.title),
          completedTaskCount: tasks.filter((task) => task.status === 'done').length,
          skippedTaskCount: tasks.filter((task) => task.status === 'skipped').length,
          totalTaskCount: tasks.length
        });
      }
    }
    return choices;
  }

  async resolveAmbiguousLearningUnit(guideId: string, decision: 'restore' | 'skip'): Promise<void> {
    const choices = await this.listAmbiguousLearningUnits();
    if (!choices.some((choice) => choice.guideId === guideId)) {
      throw new Error('这个学习单元已不在待确认列表中，请重新检查学习进度。');
    }
    if (decision === 'restore') {
      await this.makeGuideCurrent(guideId);
      return;
    }
    const tasks = await this.db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideId));
    const unfinishedIds = tasks
      .filter((task) => !sessionTerminalTaskStatuses.includes(task.status as typeof sessionTerminalTaskStatuses[number]))
      .map((task) => task.id);
    if (unfinishedIds.length > 0) {
      await this.db.update(dailyGuideActions).set({ status: 'skipped', completedAt: nowIso() }).where(and(
        inArray(dailyGuideActions.taskId, unfinishedIds),
        eq(dailyGuideActions.status, 'planned')
      ));
      await this.db.update(dailyGuideTasks).set({
        status: 'skipped',
        currentActionId: null,
        nextStartPoint: null,
        updatedAt: nowIso()
      }).where(inArray(dailyGuideTasks.id, unfinishedIds));
    }
    await this.skipGuide(guideId);
  }

  async completeGuide(guideId: string): Promise<string[]> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) throw new Error('Guide not found');
    await this.db.update(dailyGuides).set({ status: 'completed', sessionStatus: 'closed' }).where(eq(dailyGuides.id, guideId));
    await this.db.update(dailyPlans).set({ status: 'completed' }).where(eq(dailyPlans.id, guide.planId));
    if (guide.shortPlanDayId) {
      await this.db.update(shortPlanDays).set({ sessionStatus: 'completed', locked: true }).where(eq(shortPlanDays.id, guide.shortPlanDayId));
    }
    return this.completeGuideSessions(guideId);
  }

  async skipGuide(guideId: string): Promise<string[]> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) throw new Error('Guide not found');
    await this.db.update(dailyGuides).set({ status: 'confirmed', sessionStatus: 'closed' }).where(eq(dailyGuides.id, guideId));
    await this.db.update(dailyPlans).set({ status: 'completed' }).where(eq(dailyPlans.id, guide.planId));
    if (guide.shortPlanDayId) {
      await this.db.update(shortPlanDays).set({ sessionStatus: 'skipped', locked: true }).where(eq(shortPlanDays.id, guide.shortPlanDayId));
    }
    return this.completeGuideSessions(guideId);
  }

  async repair(): Promise<LearningContextRepairResult> {
    const fixed: string[] = [];
    const conflicts: LearningContextRepairResult['conflicts'] = [];
    const activeGoals = await this.db.select({ id: goals.id }).from(goals).where(eq(goals.status, 'active'));

    for (const goal of activeGoals) {
      let activeGuides = await this.getActiveGuideRows(goal.id);
      for (const guide of activeGuides) {
        const tasks = await this.db.select({ status: dailyGuideTasks.status }).from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guide.id));
        if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) {
          const completedSessionIds = await this.completeGuide(guide.id);
          for (const sessionId of completedSessionIds) fixed.push(`terminal task Session completed → ${sessionId}`);
          fixed.push(`completed Guide lifecycle → ${guide.id}`);
        }
      }

      activeGuides = await this.getActiveGuideRows(goal.id);
      if (activeGuides.length > 1) {
        conflicts.push({
          field: 'dailyGuides.current',
          expected: 'one explicitly selected current Guide; unfinished Guides remain recoverable',
          actual: activeGuides.map((guide) => guide.id).join(',')
        });
      }

      const confirmedGuides = await this.db.select({ shortPlanDayId: dailyGuides.shortPlanDayId }).from(dailyGuides).where(and(
        eq(dailyGuides.goalId, goal.id),
        eq(dailyGuides.status, 'confirmed')
      ));
      const confirmedDayIds = confirmedGuides.map((guide) => guide.shortPlanDayId).filter((id): id is string => Boolean(id));
      if (confirmedDayIds.length > 0) {
        const unlocked = await this.db.select({ id: shortPlanDays.id }).from(shortPlanDays).where(and(
          inArray(shortPlanDays.id, confirmedDayIds),
          eq(shortPlanDays.locked, false)
        ));
        if (unlocked.length > 0) {
          await this.db.update(shortPlanDays).set({ locked: true }).where(inArray(shortPlanDays.id, unlocked.map((day) => day.id)));
          fixed.push(`confirmed ShortPlanDays locked: ${unlocked.length}`);
        }
      }

      const closedGuides = await this.db.select().from(dailyGuides).where(and(
        eq(dailyGuides.goalId, goal.id),
        eq(dailyGuides.sessionStatus, 'closed')
      ));
      for (const guide of closedGuides) {
        if (!guide.shortPlanDayId) continue;
        const pendingDays = await this.db.select({ id: shortPlanDays.id }).from(shortPlanDays).where(and(
          eq(shortPlanDays.id, guide.shortPlanDayId),
          eq(shortPlanDays.sessionStatus, 'pending')
        )).limit(1);
        if (!pendingDays[0]) continue;
        const tasks = await this.db.select({ status: dailyGuideTasks.status }).from(dailyGuideTasks)
          .where(eq(dailyGuideTasks.guideId, guide.id));
        if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) {
          await this.completeGuide(guide.id);
          fixed.push('已根据全部完成的任务修复一个历史学习单元状态');
        } else if (tasks.length > 0 && tasks.every((task) => task.status === 'skipped')) {
          await this.skipGuide(guide.id);
          fixed.push('已根据全部跳过的任务修复一个历史学习单元状态');
        }
      }

      const activeDays = await this.db.select().from(shortPlanDays).where(and(
        eq(shortPlanDays.goalId, goal.id),
        eq(shortPlanDays.sessionStatus, 'active')
      ));
      const usedDayRows = await this.db.select({ shortPlanDayId: dailyGuides.shortPlanDayId }).from(dailyGuides).where(eq(dailyGuides.goalId, goal.id));
      const usedDayIds = new Set(usedDayRows.map((row) => row.shortPlanDayId).filter(Boolean));
      const orphanDays = activeDays.filter((day) => !usedDayIds.has(day.id));
      if (orphanDays.length > 1) {
        conflicts.push({
          field: 'shortPlanDays.current',
          expected: 'at most one recoverable active day without a Guide',
          actual: orphanDays.map((day) => day.id).join(',')
        });
      }
    }

    const ambiguousUnits = await this.listAmbiguousLearningUnits();
    if (ambiguousUnits.length > 0) {
      conflicts.push({
        field: 'learningUnits.lifecycle',
        expected: '由用户确认恢复或跳过历史学习单元',
        actual: `${ambiguousUnits.length} 个学习单元的数据状态无法自动判断`
      });
    }

    let context = await this.resolve();
    const resumableSessions = await this.db.select().from(studySessions).where(inArray(studySessions.status, resumableSessionStatuses));
    const validSessions: typeof resumableSessions = [];
    for (const session of resumableSessions) {
      if (!session.taskId) {
        conflicts.push({ field: 'focusSession.taskId', expected: 'a valid DailyGuideTask', actual: 'null' });
        continue;
      }
      const taskRows = await this.db.select({
        status: dailyGuideTasks.status,
        guideId: dailyGuideTasks.guideId,
        goalId: dailyGuides.goalId
      }).from(dailyGuideTasks)
        .innerJoin(dailyGuides, eq(dailyGuides.id, dailyGuideTasks.guideId))
        .where(eq(dailyGuideTasks.id, session.taskId))
        .limit(1);
      const task = taskRows[0];
      if (!task) {
        conflicts.push({ field: 'focusSession.taskId', expected: 'an existing DailyGuideTask', actual: session.taskId });
      } else if (sessionTerminalTaskStatuses.includes(task.status as typeof sessionTerminalTaskStatuses[number])) {
        await this.completeSessionRow(session);
        fixed.push(`terminal task Session completed → ${session.id}`);
      } else if (!context.activeGuideId || task.guideId !== context.activeGuideId || task.goalId !== context.goalId) {
        await this.completeSessionRow(session);
        fixed.push(`cross-Guide Session completed → ${session.id}`);
      } else {
        validSessions.push(session);
      }
    }

    if (validSessions.length > 1) {
      const sorted = [...validSessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      const [keep, ...stale] = sorted;
      for (const session of stale) await this.completeSessionRow(session);
      fixed.push(`focusSessions cleaned: kept ${keep.id}, completed ${stale.length} stale`);
    }

    context = await this.resolve();
    const storedRows = await this.db.select().from(learningRuntimeStates).where(eq(learningRuntimeStates.id, 'default')).limit(1);
    const stored = storedRows[0] ?? null;
    const nextState = { ...context.state, updatedAt: nowIso() };
    const changed = !stored ||
      stored.activeGoalId !== nextState.activeGoalId ||
      stored.activeStageId !== nextState.activeStageId ||
      stored.activeDailyTaskId !== nextState.activeDailyTaskId ||
      stored.activeStepId !== nextState.activeStepId ||
      stored.activeQuestionThreadId !== nextState.activeQuestionThreadId ||
      stored.sessionStatus !== nextState.sessionStatus;
    if (changed) {
      await this.db.insert(learningRuntimeStates).values(nextState).onConflictDoUpdate({
        target: learningRuntimeStates.id,
        set: {
          activeGoalId: nextState.activeGoalId,
          activeStageId: nextState.activeStageId,
          activeDailyTaskId: nextState.activeDailyTaskId,
          activeStepId: nextState.activeStepId,
          activeQuestionThreadId: nextState.activeQuestionThreadId,
          sessionStatus: nextState.sessionStatus,
          updatedAt: nextState.updatedAt
        }
      });
      if (stored?.activeGoalId !== nextState.activeGoalId) fixed.push(`activeGoalId → ${nextState.activeGoalId ?? 'null'}`);
      if (context.session && (!stored?.activeDailyTaskId || stored.sessionStatus !== nextState.sessionStatus)) {
        fixed.push(`focusSession → ${context.session.id}:${nextState.sessionStatus}`);
      }
      fixed.push(`CurrentLearningContext → ${context.activeGuideId ?? 'none'}:${context.taskId ?? 'none'}`);
    }

    return { consistent: conflicts.length === 0, fixed, conflicts };
  }

  private async getActiveGuideRows(goalId: string) {
    return this.db.select().from(dailyGuides).where(and(
      eq(dailyGuides.goalId, goalId),
      inArray(dailyGuides.sessionStatus, ['active', 'draft'])
    )).orderBy(desc(dailyGuides.createdAt));
  }

  private async completeGuideSessions(guideId: string): Promise<string[]> {
    const taskRows = await this.db.select({ id: dailyGuideTasks.id }).from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideId));
    if (taskRows.length === 0) return [];
    const sessions = await this.db.select().from(studySessions).where(and(
      inArray(studySessions.taskId, taskRows.map((task) => task.id)),
      inArray(studySessions.status, resumableSessionStatuses)
    ));
    for (const session of sessions) await this.completeSessionRow(session);
    return sessions.map((session) => session.id);
  }

  private async completeSessionRow(session: typeof studySessions.$inferSelect): Promise<void> {
    const endedAt = nowIso();
    const previousSeconds = Math.round((session.durationMinutes ?? 0) * 60);
    const currentSeconds = session.status === 'active'
      ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : 0;
    await this.db.update(studySessions).set({
      status: 'completed',
      endedAt,
      durationMinutes: (previousSeconds + currentSeconds) / 60
    }).where(eq(studySessions.id, session.id));
  }
}
