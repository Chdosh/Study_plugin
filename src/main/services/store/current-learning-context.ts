import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  CurrentGuideChoice,
  LearningRuntimeState,
  LearningStageConflict,
  LearningUnitRecoveryChoice,
  StudySession
} from '../../../shared/types';
import type { Database } from '../../db/client';
import {
  currentLearningContext,
  focusSessions,
  goals,
  learningActions,
  learningGuides,
  learningTasks,
  nearTermPlanItems
} from '../../db/schema';
import { nowIso } from '../id';
import { mapRuntimeState, mapSession } from './serialization';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type ContextExecutor = Database | DatabaseTransaction;

export interface ResolvedCurrentLearningContext {
  version: number;
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
    const context = await this.ensureContext();
    const activeGoal = context.goalId
      ? (await this.db.select({ id: goals.id }).from(goals)
          .where(and(eq(goals.id, context.goalId), eq(goals.status, 'active'))).limit(1))[0]
      : null;
    const fallbackGoals = activeGoal
      ? []
      : await this.db.select({ id: goals.id }).from(goals)
          .where(eq(goals.status, 'active')).orderBy(desc(goals.createdAt)).limit(2);
    const goalId = activeGoal?.id ?? (fallbackGoals.length === 1 ? fallbackGoals[0].id : null);

    const guide = context.guideId
      ? (await this.db.select().from(learningGuides).where(eq(learningGuides.id, context.guideId)).limit(1))[0]
      : null;
    const fallbackGuides = !guide && goalId
      ? await this.db.select().from(learningGuides)
          .where(and(eq(learningGuides.goalId, goalId), inArray(learningGuides.status, ['active', 'draft'])))
          .orderBy(desc(learningGuides.createdAt)).limit(2)
      : [];
    const selectedGuide = guide ?? (fallbackGuides.length === 1 ? fallbackGuides[0] : null);

    const task = context.taskId
      ? (await this.db.select().from(learningTasks).where(eq(learningTasks.id, context.taskId)).limit(1))[0]
      : null;
    const fallbackTasks = !task && selectedGuide
      ? await this.db.select().from(learningTasks)
          .where(and(eq(learningTasks.guideId, selectedGuide.id), inArray(learningTasks.status, ['planned', 'active', 'deferred'])))
          .orderBy(asc(learningTasks.position)).limit(2)
      : [];
    const selectedTask = task ?? (fallbackTasks.length === 1 ? fallbackTasks[0] : null);
    const selectedAction = selectedTask && context.actionId
      ? (await this.db.select({ id: learningActions.id }).from(learningActions)
          .where(and(
            eq(learningActions.id, context.actionId),
            eq(learningActions.taskId, selectedTask.id)
          )).limit(1))[0] ?? null
      : null;

    const sessionRow = (await this.db.select().from(focusSessions)
      .where(inArray(focusSessions.status, ['active', 'paused']))
      .orderBy(desc(focusSessions.startedAt)).limit(1))[0] ?? null;

    const desired = {
      goalId: selectedTask ? selectedTask.goalId : selectedGuide?.goalId ?? goalId,
      guideId: selectedTask?.guideId ?? selectedGuide?.id ?? null,
      taskId: selectedTask?.id ?? null,
      actionId: selectedAction?.id ?? null
    };
    if (
      desired.goalId !== context.goalId ||
      desired.guideId !== context.guideId ||
      desired.taskId !== context.taskId ||
      desired.actionId !== context.actionId
    ) {
      await this.write(desired);
    }
    const latest = await this.ensureContext();
    const state = mapRuntimeState(latest);
    state.sessionStatus = sessionRow?.status === 'active'
      ? 'active'
      : sessionRow?.status === 'paused'
        ? 'paused'
        : 'idle';
    state.activeStageId = selectedTask?.roadmapStageId ?? null;

