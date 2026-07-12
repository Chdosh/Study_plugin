import type { LearnerFact, LearningRuntimeSnapshot } from '../../shared/types';
import type { StudyStore } from './store';

export type LearningAiOperation =
  | 'goal_intake'
  | 'generate_roadmap'
  | 'generate_short_plan'
  | 'generate_daily_guide'
  | 'generate_daily_plan'
  | 'generate_stage_outline'
  | 'teach_step'
  | 'answer_step_question'
  | 'evaluate_submission'
  | 'decide_next_step'
  | 'summarize_step'
  | 'generate_review'
  | 'generate_rolling_plan';

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
export const OPERATION_BUDGET_TOKENS = 4000;
const APPROX_CHARS_PER_TOKEN = 2;

const OPERATION_FIELD_WHITELIST: Record<LearningAiOperation, string[]> = {
  goal_intake: ['operation', 'goal'],
  generate_roadmap: ['operation', 'goal'],
  generate_short_plan: ['operation', 'goal', 'roadmapStage'],
  generate_daily_guide: ['operation', 'goal', 'guide', 'roadmapStage', 'pendingAdjustment', 'latestEvaluation'],
  generate_daily_plan: ['operation', 'goal', 'guide', 'roadmapStage', 'pendingAdjustment', 'latestEvaluation'],
  generate_stage_outline: ['operation', 'goal', 'roadmapStage', 'pendingAdjustment'],
  teach_step: ['operation', 'guideTask', 'guideAction', 'roadmapStage'],
  answer_step_question: ['operation', 'guideTask', 'guideAction', 'currentQuestionThread'],
  evaluate_submission: ['operation', 'guideTask', 'latestSubmission', 'latestEvaluation'],
  decide_next_step: ['operation', 'guideTask', 'latestEvaluation', 'latestDecision', 'pendingAdjustment'],
  summarize_step: ['operation', 'guideTask', 'guideAction', 'latestSubmission', 'latestEvaluation'],
  generate_review: ['operation', 'goal', 'guide', 'roadmapStage', 'latestSubmission', 'latestEvaluation'],
  generate_rolling_plan: ['operation', 'goal', 'roadmapStage', 'pendingAdjustment', 'latestEvaluation']
};

const OPERATION_EXTRA_FIELD_WHITELIST: Record<LearningAiOperation, string[]> = {
  goal_intake: ['messages', 'latestUserInput', 'knownGoalUnderstanding'],
  generate_roadmap: ['goalUnderstanding', 'learnerProfile', 'availableTime'],
  generate_short_plan: ['goalUnderstanding', 'roadmap', 'availableTime'],
  generate_daily_guide: ['shortPlanDay', 'previousDayResult', 'availableMinutes'],
  generate_daily_plan: ['availableMinutes'],
  generate_stage_outline: ['learnerProfile', 'availableTime'],
  teach_step: ['learningStyle'],
  answer_step_question: ['question'],
  evaluate_submission: ['submission'],
  decide_next_step: ['remainingMinutes'],
  summarize_step: [],
  generate_review: ['guideTasks', 'sessions'],
  generate_rolling_plan: ['completedDays', 'remainingDays']
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
        } else if (value !== null && value !== undefined) {
          const sourceField = snapshot[key as keyof LearningRuntimeSnapshot] as { id?: string; createdAt?: string } | null;
          if (sourceField?.id) {
            meta[key] = { status: 'current', sourceId: sourceField.id, createdAt: sourceField.createdAt ?? null };
          }
        }
        context[key] = value;
      }
    }
    const allowedExtraFields = OPERATION_EXTRA_FIELD_WHITELIST[operation];
    for (const key of allowedExtraFields) {
      if (key in extra) context[key] = sanitizeExtraField(extra[key]);
    }

    const facts = snapshot.goal?.id ? await this.store.listFactsForGoal(snapshot.goal.id) : [];
    const relevantFacts = facts.filter((fact) => fact.scope !== 'task' || fact.taskId === snapshot.dailyGuideTask?.id);
    const evaluationHistory = snapshot.dailyGuideTask?.id
      ? await this.store.getEvaluationsForTask(snapshot.dailyGuideTask.id)
      : [];
    const selectedFacts = selectConfirmedFacts(relevantFacts);
    const { conflicts, arbitratedContext } = arbitrateContext(snapshot, relevantFacts, evaluationHistory);
    if (conflicts.length > 0) {
      context.conflicts = conflicts;
    }
    if (arbitratedContext) {
      context.arbitratedContext = arbitratedContext;
    }

    if (selectedFacts.length > 0) {
      context.learnerFacts = selectedFacts.map((fact) => ({ key: fact.key, value: fact.value, scope: fact.scope }));
      contextSourceIds.push(...selectedFacts.map((fact) => fact.id));
      const latestFact = [...selectedFacts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      meta.learnerFacts = { status: 'current', sourceId: latestFact.id, createdAt: latestFact.updatedAt };
    }

    const boundedContext = enforceTokenBudget(context, OPERATION_BUDGET_TOKENS);

    return {
      operation,
      snapshot,
      context: boundedContext,
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

function sanitizeExtraField(value: unknown): unknown {
  if (typeof value === 'string') return truncateField(value, 2000);
  if (Array.isArray(value)) return value.slice(-10).map(sanitizeExtraField);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, nested]) => [key, sanitizeExtraField(nested)]));
  }
  return value;
}

