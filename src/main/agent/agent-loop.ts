import { CategorizedError } from '../ai/categorized-error';
import type {
  AgentContext,
  AgentLoopPersistencePort,
  AgentLoopResult,
  AgentRunAudit,
  AgentTurnInput,
  AgentTurnModel,
  AgentTurnToolResult,
  AgentToolName,
  AskUserRequest,
  PendingAgentInteraction
} from './agent-types';
import { ToolRegistry } from './tool-registry';

export class AgentLoop {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly persistence: AgentLoopPersistencePort,
    private readonly turnModel?: AgentTurnModel
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

  async runTurn<TOutput>(params: AgentTurnInput): Promise<AgentLoopResult<TOutput>> {
    if (!this.turnModel) {
      throw new Error('Agent Loop 没有配置 Learning Turn 决策模型。');
    }
    const active = await this.persistence.getActiveAgentRun(
      params.context.scopeType,
      params.context.scopeId
    );
    if (active) {
      throw new CategorizedError(
        'validation_error',
        active.status === 'waiting_user'
          ? '当前学习对话正在等待你的回答，请先回答或取消该问题。'
          : '当前学习上下文已有 AI 操作正在执行，请稍后重试。'
      );
    }

    const runReviewId = await this.persistence.saveAiReview({
      ...params.audit,
      status: 'running',
      output: {
        intent: params.intent,
        phase: 'selecting_tool',
        completedTools: []
      },
      recordType: 'run',
      goalId: params.context.goalId,
      conversationScope: params.context.scopeType,
      conversationRefId: params.context.scopeId,
      messageRefId: params.context.messageRefId,
      contextVersion: params.context.contextVersion,
      startedAt: new Date().toISOString()
    });
    return this.continueTurn<TOutput>(runReviewId, params, []);
  }

  async resumeTurn<TOutput>(params: {
    pendingInteractionId: string;
    answer: string;
    answerMessageRefId?: string;
    expectedContextVersion: number;
    resolution?: 'answered' | 'skipped';
    turn: AgentTurnInput;
  }): Promise<AgentLoopResult<TOutput>> {
    const pending = await this.persistence.getPendingInteraction(params.pendingInteractionId);
    if (!pending || pending.status !== 'open') {
      throw new CategorizedError('validation_error', '这个问题已经处理，不能重复回答。');
    }
    if (
      pending.scopeType !== params.turn.context.scopeType
      || pending.scopeId !== params.turn.context.scopeId
      || pending.expectedContextVersion !== params.expectedContextVersion
    ) {
      throw new CategorizedError(
        'validation_error',
        '学习上下文已经变化，原问题没有被自动套用。请刷新后重新确认。'
      );
    }
    const savedRun = await this.persistence.getAgentRunState(pending.runReviewId);
    if (!savedRun || savedRun.status !== 'waiting_user') {
      throw new CategorizedError('validation_error', '原 Learning Turn 已经结束，不能继续恢复。');
    }
    const savedOutput = savedRun.output as {
      intent?: unknown;
      completedTools?: unknown;
    };
    const previousToolResults = Array.isArray(savedOutput.completedTools)
      ? savedOutput.completedTools as AgentTurnToolResult[]
      : [];
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
    await this.persistence.updateAiReview(pending.toolReviewId, {
      status: 'completed',
      output: {
        resolution: params.resolution ?? 'answered',
        answer: params.resolution === 'skipped' ? null : params.answer
      },
      completedAt: new Date().toISOString()
    });
    await this.persistence.updateAiReview(pending.runReviewId, {
      status: 'running',
      output: {
        intent: params.turn.intent,
        phase: 'selecting_tool',
        completedTools: previousToolResults,
        userAnswer: params.resolution === 'skipped' ? null : params.answer
      },
      errorMessage: null,
      completedAt: null
    });
    return this.continueTurn<TOutput>(
      pending.runReviewId,
      {
        ...params.turn,
        userInput: params.answer
      },
      previousToolResults
    );
  }

