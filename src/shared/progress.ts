export interface ProgressStats {
  completed: number;
  total: number;
  percent: number;
  currentTaskIndex: number;
}

function isActionCompleted(status: string): boolean {
  return status === 'done' || status === 'skipped';
}

function isTaskCompleted(status: string): boolean {
  return status === 'done' || status === 'skipped';
}

export interface TaskLike {
  status: string;
  actions: Array<{ status: string }>;
}

export function computeProgress(tasks: TaskLike[]): ProgressStats {
  if (tasks.length === 0) {
    return { completed: 0, total: 0, percent: 0, currentTaskIndex: -1 };
  }

  const allActions = tasks.flatMap((t) => t.actions);
  const totalActions = allActions.length;

  if (totalActions > 0) {
    const completedActions = allActions.filter((a) => isActionCompleted(a.status)).length;
    const percent = Math.round((completedActions / totalActions) * 100);
    const currentTaskIndex = tasks.findIndex(
      (t) => t.status !== 'done' && t.status !== 'skipped'
    );
    return { completed: completedActions, total: totalActions, percent, currentTaskIndex: currentTaskIndex >= 0 ? currentTaskIndex : tasks.length };
  }

  const completedTasks = tasks.filter((t) => isTaskCompleted(t.status)).length;
  const percent = Math.round((completedTasks / tasks.length) * 100);
  const currentTaskIndex = tasks.findIndex((t) => !isTaskCompleted(t.status));
  return { completed: completedTasks, total: tasks.length, percent, currentTaskIndex: currentTaskIndex >= 0 ? currentTaskIndex : tasks.length };
}

export function computeTaskProgress(actions: Array<{ status: string }>): ProgressStats {
  if (actions.length === 0) {
    return { completed: 0, total: 0, percent: 0, currentTaskIndex: -1 };
  }
  const completed = actions.filter((a) => isActionCompleted(a.status)).length;
  const percent = Math.round((completed / actions.length) * 100);
  return { completed, total: actions.length, percent, currentTaskIndex: actions.findIndex((a) => !isActionCompleted(a.status)) };
}