export function estimateContextTokens(context: Record<string, unknown>): number {
  return Math.ceil(JSON.stringify(context).length / APPROX_CHARS_PER_TOKEN);
}

function enforceTokenBudget(context: Record<string, unknown>, budgetTokens: number): Record<string, unknown> {
  const bounded = structuredClone(context);
  const removableFields = [
    'conflicts',
    'arbitratedContext',
    'latestDecision',
    'pendingAdjustment',
    'latestEvaluation',
    'roadmapStage',
    'guide',
    'goal'
  ];

  for (const field of removableFields) {
    if (estimateContextTokens(bounded) <= budgetTokens) return bounded;
    delete bounded[field];
  }

  while (estimateContextTokens(bounded) > budgetTokens) {
    const longest = findLongestString(bounded);
    if (!longest || longest.value.length <= 64) break;
    const nextLength = Math.max(32, Math.floor(longest.value.length / 2));
    longest.parent[longest.key] = `${longest.value.slice(0, nextLength)}…`;
  }

  if (estimateContextTokens(bounded) > budgetTokens) {
    for (const key of Object.keys(bounded)) {
      if (key === 'operation') continue;
      delete bounded[key];
      if (estimateContextTokens(bounded) <= budgetTokens) break;
    }
  }
  return bounded;
}

function findLongestString(value: unknown): { parent: Record<string, unknown>; key: string; value: string } | null {
  let longest: { parent: Record<string, unknown>; key: string; value: string } | null = null;
  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object') return;
    for (const [key, nested] of Object.entries(current)) {
      if (typeof nested === 'string' && (!longest || nested.length > longest.value.length)) {
        longest = { parent: current as Record<string, unknown>, key, value: nested };
      } else {
        visit(nested);
      }
    }
  };
  visit(value);
  return longest;
}

