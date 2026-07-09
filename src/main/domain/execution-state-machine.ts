import type {
  DailyGuide,
  DailyGuideAction,
  DailyGuideTask,
  Id,
  LearningEvaluation,
  LearningRuntimeState
} from '../../shared/types';

export type ExecutionDerivedStatus =
  | 'active'
  | 'awaiting_result'
  | 'needs_revision'
  | 'done'
  | 'guide_completed';

export type ExecutionConflictCode =
  | 'active_task_points_to_done_task'
  | 'active_task_points_to_missing_task'
  | 'active_step_points_to_missing_action'
  | 'task_current_action_conflicts_with_active_step';

export interface ExecutionState {
  tasks: DailyGuideTask[];
  activeDailyTaskId: Id | null;
  activeStepId: Id | null;
  status: ExecutionDerivedStatus;
}

export interface ExecutionConflict {
  code: ExecutionConflictCode;
  message: string;
  taskId?: Id;
  actionId?: Id;
}

export type ExecutionResult =
  | { ok: true; state: ExecutionState }
  | { ok: false; state: ExecutionState; conflict: ExecutionConflict };

export interface EvaluationDecisionLike {
  result?: LearningEvaluation['result'];
  recommendedAction?: LearningEvaluation['recommendedAction'];
}

type RuntimePointers = Pick<LearningRuntimeState, 'activeDailyTaskId' | 'activeStepId'>;

export function recoverExecutionState(guide: Pick<DailyGuide, 'tasks'>, runtime: Partial<RuntimePointers> = {}): ExecutionResult {
  const tasks = cloneTasks(guide.tasks);
  const completedState = stateFromSelection(tasks, null, null);
  if (tasks.length > 0 && tasks.every(isTaskDone)) {
    return { ok: true, state: completedState };
  }
  const fallbackState = recoverWithoutRuntime(tasks);

  if (runtime.activeDailyTaskId) {
    const task = findTask(tasks, runtime.activeDailyTaskId);
    if (!task) {
      return conflict(fallbackState,
      {
        code: 'active_task_points_to_missing_task',
        message: 'activeDailyTaskId 指向不存在的主任务。',
        taskId: runtime.activeDailyTaskId
      });
    }
    if (isTaskDone(task)) {
      return conflict(fallbackState, {
        code: 'active_task_points_to_done_task',
        message: 'activeDailyTaskId 指向已完成的主任务。',
        taskId: task.id
      });
    }
    const selected = selectTask(tasks, task.id, runtime.activeStepId ?? undefined);
    const foundStep = !selected.activeStepId || task.actions.some((action) => action.id === selected.activeStepId);
    if (!foundStep) {
      return conflict(selected, {
        code: 'active_step_points_to_missing_action',
        message: 'activeStepId 指向当前主任务中不存在的行动步骤。',
        taskId: task.id,
        actionId: selected.activeStepId ?? undefined
      });
    }
    if (task.currentAction?.id && selected.activeStepId && task.currentAction.id !== selected.activeStepId) {
      return conflict(selected, {
        code: 'task_current_action_conflicts_with_active_step',
        message: '主任务 currentAction 与 runtime activeStepId 不一致。',
        taskId: task.id,
        actionId: selected.activeStepId
      });
    }
    return { ok: true, state: selected };
  }

  return { ok: true, state: fallbackState };
}

export function completeAction(
  state: Pick<ExecutionState, 'tasks' | 'activeDailyTaskId' | 'activeStepId'>,
  actionId: Id = state.activeStepId ?? ''
): ExecutionResult {
  const tasks = cloneTasks(state.tasks);
  const task = state.activeDailyTaskId ? findTask(tasks, state.activeDailyTaskId) : null;
  if (!task || isTaskDone(task)) {
    return conflict(stateFromSelection(tasks, state.activeDailyTaskId, state.activeStepId), {
      code: task ? 'active_task_points_to_done_task' : 'active_task_points_to_missing_task',
      message: task ? '当前主任务已完成，不能继续完成行动步骤。' : '当前主任务不存在。',
      taskId: state.activeDailyTaskId ?? undefined
    });
  }

  const action = task.actions.find((item) => item.id === actionId) ?? null;
  if (!action) {
    return conflict(stateFromSelection(tasks, task.id, state.activeStepId), {
      code: 'active_step_points_to_missing_action',
      message: '要完成的行动步骤不存在。',
      taskId: task.id,
      actionId
    });
  }

  if (action.status === 'done') {
    return { ok: true, state: selectTask(tasks, task.id, task.currentAction?.id ?? nextOpenAction(task)?.id ?? null) };
  }

  action.status = 'done';
  action.completedAt = action.completedAt ?? null;
  const nextAction = task.actions.find((item) => item.position > action.position && item.status !== 'done' && item.status !== 'skipped') ?? null;
  const completedCount = task.actions.filter((item) => item.status === 'done').length;
  task.status = 'active';
  task.progressPercent = task.actions.length > 0 ? Math.round((completedCount / task.actions.length) * 100) : 100;
  task.currentAction = nextAction;
  task.remainingActions = task.actions.filter((item) => item.status !== 'done').map((item) => item.id);
  task.completedActions = task.actions.filter((item) => item.status === 'done').map((item) => item.id);
  task.nextStartPoint = nextAction?.title ?? '行动步骤已完成，可以提交主任务成果。';

  return { ok: true, state: stateFromSelection(tasks, task.id, nextAction?.id ?? null) };
}

