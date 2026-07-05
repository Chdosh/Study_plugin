import type { DailyGuideTask, LearningRuntimeSnapshot, StudySession } from '../../../shared/types';

export interface CurrentGuideTaskSelection {
  task: DailyGuideTask | null;
  planBlockId: string | null;
}

export function getCurrentGuideTaskSelection(
  tasks: DailyGuideTask[],
  activeSession: StudySession | null,
  learningState: LearningRuntimeSnapshot | null
): CurrentGuideTaskSelection {
  const persistedTaskId = learningState?.state.activeDailyTaskId ?? null;

  const findTask = (taskId: string | null): DailyGuideTask | null => {
    if (!taskId) return null;
    const found = tasks.find((item) => item.id === taskId) ?? null;
    if (found?.status === 'done') return null;
    return found;
  };

  let task = findTask(activeSession?.taskId ?? null);

  if (!task && persistedTaskId) {
    task = findTask(persistedTaskId);
  }

  if (!task) {
    task = tasks.find((item) => item.status === 'active')
      ?? tasks.find((item) => item.status === 'planned' || item.status === 'deferred')
      ?? null;
  }

  return { task, planBlockId: task?.legacyPlanBlockId ?? null };
}
