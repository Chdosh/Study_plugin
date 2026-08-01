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
    requirement: 'optional' as const,
    status: actionStatus,
    progressNote: null,
    completedAt: actionStatus === 'done' ? '2026-07-13T00:00:00.000Z' : null,
    origin: 'guide_generated' as const,
    sourceAiReviewId: null,
    position: index
  }));
  return {
    id: 'task-1', guideId: 'guide-1', roadmapStageId: null,
    title: '任务', objective: '', scope: '', estimatedMinutes: { min: 10, target: 20, max: 30 },
    actions, deliverable: '', doneWhen: [], quickHint: '', evaluationMode: 'ai',
    status, closureKind: null, closureReason: null,
    nextStartPoint: null, position: 0, createdAt: '', updatedAt: ''
  };
}

describe('deriveLearningTaskStatus', () => {
  it('replaces the impossible 5/4 position with awaiting submission', () => {
    expect(deriveLearningTaskStatus(task('active', ['done', 'done', 'done', 'done']))).toEqual(
      expect.objectContaining({ phase: 'awaiting_result', label: '等待提交', positionLabel: '等待提交' })
    );
  });

});
