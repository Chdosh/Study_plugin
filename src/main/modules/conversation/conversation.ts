import type { GoalBrief, Id, QuestionAnswerResult } from '../../../shared/types';
import type { AnswerStepQuestionAgentOutput, GoalIntakeAgentOutput } from '../../../shared/schemas';
import { CategorizedError } from '../../ai/categorized-error';
import type { AgentContext, AgentRunAudit } from '../../agent/agent-types';
import type { SettingsService } from '../../services/settings-service';
import type { StudyStore } from '../../services/store';
import type { LearnerContextModule } from '../context/context';
import type { LearningBranchModule } from '../branch/branch';
import type { LearningTurnModule } from '../learning-turn/learning-turn';

const FORCE_START_MESSAGE = '请使用当前信息生成初步计划。';

export class LearningConversationModule {
  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly context: LearnerContextModule,
    private readonly branch: LearningBranchModule,
    private readonly learningTurn: LearningTurnModule
  ) {}

  async getCurrentGoalIntake() {
    return this.withPendingInteraction(await this.store.getCurrentGoalIntake());
  }

  async sendGoalIntakeMessage(content: string) {
    const current = await this.store.getCurrentGoalIntake();
    const pending = await this.learningTurn.getOpenInteraction('goal_intake', current.intake.id);
    if (pending && pending.expectedContextVersion !== current.messages.length) {
      throw new CategorizedError(
        'validation_error',
        '目标访谈内容已经变化，原问题没有被自动套用。请刷新后重新回答。'
      );
    }
    await this.store.addGoalIntakeMessage(current.intake.id, 'user', content);
    const [nextState, profile, runtimeSettings] = await Promise.all([
      this.store.getCurrentGoalIntake(),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const recentMessages = nextState.messages.slice(-12);
    const intakeContext = await this.context.build('goal_intake', {
      messages: recentMessages,
      latestUserInput: content
    });
    const traceId = `ta_${crypto.randomUUID()}`;
    const input = {
      messages: recentMessages,
      context: intakeContext.context,
      profile,
      settings: runtimeSettings,
      traceId
    };
    const context: AgentContext = {
      kind: 'goal_intake',
      scopeType: 'goal_intake',
      scopeId: current.intake.id,
      goalId: current.intake.goalId ?? undefined,
      contextVersion: nextState.messages.length + 1
    };
    const audit: AgentRunAudit = {
      kind: 'goal_intake',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: {
        intakeId: current.intake.id,
        messageCount: nextState.messages.length,
        contextSourceIds: intakeContext.contextSourceIds
      },
      outputSchemaVersion: 'goal-intake.v1'
    };
    try {
      const run = pending
        ? await this.learningTurn.resumeTool<typeof input, GoalIntakeAgentOutput>({
            pendingInteractionId: pending.id,
            answer: content,
            expectedContextVersion: pending.expectedContextVersion,
            resolution: content === FORCE_START_MESSAGE ? 'skipped' : 'answered',
            toolName: 'propose_goal',
            input,
            context,
            audit
          })
        : await this.learningTurn.startTool<typeof input, GoalIntakeAgentOutput>({
            toolName: 'propose_goal',
            input,
            context,
            audit
          });
      const saved = await this.store.saveGoalIntakeAgentOutput(current.intake.id, run.output);
      return this.withPendingInteraction(saved);
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '访谈响应失败，请重试。',
        error instanceof Error ? error : undefined
      );
    }
  }

  async cancelGoalIntakeQuestion() {
    const state = await this.store.getCurrentGoalIntake();
    const pending = await this.learningTurn.getOpenInteraction('goal_intake', state.intake.id);
    if (pending) await this.learningTurn.cancel(pending.id);
    return this.withPendingInteraction(await this.store.getCurrentGoalIntake());
  }

  async confirmGoalIntake(briefPatch?: Partial<GoalBrief>) {
    const intake = await this.store.getCurrentGoalIntake();
    if (intake.intake.status === 'confirmed' && intake.intake.goalId) {
      const goal = await this.store.getGoal(intake.intake.goalId);
      if (goal) return { goal, intake: intake.intake };
    }
    return this.store.confirmGoalIntake(briefPatch);
  }

  async askCurrent(question: string, promptProfileId?: Id): Promise<QuestionAnswerResult> {
    const clean = requireQuestion(question);
    const before = await this.store.getLearningRuntimeSnapshot();
    const actionId = before.dailyGuideAction?.id;
    const taskId = before.dailyGuideTask?.id;
    const goalId = before.goal?.id;
    if (!actionId || !taskId || !goalId) {
      throw new CategorizedError('validation_error', '当前没有可返回的主线步骤，请改用临时学习。');
    }
    let threadId: string;
    if (before.questionThread?.status === 'open') {
      threadId = before.questionThread.id;
      await this.store.addQuestionMessage(threadId, 'user', clean);
    } else {
      threadId = (await this.branch.open('question', { goalId, taskId, actionId }, clean)).threadId;
    }
    return this.answer(threadId, clean, promptProfileId, 'answer_step_question', goalId);
  }

  async askTemporary(
    question: string,
    promptProfileId?: Id,
    threadId?: Id
  ): Promise<QuestionAnswerResult> {
    const clean = requireQuestion(question);
    const thread = threadId
      ? await this.store.getQuestionThread(threadId)
      : await this.store.openQuestion(null, clean, {
          kind: 'question',
          standalone: true,
          metadata: { standalone: true }
        });
    if (!thread) throw new CategorizedError('user_input_error', '找不到要继续的临时学习记录。');
    if (thread.status !== 'open') {
      throw new CategorizedError('validation_error', '这段临时学习已经收口，请开始新的临时学习。');
    }
    if (threadId) {
      await this.store.addQuestionMessage(thread.id, 'user', clean);
    }
    return this.answer(
      thread.id,
      clean,
      promptProfileId,
      'answer_temporary_question',
      thread.goalId ?? undefined
    );
  }

  async getLatestTemporary(): Promise<QuestionAnswerResult | null> {
    const thread = await this.store.getLatestStandaloneQuestionThread();
    if (!thread) return null;
    const messages = await this.store.getQuestionMessages(thread.id);
    const answer = [...messages].reverse().find((item) => item.role === 'assistant')?.content ?? '';
    return {
      thread,
      messages,
      answer,
      resolved: thread.status === 'resolved',
      returnToStepInstruction: '临时学习不会改变当前计划；需要时可将记录关联到已有 Goal。'
    };
  }

  async linkTemporaryToGoal(threadId: Id, goalId: Id): Promise<QuestionAnswerResult> {
    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new CategorizedError('user_input_error', '找不到要关联的学习目标。');
    await this.store.linkQuestionThreadToGoal(threadId, goalId);
    const result = await this.getResult(threadId);
    if (!result) throw new Error('临时学习记录关联后无法重新读取。');
    return result;
  }

  async keepTemporary(threadId: Id): Promise<QuestionAnswerResult> {
    await this.store.resolveQuestion(threadId, '用户选择仅保留临时学习记录。');
    const result = await this.getResult(threadId);
    if (!result) throw new Error('临时学习记录收口后无法重新读取。');
    return result;
  }

  async convertTemporaryToTask(threadId: Id, goalId: Id) {
    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new CategorizedError('user_input_error', '找不到要关联的学习目标。');
    const created = await this.store.createTaskFromTemporary(threadId, goalId);
    const result = await this.getResult(threadId);
    if (!result) throw new Error('临时学习转成 Task 后无法重新读取。');
    return { ...result, ...created };
  }

  private async answer(
    threadId: string,
    question: string,
    promptProfileId: Id | undefined,
    operation: 'answer_step_question' | 'answer_temporary_question',
    goalId?: string
  ): Promise<QuestionAnswerResult> {
    const [thread, messages] = await Promise.all([
      this.store.getQuestionThread(threadId),
      this.store.getQuestionMessages(threadId)
    ]);
    const [built, profile, runtimeSettings] = await Promise.all([
      this.context.build(operation, {
        question,
        conversationHistory: messages.slice(-8).map((message) => ({
          role: message.role,
          content: message.content
        })),
        linkedGoalId: thread?.goalId ?? null
      }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    try {
      const input = {
        mode: 'question' as const,
        question,
        context: built.context,
        profile,
        settings: runtimeSettings,
        traceId: `ta_${crypto.randomUUID()}`
      };
      const run = await this.learningTurn.startTool<typeof input, AnswerStepQuestionAgentOutput>({
        toolName: 'explain',
        input,
        context: {
          kind: 'study',
          scopeType: 'question_thread',
          scopeId: threadId,
          goalId,
          contextVersion: 1
        },
        audit: {
          kind: operation === 'answer_temporary_question' ? 'temporary_question' : 'question',
          provider: 'deepseek',
          model: runtimeSettings.deepseekModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: { contextSourceIds: built.contextSourceIds, question },
          outputSchemaVersion: 'question-answer.v1'
        }
      });
      if (operation === 'answer_temporary_question') {
        await this.store.addQuestionMessage(threadId, 'assistant', run.output.answer);
      } else {
        await this.store.saveQuestionAnswer(threadId, run.output);
      }
      const result = await this.getResult(threadId, run.output);
      if (!result) throw new Error('Conversation 保存失败。');
      return result;
    } catch (error) {
      if (error instanceof CategorizedError) throw error;
      throw new CategorizedError(
        'ai_failure',
        '回答问题时出错；问题已保存在本地，可以重试。',
        error instanceof Error ? error : undefined
      );
    }
  }

  private async getResult(
    threadId: string,
    output?: AnswerStepQuestionAgentOutput
  ): Promise<QuestionAnswerResult | null> {
    const thread = await this.store.getQuestionThread(threadId);
    if (!thread) return null;
    const messages = await this.store.getQuestionMessages(threadId);
    return {
      thread,
      messages,
      answer: output?.answer ?? [...messages].reverse().find((item) => item.role === 'assistant')?.content ?? '',
      resolved: output?.resolved ?? thread.status === 'resolved',
      returnToStepInstruction: output?.returnToStepInstruction
        ?? '临时学习不会改变当前计划；需要时可将记录关联到已有 Goal。'
    };
  }

  private async withPendingInteraction<T extends { intake: { id: string } }>(
    state: T
  ) {
    const pendingInteraction = await this.learningTurn.getOpenInteraction(
      'goal_intake',
      state.intake.id
    );
    return { ...state, pendingInteraction };
  }
}

function requireQuestion(question: string): string {
  const clean = question.trim();
  if (!clean) throw new CategorizedError('user_input_error', '问题不能为空。');
  return clean;
}
