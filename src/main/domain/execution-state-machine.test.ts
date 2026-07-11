import { describe, expect, it } from 'vitest';
import type { DailyGuideAction, DailyGuideTask } from '../../shared/types';
import {
  applyEvaluationResult,
  completeAction,
  recoverExecutionState,
  skipAction,
  skipTask
} from './execution-state-machine';

describe('execution-state-machine', () => {
  it('普通行动步骤完成后进入下一步骤', () => {
    const state = stateWithTasks([task('task-1', ['action-1', 'action-2'], { currentActionId: 'action-1' })], 'task-1', 'action-1');

    const result = completeAction(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.state.activeDailyTaskId).toBe('task-1');
    expect(result.state.activeStepId).toBe('action-2');
    expect(result.state.tasks[0].actions[0].status).toBe('done');
    expect(result.state.tasks[0].currentAction?.id).toBe('action-2');
    expect(result.state.tasks[0].status).toBe('active');
  });

  it('最后行动步骤完成后等待主任务提交，不直接推进下一任务', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1'], { currentActionId: 'action-1' }),
      task('task-2', ['action-2'])
    ], 'task-1', 'action-1');

    const result = completeAction(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('awaiting_result');
    expect(result.state.activeDailyTaskId).toBe('task-1');
    expect(result.state.activeStepId).toBe('action-1');
    expect(result.state.tasks[0].status).toBe('active');
    expect(result.state.tasks[0].progressPercent).toBe(100);
    expect(result.state.tasks[1].status).toBe('planned');
  });

  it('已完成步骤被重复完成时不会重复推进', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1', 'action-2'], {
        currentActionId: 'action-2',
        doneActionIds: ['action-1']
      })
    ], 'task-1', 'action-2');

    const result = completeAction(state, 'action-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.activeStepId).toBe('action-2');
    expect(result.state.tasks[0].actions.map((action) => action.status)).toEqual(['done', 'planned']);
    expect(result.state.tasks[0].progressPercent).toBe(50);
  });

  it('评价未通过后仍停留当前任务', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1'], { doneActionIds: ['action-1'], currentActionId: null }),
      task('task-2', ['action-2'])
    ], 'task-1', null);

    const result = applyEvaluationResult(state, { result: 'failed', recommendedAction: 'remediate' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('needs_revision');
    expect(result.state.activeDailyTaskId).toBe('task-1');
    expect(result.state.activeStepId).toBeNull();
    expect(result.state.tasks[0].status).toBe('active');
    expect(result.state.tasks[0].actions[0].status).toBe('done');
    expect(result.state.tasks[1].status).toBe('planned');
  });

  it('评价通过后进入下一普通任务', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1'], { doneActionIds: ['action-1'], currentActionId: null }),
      task('task-2', ['action-2', 'action-3'])
    ], 'task-1', null);

    const result = applyEvaluationResult(state, { result: 'passed' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.state.activeDailyTaskId).toBe('task-2');
    expect(result.state.activeStepId).toBe('action-2');
    expect(result.state.tasks[0].status).toBe('done');
    expect(result.state.tasks[1].status).toBe('active');
  });

  it('最后一个主任务评价通过后进入 guide_completed', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1'], { status: 'done', doneActionIds: ['action-1'], currentActionId: null }),
      task('task-2', ['action-2'], { doneActionIds: ['action-2'], currentActionId: null })
    ], 'task-2', null);

    const result = applyEvaluationResult(state, { recommendedAction: 'complete_task' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('guide_completed');
    expect(result.state.activeDailyTaskId).toBeNull();
    expect(result.state.activeStepId).toBeNull();
    expect(result.state.tasks.map((item) => item.status)).toEqual(['done', 'done']);
  });

  it('guide_completed 状态下恢复时不返回第一个任务', () => {
    const guide = {
      tasks: [
        task('task-1', ['action-1'], { status: 'done', doneActionIds: ['action-1'], currentActionId: null }),
        task('task-2', ['action-2'], { status: 'done', doneActionIds: ['action-2'], currentActionId: null })
      ]
    };

    const result = recoverExecutionState(guide, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('guide_completed');
    expect(result.state.activeDailyTaskId).toBeNull();
    expect(result.state.activeStepId).toBeNull();
  });

  it('没有 active Session 时仍根据任务持久状态恢复', () => {
    const guide = {
      tasks: [
        task('task-1', ['action-1'], { status: 'done', doneActionIds: ['action-1'], currentActionId: null }),
        task('task-2', ['action-2', 'action-3'], { status: 'active', currentActionId: 'action-3', doneActionIds: ['action-2'] })
      ]
    };

    const result = recoverExecutionState(guide, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.state.activeDailyTaskId).toBe('task-2');
    expect(result.state.activeStepId).toBe('action-3');
  });

  it('跳过当前步骤后进入下一步骤', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1', 'action-2', 'action-3'], { currentActionId: 'action-2', doneActionIds: ['action-1'] })
    ], 'task-1', 'action-2');

    const result = skipAction(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tasks[0].actions[1].status).toBe('skipped');
    expect(result.state.activeStepId).toBe('action-3');
  });

  it('跳过最后一个步骤后等待主任务提交，不直接推进下一任务', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1'], { currentActionId: 'action-1' }),
      task('task-2', ['action-2'])
    ], 'task-1', 'action-1');

    const result = skipAction(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tasks[0].actions[0].status).toBe('skipped');
    expect(result.state.activeDailyTaskId).toBe('task-1');
    expect(result.state.activeStepId).toBe('action-1');
    expect(result.state.status).toBe('awaiting_result');
    expect(result.state.tasks[0].status).toBe('active');
    expect(result.state.tasks[1].status).toBe('planned');
  });

  it('跳过整个任务时标记 skipped 并进入下一任务', () => {
    const state = stateWithTasks([
      task('task-1', ['action-1', 'action-2'], { currentActionId: 'action-1' }),
      task('task-2', ['action-3'])
    ], 'task-1', 'action-1');

    const result = skipTask(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tasks[0].status).toBe('skipped');
    expect(result.state.tasks[0].progressPercent).toBe(0);
    expect(result.state.tasks[1].status).toBe('active');
    expect(result.state.activeDailyTaskId).toBe('task-2');
    expect(result.state.activeStepId).toBe('action-3');
  });

  it('activeDailyTaskId 与任务 status 冲突时返回明确冲突结果', () => {
    const guide = {
      tasks: [
        task('task-1', ['action-1'], { status: 'done', doneActionIds: ['action-1'], currentActionId: null }),
        task('task-2', ['action-2'])
      ]
    };

    const result = recoverExecutionState(guide, { activeDailyTaskId: 'task-1', activeStepId: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict.code).toBe('active_task_points_to_done_task');
    expect(result.state.status).toBe('active');
    expect(result.state.activeDailyTaskId).toBe('task-2');
  });
});

