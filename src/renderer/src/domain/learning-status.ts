import type { DailyGuideTask } from '../../../shared/types';
import { areAllActionsTerminal } from '../../../shared/learning-flow';

export type LearningTaskPhase =
  | 'executing'
  | 'awaiting_result'
  | 'done';

export interface LearningTaskStatus {
  phase: LearningTaskPhase;
  label: string;
  positionLabel: string;
}

export function deriveLearningTaskStatus(task: DailyGuideTask): LearningTaskStatus {
  if (task.status === 'closed') {
    return status('done', task.closureKind === 'completed' ? '已完成' : '已结束');
  }
  if (areAllActionsTerminal(task.actions)) return status('awaiting_result', '等待提交');

  const openAction = task.actions.find((action) => action.status === 'planned');
  const position = openAction ? task.actions.findIndex((action) => action.id === openAction.id) + 1 : 1;
  return {
    phase: 'executing',
    label: '进行中',
    positionLabel: `步骤 ${Math.min(position, Math.max(task.actions.length, 1))}/${task.actions.length}`
  };
}

function status(phase: LearningTaskPhase, label: string): LearningTaskStatus {
  return { phase, label, positionLabel: label };
}