export function applyEvaluationResult(
  state: Pick<ExecutionState, 'tasks' | 'activeDailyTaskId' | 'activeStepId'>,
  evaluation: EvaluationDecisionLike
): ExecutionResult {
  const tasks = cloneTasks(state.tasks);
  const task = state.activeDailyTaskId ? findTask(tasks, state.activeDailyTaskId) : null;
  if (!task || isTaskDone(task)) {
    return conflict(stateFromSelection(tasks, state.activeDailyTaskId, state.activeStepId), {
      code: task ? 'active_task_points_to_done_task' : 'active_task_points_to_missing_task',
      message: task ? '当前主任务已完成，不能重复应用评价。' : '当前主任务不存在。',
      taskId: state.activeDailyTaskId ?? undefined
    });
  }

  if (!isPassingEvaluation(evaluation)) {
    task.status = 'active';
    return { ok: true, state: stateFromSelection(tasks, task.id, state.activeStepId, 'needs_revision') };
  }

  task.status = 'done';
  task.progressPercent = 100;
  task.currentAction = null;
  task.nextStartPoint = null;
  task.completedActions = task.actions.map((action) => action.id);
  task.remainingActions = [];

  const nextTask = tasks.find((item) => item.position > task.position && !isTaskDone(item) && item.status !== 'skipped' && item.status !== 'deferred') ?? null;
  if (!nextTask) {
    return { ok: true, state: stateFromSelection(tasks, null, null) };
  }

  const nextAction = nextOpenAction(nextTask);
  nextTask.status = 'active';
  nextTask.currentAction = nextAction;
  nextTask.nextStartPoint = nextAction?.title ?? nextTask.nextStartPoint;
  return { ok: true, state: stateFromSelection(tasks, nextTask.id, nextAction?.id ?? null) };
}

export function isPassingEvaluation(evaluation: EvaluationDecisionLike): boolean {
  return evaluation.result === 'passed'
    || evaluation.recommendedAction === 'complete_task'
    || evaluation.recommendedAction === 'advance';
}

export function deriveExecutionStatus(
  tasks: DailyGuideTask[],
  activeDailyTaskId: Id | null,
  activeStepId: Id | null,
  override?: ExecutionDerivedStatus
): ExecutionDerivedStatus {
  if (override) return override;
  if (tasks.length > 0 && tasks.every(isTaskDone)) return 'guide_completed';
  const task = activeDailyTaskId ? findTask(tasks, activeDailyTaskId) : null;
  if (!task) return 'guide_completed';
  if (isTaskDone(task)) return 'done';
  if (activeStepId && task.actions.some((action) => action.id === activeStepId && action.status !== 'done' && action.status !== 'skipped')) {
    return 'active';
  }
  if (task.actions.length > 0 && task.actions.every((action) => action.status === 'done' || action.status === 'skipped')) {
    return 'awaiting_result';
  }
  return 'active';
}

function selectTask(tasks: DailyGuideTask[], taskId: Id, requestedActionId?: Id | null): ExecutionState {
  const task = findTask(tasks, taskId);
  const actionId = requestedActionId ?? task?.currentAction?.id ?? (task ? nextOpenAction(task)?.id ?? null : null);
  return stateFromSelection(tasks, taskId, actionId);
}

function recoverWithoutRuntime(tasks: DailyGuideTask[]): ExecutionState {
  const activeTask = tasks.find((task) => task.status === 'active' && !isTaskDone(task));
  if (activeTask) return selectTask(tasks, activeTask.id);

  const firstOpenTask = tasks.find((task) => !isTaskDone(task) && task.status !== 'skipped' && task.status !== 'deferred') ?? null;
  if (firstOpenTask) return selectTask(tasks, firstOpenTask.id);

  return stateFromSelection(tasks, null, null);
}

function stateFromSelection(
  tasks: DailyGuideTask[],
  activeDailyTaskId: Id | null,
  activeStepId: Id | null,
  statusOverride?: ExecutionDerivedStatus
): ExecutionState {
  return {
    tasks,
    activeDailyTaskId,
    activeStepId,
    status: deriveExecutionStatus(tasks, activeDailyTaskId, activeStepId, statusOverride)
  };
}

function conflict(state: ExecutionState, conflict: ExecutionConflict): ExecutionResult {
  return { ok: false, state, conflict };
}

function findTask(tasks: DailyGuideTask[], id: Id): DailyGuideTask | null {
  return tasks.find((task) => task.id === id || task.legacyPlanBlockId === id) ?? null;
}

function nextOpenAction(task: DailyGuideTask): DailyGuideAction | null {
  return task.actions.find((action) => action.status !== 'done' && action.status !== 'skipped') ?? null;
}

function isTaskDone(task: DailyGuideTask): boolean {
  return task.status === 'done';
}

function cloneTasks(tasks: DailyGuideTask[]): DailyGuideTask[] {
  return tasks.map((task) => {
    const actions = task.actions.map((action) => ({ ...action }));
    const currentAction = task.currentAction
      ? actions.find((action) => action.id === task.currentAction?.id) ?? { ...task.currentAction }
      : null;
    return {
      ...task,
      actions,
      completedActions: [...task.completedActions],
      remainingActions: [...task.remainingActions],
      doneWhen: [...task.doneWhen],
      estimatedMinutes: { ...task.estimatedMinutes },
      currentAction
    };
  });
}
