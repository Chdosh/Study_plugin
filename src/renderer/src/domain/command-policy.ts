import type { LearningRuntimeSnapshot } from '../../../shared/types';
import {
  deriveLearningFlow,
  type LearningPrimaryCommand
} from '../../../shared/learning-flow';

export type SessionStatus = 'not_started' | 'active' | 'paused' | 'completed';

export interface CommandPolicy {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canCompleteAction: boolean;
  canSkipAction: boolean;
  canAskQuestion: boolean;
  canSubmit: boolean;
  canTerminate: boolean;
  primaryCommand: LearningPrimaryCommand;
  reasons: Partial<Record<keyof Omit<CommandPolicy, 'reasons'>, string>>;
  currentTaskId: string | null;
  currentActionId: string | null;
  sessionStatus: SessionStatus;
}

export interface VisibleCommandTarget {
  guideId: string;
  taskId: string;
  taskStatus: 'planned' | 'active' | 'deferred' | 'closed';
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
    canAskQuestion: false,
    canSubmit: false,
    canTerminate: false,
    primaryCommand: 'none',
    reasons: {},
    currentTaskId: null,
    currentActionId: null,
    sessionStatus: 'not_started'
  };

  if (!snapshot) {
    return { ...blank, reasons: { canStart: '暂无学习状态' } };
  }

  const targetMismatch = Boolean(visibleTarget && (
    snapshot.dailyGuide?.id !== visibleTarget.guideId ||
    snapshot.dailyGuideTask?.id !== visibleTarget.taskId
  ));
  if (visibleTarget && targetMismatch) {
    const hasOpenSession =
      snapshot.state.sessionStatus === 'active' || snapshot.state.sessionStatus === 'paused';
    const canStart = !hasOpenSession
      && (visibleTarget.taskStatus === 'planned' || visibleTarget.taskStatus === 'active');
    return {
      ...blank,
      canStart,
      canTerminate: hasOpenSession,
      primaryCommand: canStart ? 'start' : hasOpenSession ? 'end_session' : 'none',
      reasons: canStart ? {} : { canStart: '请先处理当前未结束的学习过程。' },
      currentTaskId: visibleTarget.taskId,
      sessionStatus: snapshot.state.sessionStatus === 'active'
        ? 'active'
        : snapshot.state.sessionStatus === 'paused' ? 'paused' : 'not_started'
    };
  }

  const { state, dailyGuide, dailyGuideTask } = snapshot;
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
    task.status === 'closed'
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

  const derived = deriveLearningFlow(snapshot);
  const {
    canStart,
    canPause,
    canResume,
    canCompleteAction,
    canSkipAction,
    canAskQuestion,
    canSubmit,
    canTerminate,
    primaryCommand
  } = derived;

  if (!canStart && sessionStatus === 'active') {
    reasons.canStart = '已有进行中的会话';
  }
  if (!canCompleteAction && !canSkipAction && !derived.currentActionId) {
    reasons.canCompleteAction = '当前没有可执行的操作';
  }

  return {
    canStart,
    canPause,
    canResume,
    canCompleteAction,
    canSkipAction,
    canAskQuestion,
    canSubmit,
    canTerminate,
    primaryCommand,
    reasons,
    currentTaskId: dailyGuideTask.id,
    currentActionId: derived.currentActionId,
    sessionStatus
  };
}
