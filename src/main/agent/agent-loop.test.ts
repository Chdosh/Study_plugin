import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CategorizedError } from '../ai/categorized-error';
import { AgentLoop } from './agent-loop';
import type {
  AgentLoopPersistencePort,
  AgentRunStatus,
  CreatePendingInteractionInput,
  PendingAgentInteraction,
  SaveAiReviewInput,
  UpdateAiReviewInput
} from './agent-types';
import { ToolRegistry } from './tool-registry';

class MemoryAgentPersistence implements AgentLoopPersistencePort {
  readonly reviews = new Map<string, SaveAiReviewInput & { id: string }>();
  readonly pending = new Map<string, PendingAgentInteraction>();
  private reviewSequence = 0;
  private pendingSequence = 0;

  async saveAiReview(params: SaveAiReviewInput): Promise<string> {
    const id = `review-${++this.reviewSequence}`;
    this.reviews.set(id, { ...params, id });
    return id;
  }

  async updateAiReview(id: string, patch: UpdateAiReviewInput): Promise<void> {
    const current = this.reviews.get(id);
    if (!current) throw new Error(`Missing review ${id}`);
    this.reviews.set(id, {
      ...current,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(!('output' in patch) ? {} : { output: patch.output }),
      ...(!('errorMessage' in patch) ? {} : { errorMessage: patch.errorMessage ?? undefined }),
      ...(!('completedAt' in patch) ? {} : { completedAt: patch.completedAt ?? undefined }),
      ...(patch.metrics ? { metrics: patch.metrics } : {})
    });
  }

  async getAgentRunState(id: string) {
    const found = this.reviews.get(id);
    if (!found || found.recordType !== 'run') return null;
    return { id, status: found.status as AgentRunStatus, output: found.output };
  }

  async getActiveAgentRun(scopeType: string, scopeId: string) {
    const found = [...this.reviews.values()].find((review) =>
      review.recordType === 'run'
      && review.conversationScope === scopeType
      && review.conversationRefId === scopeId
      && (review.status === 'running' || review.status === 'waiting_user')
    );
    if (!found || (found.status !== 'running' && found.status !== 'waiting_user')) return null;
    return { id: found.id, status: found.status };
  }

  async getNextAgentToolSequence(runReviewId: string): Promise<number> {
    return [...this.reviews.values()].filter((review) =>
      review.parentReviewId === runReviewId
    ).length + 1;
  }

  async createPendingInteraction(params: CreatePendingInteractionInput): Promise<PendingAgentInteraction> {
    const interaction: PendingAgentInteraction = {
      id: `pending-${++this.pendingSequence}`,
      runReviewId: params.runReviewId,
      toolReviewId: params.toolReviewId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      question: params.request.question,
      reason: params.request.reason,
      answerMode: params.request.answerMode,
      options: params.request.options ?? [],
      canSkip: params.request.canSkip,
      intent: params.request.intent,
      expectedContextVersion: params.expectedContextVersion,
      status: 'open',
      answerText: null,
      answerMessageRefId: null,
      createdAt: '2026-07-23T00:00:00.000Z',
      resolvedAt: null
    };
    this.pending.set(interaction.id, interaction);
    return interaction;
  }

  async getPendingInteraction(id: string) {
    return this.pending.get(id) ?? null;
  }

  async getOpenPendingInteraction(scopeType: string, scopeId: string) {
    return [...this.pending.values()].find((item) =>
      item.scopeType === scopeType && item.scopeId === scopeId && item.status === 'open'
    ) ?? null;
  }

  async answerPendingInteraction(id: string, answer: string, answerMessageRefId?: string) {
    return this.resolvePending(id, 'answered', answer, answerMessageRefId);
  }

  async skipPendingInteraction(id: string, answerMessageRefId?: string) {
    return this.resolvePending(id, 'skipped', null, answerMessageRefId);
  }

  async cancelPendingInteraction(id: string) {
    return this.resolvePending(id, 'cancelled', null);
  }

  async failInterruptedAgentRuns(): Promise<number> {
    let count = 0;
    for (const [id, review] of this.reviews) {
      if (review.recordType === 'run' && review.status === 'running') {
        this.reviews.set(id, { ...review, status: 'failed' });
        count += 1;
      }
    }
    return count;
  }

  private async resolvePending(
    id: string,
    status: 'answered' | 'skipped' | 'cancelled',
    answerText: string | null,
    answerMessageRefId?: string
  ): Promise<boolean> {
    const current = this.pending.get(id);
    if (!current || current.status !== 'open') return false;
    this.pending.set(id, {
      ...current,
      status,
      answerText,
      answerMessageRefId: answerMessageRefId ?? null,
      resolvedAt: '2026-07-23T00:01:00.000Z'
    });
    return true;
  }
}

const context = {
  kind: 'study' as const,
  scopeType: 'learning_action',
  scopeId: 'action-1',
  contextVersion: 3
};

const audit = {
  kind: 'learning_turn',
  provider: 'test',
  model: 'test',
  inputSnapshot: { actionId: 'action-1' },
  outputSchemaVersion: 'test.v1'
};

