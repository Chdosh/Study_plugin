import { CategorizedError } from '../ai/categorized-error';
import type {
  AgentContext,
  AgentLoopPersistencePort,
  AgentLoopResult,
  AgentRunAudit,
  AgentToolName,
  AskUserRequest,
  PendingAgentInteraction
} from './agent-types';
import { ToolRegistry } from './tool-registry';

export class AgentLoop {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly persistence: AgentLoopPersistencePort
  ) {}

  listMountedTools(context: AgentContext['kind']): AgentToolName[] {
    return this.registry.listForContext(context);
  }

  recoverInterruptedRuns(): Promise<number> {
    return this.persistence.failInterruptedAgentRuns();
  }

  getOpenInteraction(scopeType: string, scopeId: string): Promise<PendingAgentInteraction | null> {
    return this.persistence.getOpenPendingInteraction(scopeType, scopeId);
  }

  async run<TInput, TOutput>(params: {
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }): Promise<AgentLoopResult<TOutput>> {
    const active = await this.persistence.getActiveAgentRun(
      params.context.scopeType,
      params.context.scopeId
    );
    if (active) {
      throw new CategorizedError(
        'validation_error',
        active.status === 'waiting_user'
          ? '当前对话正在等待你的回答，请先回答或取消该问题。'
          : '当前上下文已有 AI 操作正在执行，请稍后重试。'
      );
    }

    const startedAt = new Date().toISOString();
    const runReviewId = await this.persistence.saveAiReview({
      ...params.audit,
      status: 'running',
      output: {},
      recordType: 'run',
      goalId: params.context.goalId,
      conversationScope: params.context.scopeType,
      conversationRefId: params.context.scopeId,
      messageRefId: params.context.messageRefId,
      contextVersion: params.context.contextVersion,
      startedAt
    });

    return this.executeTool<TInput, TOutput>({
      runReviewId,
      toolName: params.toolName,
      input: params.input,
      context: params.context,
      audit: params.audit
    });
  }

  async resume<TInput, TOutput>(params: {
    pendingInteractionId: string;
    answer: string;
    answerMessageRefId?: string;
    expectedContextVersion: number;
    resolution?: 'answered' | 'skipped';
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
    toolName: AgentToolName;
  }): Promise<AgentLoopResult<TOutput>> {
    const pending = await this.persistence.getPendingInteraction(params.pendingInteractionId);
    if (!pending || pending.status !== 'open') {
      throw new CategorizedError('validation_error', '这个问题已经处理，不能重复回答。');
    }
    if (
      pending.scopeType !== params.context.scopeType
      || pending.scopeId !== params.context.scopeId
      || pending.expectedContextVersion !== params.expectedContextVersion
    ) {
      throw new CategorizedError(
        'validation_error',
        '对话内容已发生变化，原问题没有被自动套用。请刷新后重新确认。'
      );
    }

    const answered = params.resolution === 'skipped'
      ? await this.persistence.skipPendingInteraction(pending.id, params.answerMessageRefId)
      : await this.persistence.answerPendingInteraction(
          pending.id,
          params.answer,
          params.answerMessageRefId
        );
    if (!answered) {
      throw new CategorizedError('validation_error', '这个问题已经处理，不能重复回答。');
    }
    await this.persistence.updateAiReview(pending.runReviewId, {
      status: 'running',
      errorMessage: null,
      completedAt: null
    });
    await this.persistence.updateAiReview(pending.toolReviewId, {
      status: 'completed',
      output: {
        resolution: params.resolution ?? 'answered',
        answer: params.resolution === 'skipped' ? null : params.answer
      },
      completedAt: new Date().toISOString()
    });

    return this.executeTool<TInput, TOutput>({
      runReviewId: pending.runReviewId,
      toolName: params.toolName,
      input: params.input,
      context: params.context,
      audit: params.audit
    });
  }

  async cancelPendingInteraction(id: string): Promise<boolean> {
    const pending = await this.persistence.getPendingInteraction(id);
    if (!pending || pending.status !== 'open') return false;
    const cancelled = await this.persistence.cancelPendingInteraction(id);
    if (cancelled) {
      await this.persistence.updateAiReview(pending.toolReviewId, {
        status: 'cancelled',
        completedAt: new Date().toISOString()
      });
      await this.persistence.updateAiReview(pending.runReviewId, {
        status: 'cancelled',
        completedAt: new Date().toISOString()
      });
    }
    return cancelled;
  }

  private async executeTool<TInput, TOutput>(params: {
    runReviewId: string;
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }): Promise<AgentLoopResult<TOutput>> {
    const toolSequence = await this.persistence.getNextAgentToolSequence(params.runReviewId);
    const startedAt = new Date().toISOString();
    let toolReviewId: string | null = null;
    try {
      toolReviewId = await this.persistence.saveAiReview({
        kind: 'tool_call',
        provider: params.audit.provider,
        model: params.audit.model,
        promptProfileId: params.audit.promptProfileId,
        promptVersionId: params.audit.promptVersionId,
        inputSnapshot: params.audit.inputSnapshot,
        output: {},
        outputSchemaVersion: params.audit.outputSchemaVersion,
        status: 'running',
        recordType: 'tool_call',
        parentReviewId: params.runReviewId,
        toolName: params.toolName,
        toolSequence,
        idempotencyKey: params.audit.idempotencyKey
          ? `${params.audit.idempotencyKey}:tool:${toolSequence}`
          : undefined,
        goalId: params.context.goalId,
        conversationScope: params.context.scopeType,
        conversationRefId: params.context.scopeId,
        messageRefId: params.context.messageRefId,
        contextVersion: params.context.contextVersion,
        startedAt
      });
      const execution = await this.registry.execute<TInput, TOutput>(
        params.toolName,
        params.input,
        params.context
      );
      const completedAt = new Date().toISOString();
      await this.persistence.updateAiReview(toolReviewId, {
        status: 'completed',
        output: execution.output,
        metrics: execution.metrics,
        completedAt
      });

      if (execution.requestUser) {
        const interaction = await this.pauseForUser({
          runReviewId: params.runReviewId,
          context: params.context,
          audit: params.audit,
          request: execution.requestUser
        });
        await this.persistence.updateAiReview(params.runReviewId, {
          status: 'waiting_user',
          output: execution.output
        });
        return {
          runReviewId: params.runReviewId,
          status: 'waiting_user',
          output: execution.output,
          pendingInteraction: interaction
        };
      }

      await this.persistence.updateAiReview(params.runReviewId, {
        status: 'completed',
        output: execution.output,
        completedAt
      });
      return {
        runReviewId: params.runReviewId,
        status: 'completed',
        output: execution.output
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      if (toolReviewId) {
        await this.persistence.updateAiReview(toolReviewId, {
          status: 'failed',
          errorMessage: message,
          completedAt
        }).catch(() => undefined);
      }
      await this.persistence.updateAiReview(params.runReviewId, {
        status: 'failed',
        errorMessage: message,
        completedAt
      }).catch(() => undefined);
      throw error;
    }
  }

  private async pauseForUser(params: {
    runReviewId: string;
    context: AgentContext;
    audit: AgentRunAudit;
    request: AskUserRequest;
  }): Promise<PendingAgentInteraction> {
    const askUserExecution = await this.registry.execute<AskUserRequest, AskUserRequest>(
      'ask_user',
      params.request,
      params.context
    );
    const toolSequence = await this.persistence.getNextAgentToolSequence(params.runReviewId);
    const startedAt = new Date().toISOString();
    const askUserReviewId = await this.persistence.saveAiReview({
      kind: 'tool_call',
      provider: 'local',
      model: 'control',
      inputSnapshot: {
        intent: params.request.intent,
        answerMode: params.request.answerMode,
        canSkip: params.request.canSkip
      },
      output: askUserExecution.output,
      outputSchemaVersion: 'ask-user.v1',
      status: 'waiting_user',
      recordType: 'tool_call',
      parentReviewId: params.runReviewId,
      toolName: 'ask_user',
      toolSequence,
      goalId: params.context.goalId,
      conversationScope: params.context.scopeType,
      conversationRefId: params.context.scopeId,
      messageRefId: params.context.messageRefId,
      contextVersion: params.context.contextVersion,
      startedAt
    });

    try {
      return await this.persistence.createPendingInteraction({
        runReviewId: params.runReviewId,
        toolReviewId: askUserReviewId,
        scopeType: params.context.scopeType,
        scopeId: params.context.scopeId,
        request: askUserExecution.output,
        expectedContextVersion: params.context.contextVersion
      });
    } catch (error) {
      await this.persistence.updateAiReview(askUserReviewId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString()
      }).catch(() => undefined);
      throw error;
    }
  }
}