function stateWithTasks(tasks: DailyGuideTask[], activeDailyTaskId: string | null, activeStepId: string | null) {
  return {
    tasks,
    activeDailyTaskId,
    activeStepId,
    status: activeDailyTaskId ? 'active' as const : 'guide_completed' as const
  };
}

function task(
  id: string,
  actionIds: string[],
  options: {
    status?: DailyGuideTask['status'];
    currentActionId?: string | null;
    doneActionIds?: string[];
  } = {}
): DailyGuideTask {
  const actions = actionIds.map((actionId, position) => action(actionId, id, position, options.doneActionIds?.includes(actionId) ? 'done' : 'planned'));
  const currentAction = options.currentActionId === null
    ? null
    : actions.find((item) => item.id === (options.currentActionId ?? actionIds[0])) ?? null;
  const completedActions = actions.filter((item) => item.status === 'done').map((item) => item.id);
  const remainingActions = actions.filter((item) => item.status !== 'done').map((item) => item.id);
  return {
    id,
    guideId: 'guide-1',
    roadmapStageId: null,
    legacyPlanBlockId: null,
    title: id,
    objective: `${id} objective`,
    scope: `${id} scope`,
    estimatedMinutes: { min: 10, target: 20, max: 30 },
    actions,
    deliverable: `${id} deliverable`,
    doneWhen: [`${id} done`],
    quickHint: `${id} hint`,
    evaluationMode: 'local',
    submissionPolicy: 'once_after_task',
    carryoverAllowed: true,
    status: options.status ?? 'planned',
    progressPercent: actions.length > 0 ? Math.round((completedActions.length / actions.length) * 100) : 0,
    completedActions,
    remainingActions,
    currentAction,
    nextStartPoint: currentAction?.title ?? null,
    totalElapsedMinutes: 0,
    position: Number(id.split('-')[1] ?? 1) - 1,
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z'
  };
}

function action(
  id: string,
  taskId: string,
  position: number,
  status: DailyGuideAction['status']
): DailyGuideAction {
  return {
    id,
    taskId,
    title: id,
    instruction: `${id} instruction`,
    checkpoint: `${id} checkpoint`,
    status,
    progressNote: null,
    completedAt: status === 'done' ? '2026-07-05T00:00:00.000Z' : null,
    position
  };
}
