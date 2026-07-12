import type { LearningRuntimeSnapshot } from '../../../shared/types';

export type SessionStatus = 'not_started' | 'active' | 'paused' | 'completed';

export interface CommandPolicy {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canCompleteAction: boolean;
  canSkipAction: boolean;
  canSkipTask: boolean;
  canAskQuestion: boolean;
  canSubmit: boolean;
  canTerminate: boolean;
  reasons: Partial<Record<keyof Omit<CommandPolicy, 'reasons'>, string>>;
  currentTaskId: string | null;
  currentActionId: string | null;
  sessionStatus: SessionStatus;
}

export function computeCommandPolicy(snapshot: LearningRuntimeSnapshot | null): CommandPolicy {
  const blank: CommandPolicy = {
    canStart: false,
    canPause: false,
    canResume: false,
    canCompleteAction: false,
    canSkipAction: false,
    canSkipTask: false,
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

  const allTasksDone = dailyGuide.tasks.every((t) => t.status === 'done');
  if (allTasksDone) {
    reasons.canStart = '所有任务已完成';
    return {
      ...blank,
      canAskQuestion: false,
      reasons,
      currentTaskId: dailyGuideTask.id,
      sessionStatus
    };
  }

  const taskDone = dailyGuideTask.status === 'done';
  const actionDone = !dailyGuideAction || dailyGuideAction.status !== 'planned';

  const canStart = !allTasksDone && sessionStatus !== 'active';
  const canPause = sessionStatus === 'active';
  const canResume = sessionStatus === 'paused';
  const canCompleteAction = sessionStatus === 'active' && !taskDone && !actionDone;
  const canSkipAction = sessionStatus === 'active' && !taskDone && !actionDone;
  const canSkipTask = sessionStatus === 'active' && !taskDone;
  const canAskQuestion = sessionStatus === 'active' || sessionStatus === 'paused';
  const canSubmit = (sessionStatus === 'active' || sessionStatus === 'paused') && taskDone;
  const canTerminate = sessionStatus === 'paused' || sessionStatus === 'active';

  if (!canStart && !taskDone && sessionStatus === 'active') {
    reasons.canStart = '已有进行中的会话';
  }
  if (!canSubmit && !taskDone) {
    reasons.canSubmit = '任务尚未完成';
  }
  if (!canCompleteAction && !canSkipAction && actionDone && !taskDone) {
    reasons.canCompleteAction = '当前没有可执行的操作';
  }

  return {
    canStart,
    canPause,
    canResume,
    canCompleteAction,
    canSkipAction,
    canSkipTask,
    canAskQuestion,
    canSubmit,
    canTerminate: canTerminate || false,
    reasons,
    currentTaskId: dailyGuideTask.id,
    currentActionId: dailyGuideAction?.id ?? null,
    sessionStatus
  };
}
