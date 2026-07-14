import type { DailyGuideTask, LearningEvaluation, LearningSubmission } from '../../../shared/types';

export type LearningTaskPhase =
  | 'executing'
  | 'awaiting_result'
  | 'evaluating'
  | 'retry_evaluation'
  | 'needs_revision'
  | 'done';

export interface LearningTaskStatus {
  phase: LearningTaskPhase;
  label: string;
  positionLabel: string;
}

type SubmissionState = Pick<LearningSubmission, 'evaluationStatus'> & {
  evaluationResult?: LearningEvaluation['result'];
};

export function deriveLearningTaskStatus(task: DailyGuideTask, submission?: SubmissionState | null): LearningTaskStatus {
  if (task.status === 'done') return status('done', '已完成');
  if (submission?.evaluationStatus === 'evaluating' || submission?.evaluationStatus === 'waiting') {
    return status('evaluating', '评价中');
  }
  if (submission?.evaluationStatus === 'failed') return status('retry_evaluation', '等待重新评价');
  if (submission?.evaluationStatus === 'completed' && submission.evaluationResult && submission.evaluationResult !== 'passed') {
    return status('needs_revision', '等待修改');
  }

  const allActionsTerminal = task.actions.length > 0
    && task.actions.every((action) => action.status === 'done' || action.status === 'skipped');
  if (allActionsTerminal) return status('awaiting_result', '等待提交');

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
