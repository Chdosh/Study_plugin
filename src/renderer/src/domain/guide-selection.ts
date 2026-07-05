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
  const persistedBlockId = learningState?.step?.blockId ?? learningState?.state.activeDailyTaskId ?? null;

  const findTask = (blockId: string | null): DailyGuideTask | null => {
    if (!blockId) return null;
    const found = tasks.find((item) => item.legacyPlanBlockId === blockId) ?? null;
    if (found?.status === 'done') return null;
    return found;
  };

  let task = findTask(activeSession?.blockId ?? null);

  if (!task && persistedBlockId) {
    task = findTask(persistedBlockId);
  }

  if (!task) {
    task = tasks.find((item) => item.status === 'active')
      ?? tasks.find((item) => item.status === 'planned' || item.status === 'deferred')
      ?? null;
  }

  const planBlockId = task?.legacyPlanBlockId ?? null;

  return { task, planBlockId };
}
