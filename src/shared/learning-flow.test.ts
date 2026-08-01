import { describe, expect, it } from 'vitest';
import type { LearningRuntimeSnapshot } from './types';
import { deriveLearningFlow } from './learning-flow';

function snapshot(overrides: Partial<LearningRuntimeSnapshot> = {}): LearningRuntimeSnapshot {
  return {
    state: { sessionStatus: 'active' },
    dailyGuideTask: {
      id: 'task-1',
      status: 'active',
      actions: [{ id: 'action-1', status: 'planned' }]
    },
    dailyGuideAction: { id: 'action-1', status: 'planned' },
    latestSubmission: null,
    latestEvaluation: null,
    latestDecision: null,
    ...overrides
  } as LearningRuntimeSnapshot;
}

describe('deriveLearningFlow', () => {
  it('exposes one primary command while retaining explicit secondary capabilities', () => {
    const flow = deriveLearningFlow(snapshot());

    expect(flow.phase).toBe('learning');
    expect(flow.primaryCommand).toBe('complete_action');
    expect(flow.canCompleteAction).toBe(true);
    expect(flow.canSubmit).toBe(true);
  });

  it('does not let historical background evaluation state replace the current task flow', () => {
    const flow = deriveLearningFlow(snapshot({
      latestSubmission: { evaluationStatus: 'failed' } as LearningRuntimeSnapshot['latestSubmission']
    }));

    expect(flow).toEqual(expect.objectContaining({
      phase: 'learning',
      primaryCommand: 'complete_action',
      canSubmit: true
    }));
  });

  it('makes submission primary only after the Action list is terminal', () => {
    const flow = deriveLearningFlow(snapshot({
      dailyGuideTask: {
        id: 'task-1',
        status: 'active',
        actions: [{ id: 'action-1', status: 'done' }]
      } as unknown as LearningRuntimeSnapshot['dailyGuideTask'],
      dailyGuideAction: null
    }));

    expect(flow.phase).toBe('ready_to_submit');
    expect(flow.primaryCommand).toBe('submit');
    expect(flow.canCompleteAction).toBe(false);
  });

  it('treats closed as the only Task terminal status', () => {
    const flow = deriveLearningFlow(snapshot({
      dailyGuideTask: {
        id: 'task-1',
        status: 'closed',
        closureKind: 'partial',
        actions: []
      } as unknown as LearningRuntimeSnapshot['dailyGuideTask'],
      dailyGuideAction: null
    }));

    expect(flow.phase).toBe('completed');
    expect(flow.primaryCommand).toBe('none');
    expect(flow.canSubmit).toBe(false);
  });
});