const modelConfig = {
  apiKey: 'test',
  baseUrl: 'http://localhost',
  model: 'test',
  system: 'test'
};

describe('AgentLoop autonomous Learning Turn', () => {
  it('自主串联 search_kb → explain，并分别记录 Run 和工具调用', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'search_kb',
      description: '查询个人知识',
      contexts: ['study'],
      inputSchema: z.object({ query: z.string().min(1) }),
      effect: 'read',
      continuation: 'continue',
      execute: async ({ query }) => ({ output: [{ summary: `${query} 的个人知识` }] })
    });
    registry.register({
      name: 'explain',
      description: '讲解',
      contexts: ['study'],
      inputSchema: z.object({
        explanation: z.string(),
        userAction: z.string(),
        requiresSubmission: z.boolean()
      }),
      continuation: 'complete',
      execute: async (input) => ({ output: input })
    });
    const selectNext = vi.fn()
      .mockResolvedValueOnce({ toolName: 'search_kb', input: { query: '闭包' } })
      .mockResolvedValueOnce({
        toolName: 'explain',
        input: {
          explanation: '闭包会保留词法作用域。',
          userAction: '写一个计数器。',
          requiresSubmission: true
        }
      });
    const persistence = new MemoryAgentPersistence();
    const loop = new AgentLoop(registry, persistence, { selectNext });

    const result = await loop.runTurn({
      intent: 'continue_teaching',
      boundedContext: { action: { title: '理解闭包' } },
      context,
      audit,
      modelConfig,
      allowedTools: ['search_kb', 'explain']
    });

    expect(result).toMatchObject({
      status: 'completed',
      output: { userAction: '写一个计数器。' }
    });
    expect(selectNext).toHaveBeenNthCalledWith(2, expect.objectContaining({
      previousToolResults: [
        expect.objectContaining({ toolName: 'search_kb' })
      ]
    }));
    expect([...persistence.reviews.values()].map((item) => item.recordType)).toEqual([
      'run',
      'tool_call',
      'tool_call'
    ]);
  });

  it('ask_user 后可重建 Loop 并恢复同一个 Run；重复回答不会推进', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'ask_user',
      description: '询问',
      contexts: ['study'],
      effect: 'pause',
      continuation: 'pause',
      execute: async (input) => ({ output: input })
    });
    registry.register({
      name: 'practice',
      description: '练习',
      contexts: ['study'],
      continuation: 'complete',
      execute: async (input) => ({ output: input })
    });
    const persistence = new MemoryAgentPersistence();
    const firstLoop = new AgentLoop(registry, persistence, {
      selectNext: async () => ({
        toolName: 'ask_user',
        input: {
          question: '使用哪种语言？',
          reason: '选择示例语言',
          answerMode: 'free_text',
          canSkip: false,
          intent: 'choose_language'
        }
      })
    });
    const turn = {
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['ask_user', 'practice'] as const
    };
    const waiting = await firstLoop.runTurn(turn);
    const restarted = new AgentLoop(registry, persistence, {
      selectNext: async () => ({
        toolName: 'practice',
        input: { explanation: 'TypeScript 练习', userAction: '实现计数器' }
      })
    });
    const resumed = await restarted.resumeTurn({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: 'TypeScript',
      expectedContextVersion: context.contextVersion,
      turn
    });

    expect(resumed.runReviewId).toBe(waiting.runReviewId);
    expect(resumed.status).toBe('completed');
    await expect(restarted.resumeTurn({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: 'JavaScript',
      expectedContextVersion: context.contextVersion,
      turn
    })).rejects.toThrow('已经处理');
  });

  it('quiz → ask_user → evaluate 在同一个可恢复 Run 中保留完整工具结果', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'quiz',
      description: '小测',
      contexts: ['study'],
      continuation: 'continue',
      execute: async (input) => ({ output: input })
    });
    registry.register({
      name: 'ask_user',
      description: '等待回答',
      contexts: ['study'],
      continuation: 'pause',
      execute: async (input) => ({ output: input })
    });
    registry.register({
      name: 'evaluate',
      description: '即时评价',
      contexts: ['study'],
      continuation: 'complete',
      execute: async (input) => ({ output: input })
    });
    const persistence = new MemoryAgentPersistence();
    const firstSelect = vi.fn()
      .mockResolvedValueOnce({
        toolName: 'quiz',
        input: {
          explanation: '检查类型契约理解。',
          questions: [{ prompt: '返回类型为什么重要？', answerFormat: '一句话' }],
          userAction: '回答问题。',
          requiresSubmission: false
        }
      })
      .mockResolvedValueOnce({
        toolName: 'ask_user',
        input: {
          question: '返回类型为什么重要？',
          reason: '需要根据回答判断理解。',
          answerMode: 'free_text',
          canSkip: false,
          intent: 'evaluate_quiz_answer'
        }
      });
    const turn = {
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['quiz', 'ask_user', 'evaluate'] as const
    };
    const waiting = await new AgentLoop(registry, persistence, {
      selectNext: firstSelect
    }).runTurn(turn);

    expect(waiting.status).toBe('waiting_user');
    expect(waiting.toolResults.map((item) => item.toolName)).toEqual([
      'quiz',
      'ask_user'
    ]);

    const resumedSelect = vi.fn().mockResolvedValue({
      toolName: 'evaluate',
      input: {
        mode: 'conversation_response',
        feedback: '回答抓住了契约约束。',
        correctParts: ['返回类型约束调用方'],
        misconceptions: [],
        nextPrompt: '继续实现当前 Action。',
        requiresSubmission: false
      }
    });
    const resumed = await new AgentLoop(registry, persistence, {
      selectNext: resumedSelect
    }).resumeTurn({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: '它能约束调用方如何使用结果。',
      expectedContextVersion: context.contextVersion,
      turn
    });

    expect(resumed.runReviewId).toBe(waiting.runReviewId);
    expect(resumed.toolResults.map((item) => item.toolName)).toEqual([
      'quiz',
      'ask_user',
      'evaluate'
    ]);
    expect(resumedSelect).toHaveBeenCalledWith(expect.objectContaining({
      userInput: '它能约束调用方如何使用结果。',
      previousToolResults: expect.arrayContaining([
        expect.objectContaining({ toolName: 'quiz' }),
        expect.objectContaining({ toolName: 'ask_user' })
      ])
    }));
  });

  it('拒绝未挂载工具，并在工具失败时关闭根 Run', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'explain',
      description: '失败工具',
      contexts: ['study'],
      execute: async () => {
        throw new Error('tool failed');
      }
    });
    const persistence = new MemoryAgentPersistence();
    const forbidden = new AgentLoop(registry, persistence, {
      selectNext: async () => ({ toolName: 'evaluate', input: {} })
    });
    await expect(forbidden.runTurn({
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['explain']
    })).rejects.toThrow('未挂载');

    const failingPersistence = new MemoryAgentPersistence();
    const failing = new AgentLoop(registry, failingPersistence, {
      selectNext: async () => ({ toolName: 'explain', input: {} })
    });
    await expect(failing.runTurn({
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['explain']
    })).rejects.toThrow('tool failed');
    expect([...failingPersistence.reviews.values()].every((item) =>
      item.status === 'failed'
    )).toBe(true);
  });

  it('模型结构校验失败时只记录安全字段诊断，不保存模型原文', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'explain',
      description: '讲解',
      contexts: ['study'],
      execute: async (input) => ({ output: input })
    });
    const persistence = new MemoryAgentPersistence();
    const schemaError = new z.ZodError([{
      code: z.ZodIssueCode.invalid_type,
      expected: 'string',
      received: 'undefined',
      path: ['explanation'],
      message: 'Required'
    }]);
    const loop = new AgentLoop(registry, persistence, {
      selectNext: async () => {
        throw new CategorizedError(
          'schema_violation',
          'AI 返回内容未通过业务格式校验；原始数据已保留，请在对应记录中重试。',
          schemaError
        );
      }
    });

    await expect(loop.runTurn({
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['explain']
    })).rejects.toThrow('格式校验');

    expect([...persistence.reviews.values()][0]).toMatchObject({
      status: 'failed',
      output: {
        phase: 'failed',
        diagnostic: {
          category: 'schema_violation',
          issues: [{ path: 'explanation', message: 'Required' }]
        }
      }
    });
    expect(JSON.stringify([...persistence.reviews.values()][0].output))
      .not.toContain('模型原文');
  });

  it('达到工具调用上限时失败，并可取消等待中的 Run', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'search_kb',
      description: '一直继续',
      contexts: ['study'],
      effect: 'read',
      continuation: 'continue',
      execute: async () => ({ output: [] })
    });
    const persistence = new MemoryAgentPersistence();
    const loop = new AgentLoop(registry, persistence, {
      selectNext: async () => ({ toolName: 'search_kb', input: {} })
    });
    await expect(loop.runTurn({
      intent: 'continue_teaching',
      boundedContext: {},
      context,
      audit,
      modelConfig,
      allowedTools: ['search_kb'],
      maxToolCalls: 2
    })).rejects.toThrow('调用上限');

    const askRegistry = new ToolRegistry();
    askRegistry.register({
      name: 'ask_user',
      description: '询问',
      contexts: ['study'],
      effect: 'pause',
      continuation: 'pause',
      execute: async (input) => ({ output: input })
    });
    const askPersistence = new MemoryAgentPersistence();
    const askLoop = new AgentLoop(askRegistry, askPersistence, {
      selectNext: async () => ({
        toolName: 'ask_user',
        input: {
          question: '继续吗？',
          reason: '需要决定',
          answerMode: 'free_text',
          canSkip: true,
          intent: 'continue'
        }
      })
    });
    const waiting = await askLoop.runTurn({
      intent: 'continue_teaching',
      boundedContext: {},
      context: { ...context, scopeId: 'action-cancel' },
      audit,
      modelConfig,
      allowedTools: ['ask_user']
    });
    await expect(
      askLoop.cancelPendingInteraction(waiting.pendingInteraction!.id)
    ).resolves.toBe(true);
    expect(askPersistence.pending.get(waiting.pendingInteraction!.id)?.status)
      .toBe('cancelled');
  });
});
