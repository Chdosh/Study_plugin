import type { RoadmapStage } from '../../../shared/types';

export interface RoadmapStagePresentation {
  className: string;
  label: string;
  isCurrentLearningUnit: boolean;
}

export function getRoadmapStagePresentation(
  stage: RoadmapStage,
  currentStageId: string | null
): RoadmapStagePresentation {
  const isCurrentLearningUnit = stage.id === currentStageId;
  const byStatus: Record<RoadmapStage['status'], { className: string; label: string }> = {
    pending: { className: 'pending', label: '未开始' },
    active: { className: 'active', label: '进行中' },
    ready_for_review: { className: 'review', label: '待确认' },
    completed: { className: 'done', label: '已完成' },
    blocked: { className: 'blocked', label: '需要处理' },
    adjusted: { className: 'adjusted', label: '已调整' }
  };
  const presentation = byStatus[stage.status];
  return {
    className: `${presentation.className}${isCurrentLearningUnit ? ' current-unit' : ''}`,
    label: isCurrentLearningUnit && stage.status === 'pending' ? '当前学习单元' : presentation.label,
    isCurrentLearningUnit
  };
}
