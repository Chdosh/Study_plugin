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

export type ContextFieldStatus = 'current' | 'stale' | 'failed';

export interface ContextSourceMeta {
  status: ContextFieldStatus;
  sourceId: string | null;
  createdAt: string | null;
}

export interface BuiltLearningContext {
  operation: LearningAiOperation;
  snapshot: LearningRuntimeSnapshot;
  context: Record<string, unknown>;
  contextSourceIds: string[];
  contextMeta?: Record<string, ContextSourceMeta>;
}

const CONTEXT_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OPERATION_FIELD_WHITELIST: Record<LearningAiOperation, string[]> = {
  generate_daily_plan: ['operation', 'goal', 'guide', 'roadmapStage', 'pendingAdjustment', 'latestEvaluation'],
  generate_stage_outline: ['operation', 'goal', 'roadmapStage', 'pendingAdjustment'],
  teach_step: ['operation', 'guideTask', 'guideAction', 'roadmapStage'],
  answer_step_question: ['operation', 'guideTask', 'guideAction', 'currentQuestionThread'],
  evaluate_submission: ['operation', 'guideTask', 'latestSubmission', 'latestEvaluation'],
  decide_next_step: ['operation', 'guideTask', 'latestEvaluation', 'latestDecision', 'pendingAdjustment'],
  summarize_step: ['operation', 'guideTask', 'guideAction', 'latestSubmission', 'latestEvaluation']
};

export class ContextBuilder {
  constructor(private readonly store: StudyStore) {}

  async build(operation: LearningAiOperation, extra: Record<string, unknown> = {}): Promise<BuiltLearningContext> {
    const snapshot = await this.store.getLearningRuntimeSnapshot();
    const contextSourceIds = collectSourceIds(snapshot);
    const meta: Record<string, ContextSourceMeta> = {};
    const full: Record<string, unknown> = {
      operation,
      goal: snapshot.goal
        ? {
            id: snapshot.goal.id,
            title: snapshot.goal.title,
            description: truncateField(snapshot.goal.description, 300),
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
            messages: snapshot.questionMessages.slice(-4).map((m) => ({
              role: m.role,
              content: truncateField(m.content, 300)
            }))
          }
        : null,
      latestSubmission: snapshot.latestSubmission
        ? {
            id: snapshot.latestSubmission.id,
            content: truncateField(snapshot.latestSubmission.content, 500),
            createdAt: snapshot.latestSubmission.createdAt
          }
        : null,
      latestEvaluation: evaluationRelevant(operation)
        ? foldIfStale(snapshot.latestEvaluation, operation)
        : null,
      latestDecision: evaluationRelevant(operation)
        ? foldIfStale(snapshot.latestDecision, operation)
        : null,
      pendingAdjustment: foldIfStale(snapshot.pendingAdjustment, operation)
    };

    const whitelist = OPERATION_FIELD_WHITELIST[operation];
    const context: Record<string, unknown> = {};
    for (const key of whitelist) {
      if (key in full) {
        let value = full[key];
        if (value && typeof value === 'object' && 'note' in value && Object.keys(value).length === 1) {
          const sourceField = snapshot[key as keyof LearningRuntimeSnapshot] as { id?: string; createdAt?: string } | null;
          meta[key] = { status: 'stale', sourceId: sourceField?.id ?? null, createdAt: sourceField?.createdAt ?? null };
        }
        context[key] = value;
      }
    }
    for (const [key, value] of Object.entries(extra)) {
      context[key] = value;
    }

    const { conflicts, arbitratedContext } = arbitrateContext(snapshot);
    if (conflicts.length > 0) {
      context.conflicts = conflicts;
    }
    if (arbitratedContext) {
      context.arbitratedContext = arbitratedContext;
    }

    return {
      operation,
      snapshot,
      context,
      contextSourceIds,
      contextMeta: Object.keys(meta).length > 0 ? meta : undefined
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

function truncateField(value: string | null | undefined, maxChars: number): string | null | undefined {
  if (!value || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function evaluationRelevant(operation: LearningAiOperation): boolean {
  return operation === 'evaluate_submission' || operation === 'generate_daily_plan';
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

interface ArbitrationRules {
  priority: string;
  decision: string;
  reason: string;
}

interface ArbitratedContext {
  rules: ArbitrationRules[];
  safeToUse: string[];
  avoidAssuming: string[];
}

function arbitrateContext(snapshot: LearningRuntimeSnapshot): {
  conflicts: ConflictNote[];
  arbitratedContext: ArbitratedContext | null;
} {
  const conflicts: ConflictNote[] = [];
  const rules: ArbitrationRules[] = [];
  const safeToUse: string[] = [];
  const avoidAssuming: string[] = [];

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
      rules.push({
        priority: '实际评价 > 初始自我画像',
        decision: '按最近评估结果判断当前水平',
        reason: '用户实际行为比初始描述更可靠'
      });
      safeToUse.push('最近评价结果');
      avoidAssuming.push('用户基础扎实');
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
      rules.push({
        priority: '完成标准 > 提交篇幅',
        decision: '以 mastery 分数为准',
        reason: '评估基于完成标准，而非提交长度'
      });
      safeToUse.push('mastery 评估分数');
      avoidAssuming.push('提交长度反映掌握度');
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
      rules.push({
        priority: '用户当前判断 > 系统预设模式',
        decision: '建议切换到本地验证或简化任务',
        reason: '用户对任务有疑虑时降低评价门槛'
      });
      safeToUse.push('用户当前反馈');
      avoidAssuming.push('原定评价模式');
    }
  }

  if (evaluation && snapshot.dailyGuideTask) {
    const passedWithLowMastery = evaluation.result === 'passed' && evaluation.mastery < 70;
    if (passedWithLowMastery) {
      rules.push({
        priority: '连续评价 > 单次判断',
        decision: '标记为初步通过，建议后续继续巩固',
        reason: '单次 AI 判断不能永久确认掌握'
      });
      avoidAssuming.push('用户已完全掌握该知识点');
    }
  }

  const arbitratedContext: ArbitratedContext | null = rules.length > 0 ? {
    rules,
    safeToUse,
    avoidAssuming
  } : null;

  return { conflicts, arbitratedContext };
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