    return {
      version: latest.version,
      goalId: latest.goalId,
      activeGuideId: latest.guideId,
      displayGuideId: latest.guideId,
      taskId: latest.taskId,
      actionId: latest.actionId,
      stageId: selectedTask?.roadmapStageId ?? null,
      stageConflict: null,
      session: sessionRow ? mapSession(sessionRow) : null,
      state
    };
  }

  async prepareSessionStart(
    taskId: string,
    executor: ContextExecutor = this.db
  ): Promise<void> {
    const task = (await executor.select().from(learningTasks)
      .where(eq(learningTasks.id, taskId)).limit(1))[0];
    if (!task) throw new Error(`Learning task not found: ${taskId}`);
    const guide = task.guideId
      ? (await executor.select().from(learningGuides)
          .where(eq(learningGuides.id, task.guideId)).limit(1))[0]
      : null;
    if (guide && guide.status === 'archived') throw new Error('该学习单元已归档，不能开始 Session。');
    const firstAction = (await executor.select({ id: learningActions.id }).from(learningActions)
      .where(and(
        eq(learningActions.taskId, taskId),
        eq(learningActions.status, 'planned')
      )).orderBy(asc(learningActions.position)).limit(1))[0] ?? null;
    await this.writeWith(executor, {
      goalId: task.goalId,
      guideId: task.guideId,
      taskId: task.id,
      actionId: firstAction?.id ?? null
    });
  }

  async makeGuideCurrent(guideId: string): Promise<void> {
    const guide = (await this.db.select().from(learningGuides).where(eq(learningGuides.id, guideId)).limit(1))[0];
    if (!guide) throw new Error(`Learning guide not found: ${guideId}`);
    const task = (await this.db.select().from(learningTasks)
      .where(and(eq(learningTasks.guideId, guideId), inArray(learningTasks.status, ['planned', 'active', 'deferred'])))
      .orderBy(asc(learningTasks.position)).limit(1))[0] ?? null;
    await this.write({
      goalId: guide.goalId,
      guideId,
      taskId: task?.id ?? null,
      actionId: null
    });
  }

  async listGuideChoices(): Promise<CurrentGuideChoice[]> {
    const context = await this.ensureContext();
    const guides = await this.db.select().from(learningGuides)
      .where(inArray(learningGuides.status, ['draft', 'active']))
      .orderBy(desc(learningGuides.createdAt));
    const result: CurrentGuideChoice[] = [];
    for (const guide of guides) {
      const tasks = await this.db.select().from(learningTasks)
        .where(eq(learningTasks.guideId, guide.id)).orderBy(asc(learningTasks.position));
      result.push({
        guideId: guide.id,
        date: guide.suggestedDate ?? guide.createdAt.slice(0, 10),
        dayTitle: guide.learningGoal,
        taskTitle: tasks.find((task) => task.status !== 'closed')?.title ?? tasks[0]?.title ?? guide.learningGoal,
        completedTaskCount: tasks.filter((task) => task.closureKind === 'completed').length,
        totalTaskCount: tasks.length,
        hasRecentSession: false,
        isRecommended: result.length === 0,
        isCurrent: context.guideId === guide.id
      });
    }
    return result;
  }

  async selectCurrentGuide(guideId: string): Promise<void> {
    await this.makeGuideCurrent(guideId);
  }

  async listAmbiguousLearningUnits(): Promise<LearningUnitRecoveryChoice[]> {
    return [];
  }

  async resolveAmbiguousLearningUnit(guideId: string, decision: 'restore' | 'skip'): Promise<void> {
    if (decision === 'restore') {
      await this.makeGuideCurrent(guideId);
      return;
    }
    await this.skipGuide(guideId);
  }

  async completeGuide(guideId: string): Promise<string[]> {
    const openTasks = await this.db.select({ id: learningTasks.id }).from(learningTasks)
      .where(and(eq(learningTasks.guideId, guideId), inArray(learningTasks.status, ['planned', 'active', 'deferred'])));
    if (openTasks.length > 0) throw new Error('学习单元仍有未关闭 Task，不能关闭 Guide。');
    await this.db.transaction(async (tx) => {
      await tx.update(learningGuides).set({ status: 'closed' }).where(eq(learningGuides.id, guideId));
      const context = await tx.select().from(currentLearningContext)
        .where(eq(currentLearningContext.id, 'default')).limit(1);
      if (context[0]?.guideId === guideId) {
        await tx.update(currentLearningContext).set({
          guideId: null,
          taskId: null,
          actionId: null,
          version: context[0].version + 1,
          updatedAt: nowIso()
        }).where(eq(currentLearningContext.id, 'default'));
      }
    });
    return [];
  }

  async closeTask(
    taskId: string,
    closureKind: 'completed' | 'partial' | 'abandoned' | 'replaced',
    closureReason?: string,
    nextStartPoint?: string
  ): Promise<void> {
    const now = nowIso();
    const cleanReason = closureReason?.trim() || null;
    const cleanNextStartPoint = nextStartPoint?.trim() || null;
    await this.db.transaction(async (tx) => {
      const task = (await tx.select().from(learningTasks)
        .where(eq(learningTasks.id, taskId)).limit(1))[0];
      if (!task) throw new Error(`Learning task not found: ${taskId}`);
      if (task.status === 'closed') {
        if (
          task.closureKind !== closureKind
          || task.closureReason !== cleanReason
          || task.nextStartPoint !== cleanNextStartPoint
        ) {
          throw new Error('Task 已经以其他结果收口，不能覆盖原收口事实。');
        }
      } else {
        await tx.update(learningTasks).set({
          status: 'closed',
          closureKind,
          closureReason: cleanReason,
          nextStartPoint: cleanNextStartPoint,
          updatedAt: now
        }).where(eq(learningTasks.id, taskId));
      }
      const next = task.guideId
        ? (await tx.select().from(learningTasks).where(and(
            eq(learningTasks.guideId, task.guideId),
            inArray(learningTasks.status, ['planned', 'active', 'deferred'])
          )).orderBy(asc(learningTasks.position)).limit(1))[0] ?? null
        : null;
      const context = (await tx.select().from(currentLearningContext)
        .where(eq(currentLearningContext.id, 'default')).limit(1))[0];
      const guideHasOpenTasks = task.guideId
        ? (await tx.select({ id: learningTasks.id }).from(learningTasks).where(and(
            eq(learningTasks.guideId, task.guideId),
            inArray(learningTasks.status, ['planned', 'active', 'deferred'])
          )).limit(1)).length > 0
        : true;
      if (task.guideId && !guideHasOpenTasks) {
        await tx.update(learningGuides).set({ status: 'closed' })
          .where(eq(learningGuides.id, task.guideId));
      }
      if (context?.taskId === taskId) {
        await tx.update(currentLearningContext).set({
          guideId: task.guideId && !guideHasOpenTasks ? null : context.guideId,
          taskId: next?.id ?? null,
          actionId: null,
          version: context.version + 1,
          updatedAt: now
        }).where(eq(currentLearningContext.id, 'default'));
      }
    });
  }

  async skipGuide(guideId: string): Promise<string[]> {
    await this.db.transaction(async (tx) => {
      await tx.update(learningGuides).set({ status: 'archived' }).where(eq(learningGuides.id, guideId));
      const rows = await tx.select().from(currentLearningContext)
        .where(eq(currentLearningContext.id, 'default')).limit(1);
      if (rows[0]?.guideId === guideId) {
        await tx.update(currentLearningContext).set({
          guideId: null,
          taskId: null,
          actionId: null,
          version: rows[0].version + 1,
          updatedAt: nowIso()
        }).where(eq(currentLearningContext.id, 'default'));
      }
    });
    return [];
  }

  async repair(): Promise<LearningContextRepairResult> {
    const before = await this.ensureContext();
    await this.resolve();
    const after = await this.ensureContext();
    const fixed = JSON.stringify(before) === JSON.stringify(after) ? [] : ['current_learning_context'];
    return { consistent: fixed.length === 0, fixed, conflicts: [] };
  }

  async write(patch: {
    goalId?: string | null;
    guideId?: string | null;
    taskId?: string | null;
    actionId?: string | null;
  }): Promise<void> {
    await this.writeWith(this.db, patch);
  }

  async replaceActionInTransaction(
    executor: ContextExecutor,
    params: {
      expectedVersion: number;
      expectedActionId: string;
      actionId: string;
    }
  ): Promise<boolean> {
    const changed = await executor.update(currentLearningContext).set({
      actionId: params.actionId,
      version: params.expectedVersion + 1,
      updatedAt: nowIso()
    }).where(and(
      eq(currentLearningContext.id, 'default'),
      eq(currentLearningContext.version, params.expectedVersion),
      eq(currentLearningContext.actionId, params.expectedActionId)
    )).returning({ id: currentLearningContext.id });
    return changed.length === 1;
  }

  private async writeWith(
    executor: ContextExecutor,
    patch: {
      goalId?: string | null;
      guideId?: string | null;
      taskId?: string | null;
      actionId?: string | null;
    }
  ): Promise<void> {
    const current = await this.ensureContextWith(executor);
    await executor.update(currentLearningContext).set({
      ...patch,
      version: current.version + 1,
      updatedAt: nowIso()
    }).where(eq(currentLearningContext.id, 'default'));
  }

  private async ensureContext(): Promise<typeof currentLearningContext.$inferSelect> {
    return this.ensureContextWith(this.db);
  }

  private async ensureContextWith(
    executor: ContextExecutor
  ): Promise<typeof currentLearningContext.$inferSelect> {
    const rows = await executor.select().from(currentLearningContext)
      .where(eq(currentLearningContext.id, 'default')).limit(1);
    if (rows[0]) return rows[0];
    const row = {
      id: 'default',
      goalId: null,
      guideId: null,
      taskId: null,
      actionId: null,
      version: 1,
      updatedAt: nowIso()
    };
    await executor.insert(currentLearningContext).values(row);
    return row;
  }
}
