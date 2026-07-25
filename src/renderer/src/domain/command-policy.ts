import type { LearningRuntimeSnapshot } from '../../../shared/types';

export type SessionStatus = 'not_started' | 'active' | 'paused' | 'completed';

export interface CommandPolicy {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canCompleteAction: boolean;
  canSkipAction: boolean;
  canCloseTask: boolean;
  canAskQuestion: boolean;
  canSubmit: boolean;
  canTerminate: boolean;
  reasons: Partial<Record<keyof Omit<CommandPolicy, 'reasons'>, string>>;
  currentTaskId: string | null;
  currentActionId: string | null;
  sessionStatus: SessionStatus;
}

export interface VisibleCommandTarget {
  guideId: string;
  taskId: string;
  taskStatus: 'planned' | 'active' | 'done' | 'skipped' | 'deferred';
}

export function computeCommandPolicy(
  snapshot: LearningRuntimeSnapshot | null,
  visibleTarget?: VisibleCommandTarget | null
): CommandPolicy {
  const blank: CommandPolicy = {
    canStart: false,
    canPause: false,
    canResume: false,
    canCompleteAction: false,
    canSkipAction: false,
    canCloseTask: false,
    canAskQuestion: false,
    canSubmit: false,
    canTerminate: false,
    reasons: {},
    currentTaskId: null,
    currentActionId: null,
    sessionStatus: 'not_started'
  };

  if (!snapshot) {
    return { ...blank, reasons: { canStart: '暂无学习状态' } };
  }

  if (snapshot.stageConflict) {
    return { ...blank, reasons: { canStart: '当前任务的阶段归属需要先确认' } };
  }

  const targetMismatch = Boolean(visibleTarget && (
    snapshot.dailyGuide?.id !== visibleTarget.guideId ||
    snapshot.dailyGuideTask?.id !== visibleTarget.taskId
  ));
  if (visibleTarget && targetMismatch) {
    const canStart = visibleTarget.taskStatus === 'planned' || visibleTarget.taskStatus === 'active';
    return {
      ...blank,
      canStart,
      reasons: canStart ? {} : { canStart: '当前任务已结束' },
      currentTaskId: visibleTarget.taskId,
      sessionStatus: 'not_started'
    };
  }

  const { state, dailyGuide, dailyGuideTask, dailyGuideAction } = snapshot;
  const sessionStatus: SessionStatus =
    state.sessionStatus === 'idle' || !state.sessionStatus
      ? 'not_started'
      : state.sessionStatus;

  const reasons: Partial<Record<keyof Omit<CommandPolicy, 'reasons'>, string>> = {};

  if (!dailyGuide || dailyGuide.tasks.length === 0) {
    reasons.canStart = '没有可用的执行稿';
    return { ...blank, reasons, sessionStatus };
  }

  if (!dailyGuideTask) {
    reasons.canStart = '没有可执行的任务';
    return { ...blank, reasons, sessionStatus };
  }

  const allTasksTerminal = dailyGuide.tasks.every((task) =>
    task.status === 'done' || task.status === 'skipped'
  );
  if (allTasksTerminal) {
    reasons.canStart = '当前学习单元中的 Task 均已结束';
    return {
      ...blank,
      canAskQuestion: false,
      reasons,
      currentTaskId: dailyGuideTask.id,
      sessionStatus
    };
  }

  const taskTerminal = dailyGuideTask.status === 'done' || dailyGuideTask.status === 'skipped';
  const actionDone = !dailyGuideAction || dailyGuideAction.status !== 'planned';
  const allActionsTerminal = dailyGuideTask.actions.length > 0
    && dailyGuideTask.actions.every((action) => action.status === 'done' || action.status === 'skipped');

  const canStart = !allTasksTerminal && sessionStatus !== 'active';
  const canPause = sessionStatus === 'active';
  const canResume = sessionStatus === 'paused';
  const canCompleteAction = sessionStatus === 'active' && !taskTerminal && !actionDone;
  const canSkipAction = sessionStatus === 'active' && !taskTerminal && !actionDone;
  const canCloseTask = !taskTerminal;
  const canAskQuestion = sessionStatus === 'active' || sessionStatus === 'paused';
  const canSubmit = !taskTerminal;
  const canTerminate = sessionStatus === 'paused' || sessionStatus === 'active';

  if (!canStart && !taskTerminal && sessionStatus === 'active') {
    reasons.canStart = '已有进行中的会话';
  }
  if (!canCompleteAction && !canSkipAction && actionDone && !taskTerminal) {
    reasons.canCompleteAction = '当前没有可执行的操作';
  }

  return {
    canStart,
    canPause,
    canResume,
    canCompleteAction,
    canSkipAction,
    canCloseTask,
    canAskQuestion,
    canSubmit,
    canTerminate: canTerminate || false,
    reasons,
    currentTaskId: dailyGuideTask.id,
    currentActionId: dailyGuideAction?.id ?? null,
    sessionStatus
  };
}
