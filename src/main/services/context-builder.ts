import type { LearningRuntimeSnapshot } from '../../shared/types';
import type { StudyStore } from './store';

export type LearningAiOperation =
  | 'generate_daily_plan'
  | 'generate_stage_outline'
  | 'teach_step'
  | 'answer_step_question'
  | 'evaluate_submission'
  | 'decide_next_step'
  | 'summarize_step';

export interface BuiltLearningContext {
  operation: LearningAiOperation;
  snapshot: LearningRuntimeSnapshot;
  context: Record<string, unknown>;
  contextSourceIds: string[];
}

const CONTEXT_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ContextBuilder {
  constructor(private readonly store: StudyStore) {}

  async build(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    const snapshot = await this.store.getLearningRuntimeSnapshot();
    const contextSourceIds = collectSourceIds(snapshot);
    const context: Record<string, unknown> = {
      operation,
      goal: snapshot.goal
        ? {
            id: snapshot.goal.id,
            title: snapshot.goal.title,
            description: snapshot.goal.description,
            status: snapshot.goal.status
          }
        : null,
      guide: snapshot.dailyGuide
        ? {
            id: snapshot.dailyGuide.id,
            date: snapshot.dailyGuide.date,
            todayGoal: snapshot.dailyGuide.todayGoal,
            status: snapshot.dailyGuide.status
          }
        : null,
      guideTask: snapshot.dailyGuideTask
        ? this.pruneTask(snapshot.dailyGuideTask, operation)
        : null,
      guideAction: snapshot.dailyGuideAction
        ? {
            id: snapshot.dailyGuideAction.id,
            title: snapshot.dailyGuideAction.title,
            instruction: snapshot.dailyGuideAction.instruction,
            checkpoint: snapshot.dailyGuideAction.checkpoint,
            status: snapshot.dailyGuideAction.status
          }
        : null,
      roadmapStage: snapshot.roadmapStage
        ? {
            id: snapshot.roadmapStage.id,
            title: snapshot.roadmapStage.title,
            objective: snapshot.roadmapStage.objective,
            successCriteria: snapshot.roadmapStage.successCriteria.slice(0, 200)
          }
        : null,
      currentQuestionThread: snapshot.questionThread
        ? {
            id: snapshot.questionThread.id,
            question: snapshot.questionThread.question,
            status: snapshot.questionThread.status,
            resolutionSummary: snapshot.questionThread.resolutionSummary,
            messages: snapshot.questionMessages.slice(-4)
          }
        : null,
      latestSubmission: snapshot.latestSubmission
        ? {
            id: snapshot.latestSubmission.id,
            content: snapshot.latestSubmission.content,
            createdAt: snapshot.latestSubmission.createdAt
          }
        : null,
      latestEvaluation: evaluationRelevant(operation)
        ? foldIfStale(snapshot.latestEvaluation, operation)
        : null,
      latestDecision: evaluationRelevant(operation)
        ? foldIfStale(snapshot.latestDecision, operation)
        : null,
      pendingAdjustment: foldIfStale(snapshot.pendingAdjustment, operation),
      ...extra
    };

    const conflicts = detectConflicts(snapshot);
    if (conflicts.length > 0) {
      context.conflicts = conflicts;
    }

    return {
      operation,
      snapshot,
      context,
      contextSourceIds
    };
  }

  private pruneTask(
    task: LearningRuntimeSnapshot['dailyGuideTask'],
    operation: LearningAiOperation
  ): Record<string, unknown> | null {
    if (!task) return null;
    const base: Record<string, unknown> = {
      id: task.id,
      title: task.title,
      objective: task.objective,
      scope: task.scope,
      deliverable: task.deliverable,
      doneWhen: task.doneWhen,
      evaluationMode: task.evaluationMode,
      status: task.status
    };
    if (operation === 'evaluate_submission') {
      return base;
    }
    if (operation === 'teach_step') {
      return { ...base, quickHint: task.quickHint };
    }
    return base;
  }
}

function evaluationRelevant(operation: LearningAiOperation): boolean {
  return operation === 'evaluate_submission';
}

function foldIfStale(value: { createdAt?: string } | null, operation: string): unknown {
  if (!value || !value.createdAt) return value;
  const age = Date.now() - new Date(value.createdAt).getTime();
  if (age <= CONTEXT_MAX_AGE_DAYS * MS_PER_DAY) return value;
  return { note: `[${operation}] 记录已超过 ${CONTEXT_MAX_AGE_DAYS} 天，已折叠为历史参考。` };
}

interface ConflictNote {
  field: string;
 矛盾: string;
 采用: string;
 原因: string;
}

function detectConflicts(snapshot: LearningRuntimeSnapshot): ConflictNote[] {
  const conflicts: ConflictNote[] = [];
  const evaluation = snapshot.latestEvaluation;
  const brief = snapshot.goal;

  if (evaluation && brief) {
    const recentFailed = evaluation.result === 'failed' || evaluation.result === 'partial';
    if (recentFailed && brief.description?.includes('基础扎实')) {
      conflicts.push({
        field: 'currentLevel',
        矛盾: '目标描述为"基础扎实"但最近评估未通过',
        采用: '最近评估结果',
        原因: '系统记录的实际行为优先于初始自我评估'
      });
    }
  }

  if (evaluation && snapshot.latestSubmission) {
    const lowMastery = evaluation.mastery < 50;
    const highSubmissionCount = snapshot.latestSubmission.content.length > 200;
    if (lowMastery && highSubmissionCount) {
      conflicts.push({
        field: 'mastery',
        矛盾: '提交内容较长但掌握度评估偏低',
        采用: '实际掌握度评估',
        原因: '评估基于完成标准，而非提交长度'
      });
    }
  }

  if (snapshot.pendingAdjustment && snapshot.dailyGuideTask) {
    const wantsSkip = snapshot.pendingAdjustment.reason?.includes('跳过')
      || snapshot.pendingAdjustment.reason?.includes('太难');
    if (wantsSkip && snapshot.dailyGuideTask.evaluationMode === 'ai') {
      conflicts.push({
        field: 'evaluationMode',
        矛盾: '当前任务被建议跳过但评价模式为 AI',
        采用: '本地验证模式',
        原因: '用户对任务有疑虑时降低评价门槛'
      });
    }
  }

  return conflicts;
}

function collectSourceIds(snapshot: LearningRuntimeSnapshot): string[] {
  return [
    snapshot.goal?.id,
    snapshot.dailyGuide?.id,
    snapshot.dailyGuideTask?.id,
    snapshot.dailyGuideAction?.id,
    snapshot.roadmapStage?.id,
    snapshot.questionThread?.id,
    snapshot.latestSubmission?.id,
    snapshot.latestEvaluation?.id,
    snapshot.latestDecision?.id,
    snapshot.pendingAdjustment?.id
  ].filter((value): value is string => Boolean(value));
}