  private async continueTurn<TOutput>(
    runReviewId: string,
    params: AgentTurnInput,
    previousToolResults: AgentTurnToolResult[]
  ): Promise<AgentLoopResult<TOutput>> {
    if (!this.turnModel) {
      throw new Error('Agent Loop 没有配置 Learning Turn 决策模型。');
    }
    const tools = this.registry.describeForContext(params.context.kind, params.allowedTools);
    if (tools.length === 0) {
      throw new CategorizedError('validation_error', '当前学习上下文没有可用工具。');
    }
    const maxToolCalls = Math.min(Math.max(params.maxToolCalls ?? 6, 1), 6);
    const startingSequence = await this.persistence.getNextAgentToolSequence(runReviewId);
    const remainingToolCalls = Math.max(0, maxToolCalls - (startingSequence - 1));

    try {
      for (let index = 0; index < remainingToolCalls; index += 1) {
        const decision = await this.turnModel.selectNext({
          intent: params.intent,
          userInput: params.userInput,
          boundedContext: params.boundedContext,
          previousToolResults: [...previousToolResults],
          tools,
          modelConfig: {
            ...params.modelConfig,
            traceId: startingSequence === 1 && index === 0
              ? params.modelConfig.traceId
              : `${params.modelConfig.traceId ?? runReviewId}:${startingSequence + index}`
          }
        });
        const definition = this.registry.get(decision.toolName);
        if (!definition || !tools.some((tool) => tool.name === decision.toolName)) {
          throw new CategorizedError(
            'validation_error',
            `Agent 选择了当前上下文未挂载的工具：${decision.toolName}`
          );
        }

        const toolSequence = await this.persistence.getNextAgentToolSequence(runReviewId);
        const toolReviewId = await this.persistence.saveAiReview({
          kind: 'tool_call',
          provider: params.audit.provider,
          model: params.audit.model,
          promptProfileId: params.audit.promptProfileId,
          promptVersionId: params.audit.promptVersionId,
          inputSnapshot: decision.input,
          output: {},
          outputSchemaVersion: params.audit.outputSchemaVersion,
          status: 'running',
          recordType: 'tool_call',
          parentReviewId: runReviewId,
          toolName: decision.toolName,
          toolSequence,
          idempotencyKey: params.audit.idempotencyKey
            ? `${params.audit.idempotencyKey}:tool:${toolSequence}`
            : undefined,
          goalId: params.context.goalId,
          conversationScope: params.context.scopeType,
          conversationRefId: params.context.scopeId,
          messageRefId: params.context.messageRefId,
          contextVersion: params.context.contextVersion,
          startedAt: new Date().toISOString()
        });

        try {
          const execution = await this.registry.execute(
            decision.toolName,
            decision.input,
            {
              ...params.context,
              runReviewId,
              toolReviewId,
              toolSequence
            }
          );
          const continuation = execution.continuation
            ?? definition.continuation
            ?? (definition.effect === 'read' ? 'continue' : 'complete');
          const toolResult: AgentTurnToolResult = {
            toolName: decision.toolName,
            toolReviewId,
            input: decision.input,
            output: execution.output
          };

          if (execution.requestUser) {
            await this.persistence.updateAiReview(toolReviewId, {
              status: 'completed',
              output: execution.output,
              metrics: decision.metrics ?? execution.metrics,
              completedAt: new Date().toISOString()
            });
            previousToolResults.push(toolResult);
            const interaction = await this.pauseForUser({
              runReviewId,
              context: params.context,
              audit: params.audit,
              request: execution.requestUser
            });
            await this.persistence.updateAiReview(runReviewId, {
              status: 'waiting_user',
              output: {
                intent: params.intent,
                phase: 'waiting_user',
                completedTools: previousToolResults
              }
            });
            return {
              runReviewId,
              status: 'waiting_user',
              output: execution.output as TOutput,
              toolResults: [...previousToolResults],
              pendingInteraction: interaction
            };
          }

          if (continuation === 'pause') {
            const request = execution.output as AskUserRequest;
            await this.persistence.updateAiReview(toolReviewId, {
              status: 'waiting_user',
              output: request,
              metrics: decision.metrics
            });
            previousToolResults.push(toolResult);
            const interaction = await this.persistence.createPendingInteraction({
              runReviewId,
              toolReviewId,
              scopeType: params.context.scopeType,
              scopeId: params.context.scopeId,
              request,
              expectedContextVersion: params.context.contextVersion
            });
            await this.persistence.updateAiReview(runReviewId, {
              status: 'waiting_user',
              output: {
                intent: params.intent,
                phase: 'waiting_user',
                completedTools: previousToolResults
              }
            });
            return {
              runReviewId,
              status: 'waiting_user',
              output: execution.output as TOutput,
              toolResults: [...previousToolResults],
              pendingInteraction: interaction
            };
          }

          await this.persistence.updateAiReview(toolReviewId, {
            status: 'completed',
            output: execution.output,
            metrics: decision.metrics ?? execution.metrics,
            completedAt: new Date().toISOString()
          });
          previousToolResults.push(toolResult);

          if (continuation === 'complete') {
            await this.persistence.updateAiReview(runReviewId, {
              status: 'completed',
              output: {
                intent: params.intent,
                phase: 'completed',
                completedTools: previousToolResults,
                artifact: execution.output
              },
              completedAt: new Date().toISOString()
            });
            return {
              runReviewId,
              status: 'completed',
              output: execution.output as TOutput,
              toolResults: [...previousToolResults]
            };
          }
          await this.persistence.updateAiReview(runReviewId, {
            output: {
              intent: params.intent,
              phase: 'selecting_tool',
              completedTools: previousToolResults
            }
          });
        } catch (error) {
          await this.persistence.updateAiReview(toolReviewId, {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            completedAt: new Date().toISOString()
          }).catch(() => undefined);
          throw error;
        }
      }
      throw new CategorizedError(
        'validation_error',
        `Agent Loop 已达到 ${maxToolCalls} 次工具调用上限，未能完成本轮学习。`
      );
    } catch (error) {
      await this.persistence.updateAiReview(runReviewId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString()
      }).catch(() => undefined);
      throw error;
    }
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
