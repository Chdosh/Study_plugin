import type {
  DailyGuideAction,
  DailyGuideTask,
  LearningRuntimeSnapshot,
  StudySession
} from '../../../shared/types';
import type { StudyViewTarget } from '../types/navigation';
import { getCurrentGuideTaskSelection } from './guide-selection';

export interface ResolvedStudyView {
  mode: 'execution' | 'read_only';
  task: DailyGuideTask | null;
  action: DailyGuideAction | null;
}

export function resolveStudyView(
  tasks: DailyGuideTask[],
  activeSession: StudySession | null,
  learningState: LearningRuntimeSnapshot | null,
  target: StudyViewTarget
): ResolvedStudyView {
  if (target.kind === 'review') {
    const task = tasks.find((item) => item.id === target.taskId) ?? null;
    const action = task?.actions.find((item) => item.id === target.actionId) ?? null;
    if (task && action && (action.status === 'done' || action.status === 'skipped')) {
      return { mode: 'read_only', task, action };
    }
  }

  const task = getCurrentGuideTaskSelection(tasks, activeSession, learningState).task;
  const action = task?.actions.find((item) => item.status === 'planned') ?? null;
  return { mode: 'execution', task, action };
}
