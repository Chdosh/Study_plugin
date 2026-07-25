import type { GoalProgress, LearningGoal, RoadmapStage } from '../../shared/types';

export function deriveGoalProgress(
  goal: LearningGoal | null,
  roadmap: RoadmapStage[],
  currentStage: RoadmapStage | null,
  currentDate: string
): GoalProgress {
  if (!goal) {
    return {
      status: 'schedule_unset',
      dueDate: null,
      currentStageTargetDate: null,
      currentStageTitle: null
    };
  }
  const allCompleted = roadmap.length > 0
    && roadmap.every((stage) => stage.status === 'completed');
  if (goal.status === 'done' || allCompleted) {
    return {
      status: 'completed',
      dueDate: goal.dueDate,
      currentStageTargetDate: currentStage?.targetDate ?? null,
      currentStageTitle: currentStage?.title ?? null
    };
  }
  if (!goal.dueDate || !currentStage?.targetDate) {
    return {
      status: 'schedule_unset',
      dueDate: goal.dueDate,
      currentStageTargetDate: currentStage?.targetDate ?? null,
      currentStageTitle: currentStage?.title ?? null
    };
  }
  if (currentDate > goal.dueDate) {
    return {
      status: 'goal_due',
      dueDate: goal.dueDate,
      currentStageTargetDate: currentStage.targetDate,
      currentStageTitle: currentStage.title
    };
  }
  return {
    status: currentDate > currentStage.targetDate
      ? 'checkpoint_missed'
      : 'on_schedule',
    dueDate: goal.dueDate,
    currentStageTargetDate: currentStage.targetDate,
    currentStageTitle: currentStage.title
  };
}
