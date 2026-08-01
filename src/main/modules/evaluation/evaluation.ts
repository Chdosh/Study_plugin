import type {
  DailyGuideTask,
  Id,
  LearningEvaluation,
  LearningSubmission,
  SubmissionEvaluationResult
} from '../../../shared/types';
import type {
  NextStepDecisionAgentOutput,
  SubmissionEvaluationAgentOutput
} from '../../../shared/schemas';
import { CategorizedError } from '../../ai/categorized-error';
import type { SettingsService } from '../../services/settings-service';
import type { StudyStore } from '../../services/store';
import type { LearnerContextModule } from '../context/context';
import type { LearningTurnModule } from '../learning-turn/learning-turn';

export class LearningEvaluationModule {
  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly context: LearnerContextModule,
    private readonly learningTurn: LearningTurnModule
  ) {}

  async evaluate(
    submission: LearningSubmission,
    promptProfileId?: Id
  ): Promise<SubmissionEvaluationResult> {
    const taskId = submission.taskId;
    const guideTask = await this.store.getDailyGuideTaskByBlockId(taskId);
    if (!guideTask) {
      throw new CategorizedError('validation_error', '这条提交对应的 Task 不存在，无法生成评价。');
    }
    const evaluationLockKey = `evaluation:${submission.id}`;
    if (!await this.store.acquireGenerationLock(evaluationLockKey)) {
      throw new CategorizedError('validation_error', '这条提交正在评价中，请稍后再试。');
    }

    try {
      const guideId = guideTask.guideId;
      if (!guideId) {
        throw new CategorizedError('validation_error', '这条提交没有关联 Learning Guide，无法生成评价。');
      }
      const guide = await this.store.getDailyGuideById(guideId);
      const goalId = guide?.goalId;
      if (!goalId) {
        throw new CategorizedError('validation_error', '这条提交对应的学习目标不存在，无法生成评价。');
      }
      const goal = await this.store.getGoal(goalId);
      if (!goal) {
        throw new CategorizedError('validation_error', '这条提交对应的学习目标不存在，无法生成评价。');
      }
      const [evaluationContext, profile, runtimeSettings, knowledge] = await Promise.all([
        this.context.build('evaluate_submission', {
          submission: submission.content,
          evaluationGoal: goal,
          evaluationGuide: guide,
          evaluationTask: guideTask,
          evaluationSubmission: submission
        }),
        this.store.getPromptProfile(promptProfileId),
        this.settings.getRuntimeSettings(),
        this.store.getKnowledgeContextForGoal(goalId)
      ]);
      let evaluationAiReviewId: string | undefined;
      let evaluationOutput: SubmissionEvaluationAgentOutput;
      if (guideTask.evaluationMode === 'local') {
        evaluationOutput = buildLocalSubmissionEvaluation(submission.content, guideTask);
      } else {
        try {
          const input = {
            submission: submission.content,
            context: evaluationContext.context,
            profile,
            settings: runtimeSettings,
            knowledgeItems: knowledge.knowledgeItems,
            reviewKnowledgeItems: knowledge.reviewKnowledgeItems,
            traceId: `ta_${crypto.randomUUID()}`
          };
          const run = await this.learningTurn.startTool<typeof input, SubmissionEvaluationAgentOutput>({
            toolName: 'evaluate',
            input,
            context: {
              kind: 'evaluation',
              scopeType: 'submission',
              scopeId: submission.id,
              goalId,
              contextVersion: 1
            },
            audit: {
              kind: 'submission_evaluation',
              provider: 'configured_ai',
              model: runtimeSettings.aiModel,
              promptProfileId: profile.id,
              promptVersionId: profile.activeVersionId,
              inputSnapshot: {
                contextSourceIds: evaluationContext.contextSourceIds,
                submissionId: submission.id
              },
              outputSchemaVersion: 'submission-evaluation.v1'
            }
          });
          evaluationOutput = run.output;
          evaluationAiReviewId = run.runReviewId;
        } catch (error) {
          if (error instanceof CategorizedError) throw error;
          throw new CategorizedError(
            'ai_failure',
            '导师反馈暂未生成；提交已经保存，学习进度不受影响。',
            error instanceof Error ? error : undefined
          );
        }
      }
      const result = await this.store.saveEvaluationAndDecision({
        submission,
        evaluationOutput,
        direction: deriveEvaluationDirection(evaluationOutput),
        decisionOutput: buildLocalDecisionFromEvaluation(evaluationOutput),
        evaluationAiReviewId
      });
      await this.context.processEvaluationResult({
        goalId,
        taskId: guideTask.id,
        submissionId: submission.id,
        evaluationId: result.evaluation.id,
        evaluationOutput
      });
      const appliedSubmission = await this.store.getSubmissionById(submission.id);
      if (!appliedSubmission) throw new Error('评价已完成，但无法重新读取提交记录。');
      return {
        submission: appliedSubmission,
        evaluation: result.evaluation,
        decision: result.decision,
        nextAction: result.nextAction
      };
    } finally {
      await this.store.releaseGenerationLock(evaluationLockKey);
    }
  }
}

function buildLocalDecisionFromEvaluation(
  evaluation: SubmissionEvaluationAgentOutput
): NextStepDecisionAgentOutput {
  if (evaluation.result === 'passed') {
    return {
      decision: 'complete_task',
      reason: evaluation.feedback,
      taskCompleted: true,
      nextStep: null,
      remediation: null,
      carryForward: ''
    };
  }
  const decision = evaluation.recommendedAction === 'advance'
    || evaluation.recommendedAction === 'complete_task'
    ? 'remediate'
    : evaluation.recommendedAction;
  return {
    decision,
    reason: evaluation.feedback,
    taskCompleted: false,
    nextStep: null,
    remediation: null,
    carryForward: evaluation.missingRequirements[0] ?? evaluation.misconceptions[0] ?? ''
  };
}

function buildLocalSubmissionEvaluation(
  content: string,
  task: DailyGuideTask
): SubmissionEvaluationAgentOutput {
  const trimmed = content.trim();
  const passed = trimmed.length >= 10;
  return {
    result: passed ? 'passed' : 'unclear',
    evidence: passed
      ? [`已提交：${truncate(trimmed)}`, ...task.doneWhen]
      : ['提交内容过短，本地检查无法确认已完成。'],
    correctParts: passed ? ['提交了主任务最终产出。'] : [],
    misconceptions: [],
    missingRequirements: passed ? [] : task.doneWhen,
    feedback: passed
      ? '本地检查通过：已收到主任务最终产出。'
      : '本地检查未通过：请补充可验收的最终产出后再提交。',
    recommendedAction: passed ? 'complete_task' : 'request_user_decision'
  };
}

function deriveEvaluationDirection(
  evaluation: SubmissionEvaluationAgentOutput
): LearningEvaluation['decision'] {
  if (evaluation.result === 'passed') return 'advance';
  return evaluation.recommendedAction === 'remediate' ? 'remediate' : 'stay';
}

function truncate(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 119)}…`;
}
