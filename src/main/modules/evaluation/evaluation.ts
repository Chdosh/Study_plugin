import type {
  DailyGuideTask,
  Id,
  LearningSubmission,
  SubmissionEvaluationResult
} from '../../../shared/types';
import type {
  NextStepDecisionAgentOutput,
  SubmissionEvaluationAgentOutput
} from '../../../shared/schemas';
import { CategorizedError } from '../../ai/categorized-error';
import { isPassingEvaluation } from '../../domain/execution-state-machine';
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

  async retry(submissionId: Id, promptProfileId?: Id): Promise<SubmissionEvaluationResult> {
    const submission = await this.store.getSubmissionById(submissionId);
    if (!submission) {
      throw new CategorizedError('user_input_error', '找不到需要重试的提交记录。');
    }
    if (submission.evaluationStatus === 'completed') {
      throw new CategorizedError('validation_error', '这条提交已经完成评价，无需重复评价。');
    }
    return this.evaluate(submission, promptProfileId, true);
  }

  async evaluate(
    submission: LearningSubmission,
    promptProfileId?: Id,
    resetExistingLock = false
  ): Promise<SubmissionEvaluationResult> {
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.dailyGuideTask || before.dailyGuideTask.id !== submission.stepId) {
      throw new CategorizedError('validation_error', '当前 Task 与这条提交不一致，无法自动评价或重试。');
    }
    const evaluationLockKey = `evaluation:${submission.id}`;
    if (resetExistingLock) await this.store.releaseGenerationLock(evaluationLockKey);
    if (!await this.store.acquireGenerationLock(evaluationLockKey)) {
      throw new CategorizedError('validation_error', '这条提交正在评价中，请稍后再试。');
    }

    try {
      await this.store.markSubmissionEvaluation(submission.id, 'evaluating');
      const guideTask = before.dailyGuideTask;
      const activeGuide = await this.store.getActiveGuide(true);
      const goalId = activeGuide.goal?.id;
      const [evaluationContext, profile, runtimeSettings, knowledge] = await Promise.all([
        this.context.build('evaluate_submission', { submission: submission.content }),
        this.store.getPromptProfile(promptProfileId),
        this.settings.getRuntimeSettings(),
        goalId
          ? this.store.getKnowledgeContextForGoal(goalId)
          : Promise.resolve({ knowledgeItems: [], reviewKnowledgeItems: [] })
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
              provider: 'deepseek',
              model: runtimeSettings.deepseekModel,
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
          await this.store.markSubmissionEvaluation(submission.id, 'failed');
          if (error instanceof CategorizedError) throw error;
          throw new CategorizedError(
            'ai_failure',
            '评价提交时出错，已保存你的提交内容。请重试评价。',
            error instanceof Error ? error : undefined
          );
        }
      }
      const result = await this.store.saveEvaluationAndDecision({
        submission,
        evaluationOutput,
        decisionOutput: buildLocalDecisionFromEvaluation(evaluationOutput),
        evaluationAiReviewId
      });
      await this.context.processEvaluationResult({
        goalId: goalId ?? '',
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
  if (isPassingEvaluation(evaluation)) {
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
    mastery: passed ? 100 : 30,
    evidence: passed
      ? [`已提交：${truncate(trimmed)}`, ...task.doneWhen]
      : ['提交内容过短，本地检查无法确认已完成。'],
    correctParts: passed ? ['提交了主任务最终产出。'] : [],
    misconceptions: [],
    missingRequirements: passed ? [] : task.doneWhen,
    feedback: passed
      ? '本地检查通过：已收到主任务最终产出。'
      : '本地检查未通过：请补充可验收的最终产出后再提交。',
    recommendedAction: passed ? 'complete_task' : 'request_user_decision',
    decision: passed ? 'advance' : 'stay'
  };
}

function truncate(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 119)}…`;
}