function truncateField(value: string | null | undefined, maxChars: number): string | null | undefined {
  if (!value || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function evaluationRelevant(operation: LearningAiOperation): boolean {
  return [
    'evaluate_submission',
    'decide_next_step',
    'summarize_step',
    'generate_daily_plan',
    'generate_daily_guide',
    'generate_review',
    'generate_rolling_plan'
  ].includes(operation);
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

function arbitrateContext(snapshot: LearningRuntimeSnapshot, facts: LearnerFact[], evaluationHistory: LearningRuntimeSnapshot['latestEvaluation'][]): {
  conflicts: ConflictNote[];
  arbitratedContext: ArbitratedContext | null;
} {
  const conflicts: ConflictNote[] = [];
  const rules: ArbitrationRules[] = [];
  const safeToUse: string[] = [];
  const avoidAssuming: string[] = [];

  const evaluation = snapshot.latestEvaluation;
  const brief = snapshot.goal;
  const confirmedCurrentLevel = selectConfirmedFacts(facts).find((fact) => fact.key === 'currentLevel');

  const confirmedByKey = new Map<string, LearnerFact[]>();
  for (const fact of facts.filter((candidate) => candidate.source === 'confirmed' && candidate.value.trim())) {
    const group = confirmedByKey.get(fact.key) ?? [];
    group.push(fact);
    confirmedByKey.set(fact.key, group);
  }

  for (const [key, candidates] of confirmedByKey) {
    const distinctValues = new Set(candidates.map((candidate) => candidate.value.trim()));
    if (distinctValues.size <= 1) continue;
    const selected = [...candidates].sort(compareFactPriority)[0];
    conflicts.push({
      field: `learnerFact:${key}`,
      矛盾: candidates.map((candidate) => `${scopeLabel(candidate.scope)}=${candidate.value}`).join('；'),
      采用: `${scopeLabel(selected.scope)}=${selected.value}`,
      原因: '同为用户已确认事实时，当前目标事实优先于全局事实；未绑定具体任务的任务事实不参与采用'
    });
    rules.push({
      priority: '目标确认事实 > 全局确认事实 > 待确认推断',
      decision: `本次使用 ${selected.value}`,
      reason: `键 ${key} 存在多个已确认值，按最窄且可验证的作用域选择`
    });
    safeToUse.push(`${key}=${selected.value}`);
    avoidAssuming.push(...candidates.filter((candidate) => candidate.id !== selected.id).map((candidate) => `${key}=${candidate.value}`));
  }

  if (evaluation && brief && !confirmedCurrentLevel) {
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

  if (evaluation && confirmedCurrentLevel && (evaluation.result === 'failed' || evaluation.result === 'partial')) {
    conflicts.push({
      field: 'currentLevel',
      矛盾: `用户确认当前基础为“${confirmedCurrentLevel.value}”，最近一次评价为${evaluation.result}`,
      采用: `用户确认事实：${confirmedCurrentLevel.value}`,
      原因: '用户最近明确确认优先；评价作为需要后续复核的证据，不静默改写长期事实'
    });
    rules.push({
      priority: '用户明确确认 > 实际提交证据 > AI 推断',
      decision: `保留当前基础“${confirmedCurrentLevel.value}”，同时安排后续验证`,
      reason: '单次评价不足以覆盖用户明确确认的长期事实'
    });
    safeToUse.push(`currentLevel=${confirmedCurrentLevel.value}`);
    avoidAssuming.push('单次失败已经永久改变用户基础');
  }

  const recentEvaluations = evaluationHistory
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3);
  if (!confirmedCurrentLevel && recentEvaluations.length >= 2) {
    const consistentlyLow = recentEvaluations.every((item) => item.result === 'failed' || item.result === 'partial' || item.mastery < 60);
    const consistentlyHigh = recentEvaluations.every((item) => item.result === 'passed' && item.mastery >= 80);
    if (consistentlyLow || consistentlyHigh) {
      rules.push({
        priority: '连续实际评价 > 旧目标描述 > 单次 AI 判断',
        decision: consistentlyLow ? '按连续薄弱证据降低当前难度' : '按连续通过证据适度提高当前难度',
        reason: `最近 ${recentEvaluations.length} 次评价方向一致`
      });
      safeToUse.push(consistentlyLow ? '连续评价显示当前内容偏难' : '连续评价显示当前内容已稳定掌握');
    }
  }

  const arbitratedContext: ArbitratedContext | null = rules.length > 0 ? {
    rules,
    safeToUse,
    avoidAssuming
  } : null;

  return { conflicts, arbitratedContext };
}

function selectConfirmedFacts(facts: LearnerFact[]): LearnerFact[] {
  const selected = new Map<string, LearnerFact>();
  for (const fact of facts) {
    if (fact.source !== 'confirmed' || !fact.value.trim()) continue;
    const existing = selected.get(fact.key);
    if (!existing || compareFactPriority(fact, existing) < 0) selected.set(fact.key, fact);
  }

  return [...selected.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function compareFactPriority(left: LearnerFact, right: LearnerFact): number {
  const scopePriority: Record<LearnerFact['scope'], number> = { task: 0, goal: 1, global: 2 };
  const byScope = scopePriority[left.scope] - scopePriority[right.scope];
  if (byScope !== 0) return byScope;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function scopeLabel(scope: LearnerFact['scope']): string {
  if (scope === 'goal') return '当前目标';
  if (scope === 'global') return '全局';
  return '任务';
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
