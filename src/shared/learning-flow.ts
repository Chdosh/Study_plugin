import type { LearningRuntimeSnapshot } from './types';

export type LearningFlowPhase =
  | 'unavailable'
  | 'ready_to_start'
  | 'learning'
  | 'paused'
  | 'ready_to_submit'
  | 'completed';

export type LearningPrimaryCommand =
  | 'none'
  | 'start'
  | 'resume'
  | 'end_session'
  | 'complete_action'
  | 'submit';

export interface LearningFlow {
  phase: LearningFlowPhase;
  primaryCommand: LearningPrimaryCommand;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canCompleteAction: boolean;
  canSkipAction: boolean;
  canAskQuestion: boolean;
  canSubmit: boolean;
  canTerminate: boolean;
  currentTaskId: string | null;
  currentActionId: string | null;
}

export function areAllActionsTerminal(actions: Array<{ status: string }>): boolean {
  return actions.length > 0
    && actions.every((action) => action.status === 'done' || action.status === 'skipped');
}

export function deriveLearningFlow(snapshot: LearningRuntimeSnapshot | null): LearningFlow {
  if (!snapshot?.dailyGuideTask) {
    return flow('unavailable', 'none', snapshot);
  }

  const task = snapshot.dailyGuideTask;
  if (task.status === 'closed') {
    return flow('completed', 'none', snapshot);
  }

  const allActionsTerminal = areAllActionsTerminal(task.actions);
  if (allActionsTerminal || task.actions.length === 0) {
    return flow('ready_to_submit', 'submit', snapshot);
  }

  if (snapshot.state.sessionStatus === 'paused') {
    return flow('paused', 'resume', snapshot);
  }
  if (snapshot.state.sessionStatus === 'active') {
    return flow('learning', 'complete_action', snapshot);
  }

  return flow('ready_to_start', 'start', snapshot);
}

function flow(
  phase: LearningFlowPhase,
  primaryCommand: LearningPrimaryCommand,
  snapshot: LearningRuntimeSnapshot | null
): LearningFlow {
  const hasTask = Boolean(snapshot?.dailyGuideTask);
  const sessionStatus = snapshot?.state.sessionStatus;
  const interactive = phase === 'learning' || phase === 'paused';
  const canSubmit = hasTask && (
    phase === 'learning'
    || phase === 'paused'
    || phase === 'ready_to_submit'
  );

  return {
    phase,
    primaryCommand,
    canStart: phase === 'ready_to_start',
    canPause: phase === 'learning' && sessionStatus === 'active',
    canResume: phase === 'paused',
    canCompleteAction: phase === 'learning',
    canSkipAction: phase === 'learning',
    canAskQuestion: interactive,
    canSubmit,
    canTerminate: interactive,
    currentTaskId: snapshot?.dailyGuideTask?.id ?? null,
    currentActionId: snapshot?.dailyGuideAction?.id ?? null
  };
}
