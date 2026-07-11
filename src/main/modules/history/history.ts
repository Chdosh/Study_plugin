import type { Id, DailyGuideTask, LearningEvaluation, LearningSubmission, StudySession } from '../../../shared/types';
import type { StudyStore } from '../../services/store';

export interface TaskTimelineEvent {
  type: 'action_complete' | 'submission' | 'evaluation' | 'session_start' | 'session_pause';
  timestamp: string;
  description: string;
  data?: Record<string, unknown>;
}

export interface GoalTimelineEvent {
  type: 'guide_complete' | 'stage_advance' | 'adjustment_applied';
  timestamp: string;
  description: string;
  data?: Record<string, unknown>;
}

export class LearningHistoryModule {
  constructor(private readonly store: StudyStore) {}

  async getTaskTimeline(taskId: Id): Promise<TaskTimelineEvent[]> {
    const events: TaskTimelineEvent[] = [];
    const submissions = await this.store.getSubmissionsForTask(taskId);
    const evaluations = await this.store.getEvaluationsForTask(taskId);

    for (const sub of submissions) {
      events.push({
        type: 'submission',
        timestamp: sub.createdAt,
        description: `提交学习结果`,
        data: { id: sub.id, content: sub.content.slice(0, 100) }
      });
    }

    for (const ev of evaluations) {
      events.push({
        type: 'evaluation',
        timestamp: ev.createdAt,
        description: `评价: ${ev.result} (掌握度 ${ev.mastery}%)`,
        data: { id: ev.id, result: ev.result, mastery: ev.mastery }
      });
    }

    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async getGoalTimeline(goalId: Id): Promise<GoalTimelineEvent[]> {
    const events: GoalTimelineEvent[] = [];
    const guides = await this.store.getCompletedGuidesForGoal(goalId);

    for (const guide of guides) {
      events.push({
        type: 'guide_complete',
        timestamp: guide.date,
        description: `完成学习日: ${guide.todayGoal}`,
        data: { id: guide.id, date: guide.date }
      });
    }

    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}
