import { describe, expect, it } from 'vitest';
import { deriveLearningTaskStatus } from './learning-status';
import type { DailyGuideTask } from '../../../shared/types';

function task(status: DailyGuideTask['status'], actionStatuses: Array<'planned' | 'done' | 'skipped'>): DailyGuideTask {
  const actions = actionStatuses.map((actionStatus, index) => ({
    id: `action-${index + 1}`,
    taskId: 'task-1',
    title: `步骤 ${index + 1}`,
    instruction: '',
    checkpoint: '',
    status: actionStatus,
    progressNote: null,
    completedAt: actionStatus === 'done' ? '2026-07-13T00:00:00.000Z' : null,
    position: index
  }));
  return {
    id: 'task-1', guideId: 'guide-1', roadmapStageId: null, legacyPlanBlockId: null,
    title: '任务', objective: '', scope: '', estimatedMinutes: { min: 10, target: 20, max: 30 },
    actions, deliverable: '', doneWhen: [], quickHint: '', evaluationMode: 'ai', submissionPolicy: 'once_after_task', carryoverAllowed: true,
    status, progressPercent: 0,
    completedActions: actions.filter((action) => action.status !== 'planned').map((action) => action.id),
    remainingActions: actions.filter((action) => action.status === 'planned').map((action) => action.id),
    currentAction: actions.find((action) => action.status === 'planned') ?? null,
    nextStartPoint: null, totalElapsedMinutes: 0, position: 0, createdAt: '', updatedAt: ''
  };
}

describe('deriveLearningTaskStatus', () => {
  it('replaces the impossible 5/4 position with awaiting submission', () => {
    expect(deriveLearningTaskStatus(task('active', ['done', 'done', 'done', 'done']))).toEqual(
      expect.objectContaining({ phase: 'awaiting_result', label: '等待提交', positionLabel: '等待提交' })
    );
  });

  it('expresses evaluation and revision states without step numbers', () => {
    const completed = task('active', ['done']);
    expect(deriveLearningTaskStatus(completed, { evaluationStatus: 'evaluating' })).toEqual(
      expect.objectContaining({ phase: 'evaluating', positionLabel: '评价中' })
    );
    expect(deriveLearningTaskStatus(completed, { evaluationStatus: 'failed' })).toEqual(
      expect.objectContaining({ phase: 'retry_evaluation', positionLabel: '等待重新评价' })
    );
    expect(deriveLearningTaskStatus(completed, { evaluationStatus: 'completed', evaluationResult: 'failed' })).toEqual(
      expect.objectContaining({ phase: 'needs_revision', positionLabel: '等待修改' })
    );
  });
});
