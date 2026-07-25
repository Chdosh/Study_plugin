import { describe, expect, it } from 'vitest';
import type { LearningGoal, RoadmapStage } from '../../shared/types';
import { resolveGoalDueDate } from './goal-deadline';
import { deriveGoalProgress } from './goal-progress';

describe('goal deadline', () => {
  it('resolves a calendar month without creating daily plan facts', () => {
    expect(resolveGoalDueDate('一个月', '2026-07-24')).toBe('2026-08-24');
    expect(resolveGoalDueDate('两个月', '2026-07-31')).toBe('2026-09-30');
  });

  it('accepts an explicit confirmed date and rejects ambiguous text', () => {
    expect(resolveGoalDueDate('2026-08-24', '2026-07-24')).toBe('2026-08-24');
    expect(() => resolveGoalDueDate('下个月左右', '2026-07-24')).toThrow(
      '截止时间无法转换为明确日期'
    );
  });
});

describe('goal progress', () => {
  const goal: LearningGoal = {
    id: 'goal-1',
    title: '学习 React',
    description: null,
    status: 'active',
    priority: 3,
    dueDate: '2026-08-24',
    sourceImportId: null,
    createdAt: '',
    updatedAt: ''
  };
  const stage: RoadmapStage = {
    id: 'stage-1',
    goalId: goal.id,
    title: '路由与接口',
    objective: '完成应用主流程',
    direction: '从局部练习到组合应用',
    successCriteria: '能独立完成接口错误处理',
    targetDate: '2026-08-10',
    status: 'active',
    position: 0,
    createdAt: '',
    updatedAt: ''
  };

  it('uses checkpoint dates as progress references without counting missed days', () => {
    expect(deriveGoalProgress(goal, [stage], stage, '2026-08-12')).toMatchObject({
      status: 'checkpoint_missed',
      dueDate: '2026-08-24',
      currentStageTargetDate: '2026-08-10'
    });
  });

  it('distinguishes a missed goal deadline from a missed stage checkpoint', () => {
    expect(deriveGoalProgress(goal, [stage], stage, '2026-08-25').status).toBe('goal_due');
  });
});
