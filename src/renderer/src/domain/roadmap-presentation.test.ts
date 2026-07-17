import { describe, expect, it } from 'vitest';
import type { RoadmapStage, RoadmapStageStatus } from '../../../shared/types';
import { getRoadmapStagePresentation } from './roadmap-presentation';

function stage(id: string, status: RoadmapStageStatus): RoadmapStage {
  return {
    id,
    goalId: 'goal-1',
    title: id,
    objective: '',
    direction: '',
    successCriteria: '',
    status,
    position: 0,
    createdAt: '',
    updatedAt: ''
  };
}

describe('getRoadmapStagePresentation', () => {
  it.each([
    ['completed', 'done', '已完成'],
    ['active', 'active', '进行中'],
    ['ready_for_review', 'review', '待确认'],
    ['blocked', 'blocked', '需要处理'],
    ['adjusted', 'adjusted', '已调整'],
    ['pending', 'pending', '未开始']
  ] as const)('maps %s from the formal roadmap status', (status, className, label) => {
    expect(getRoadmapStagePresentation(stage('stage-1', status), 'stage-2')).toMatchObject({ className, label });
  });

  it('marks a pending execution stage as the current learning unit without calling it the formal current stage', () => {
    expect(getRoadmapStagePresentation(stage('stage-2', 'pending'), 'stage-2')).toEqual({
      className: 'pending current-unit',
      label: '当前学习单元',
      isCurrentLearningUnit: true
    });
  });
});
