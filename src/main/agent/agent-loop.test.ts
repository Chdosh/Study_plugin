import { describe, expect, it, vi } from 'vitest';
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
    return [...this.reviews.values()].filter((review) => review.parentReviewId === runReviewId).length + 1;
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

  async getPendingInteraction(id: string): Promise<PendingAgentInteraction | null> {
    return this.pending.get(id) ?? null;
  }

  async getOpenPendingInteraction(scopeType: string, scopeId: string) {
    return [...this.pending.values()].find((item) =>
      item.scopeType === scopeType && item.scopeId === scopeId && item.status === 'open'
    ) ?? null;
  }

  async answerPendingInteraction(id: string, answer: string, answerMessageRefId?: string): Promise<boolean> {
    const current = this.pending.get(id);
    if (!current || current.status !== 'open') return false;
    this.pending.set(id, {
      ...current,
      status: 'answered',
      answerText: answer,
      answerMessageRefId: answerMessageRefId ?? null,
      resolvedAt: '2026-07-23T00:01:00.000Z'
    });
    return true;
  }

  async cancelPendingInteraction(id: string): Promise<boolean> {
    const current = this.pending.get(id);
    if (!current || current.status !== 'open') return false;
    this.pending.set(id, {
      ...current,
      status: 'cancelled',
      resolvedAt: '2026-07-23T00:01:00.000Z'
    });
    return true;
  }

  async skipPendingInteraction(id: string, answerMessageRefId?: string): Promise<boolean> {
    const current = this.pending.get(id);
    if (!current || current.status !== 'open') return false;
    this.pending.set(id, {
      ...current,
      status: 'skipped',
      answerMessageRefId: answerMessageRefId ?? null,
      resolvedAt: '2026-07-23T00:01:00.000Z'
    });
    return true;
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
}

const context = {
  kind: 'goal_intake' as const,
  scopeType: 'goal_intake',
  scopeId: 'intake-1',
  contextVersion: 2
};

const audit = {
  kind: 'goal_intake',
  provider: 'test',
  model: 'test',
  inputSnapshot: { messageCount: 1 },
  outputSchemaVersion: 'test.v1'
};

describe('AgentLoop', () => {
  it('通过动态挂载工具完成一次 Run，并分别记录 Run 和工具调用', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'propose_goal',
      description: 'test',
      contexts: ['goal_intake'],
      execute: async (input: { value: string }) => ({ output: { value: input.value } })
    });
    const persistence = new MemoryAgentPersistence();
    const loop = new AgentLoop(registry, persistence);

    const result = await loop.run<{ value: string }, { value: string }>({
      toolName: 'propose_goal',
      input: { value: 'ok' },
      context,
      audit
    });

    expect(result).toMatchObject({ status: 'completed', output: { value: 'ok' } });
    expect([...persistence.reviews.values()].map((item) => item.recordType)).toEqual([
      'run',
      'tool_call'
    ]);
    expect(persistence.reviews.get(result.runReviewId)?.status).toBe('completed');
  });

  it('只允许调用当前上下文挂载的工具', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'evaluate',
      description: 'test',
      contexts: ['evaluation'],
      execute: async () => ({ output: {} })
    });
    const loop = new AgentLoop(registry, new MemoryAgentPersistence());

    await expect(loop.run({
      toolName: 'evaluate',
      input: {},
      context,
      audit
    })).rejects.toThrow('not mounted');
  });

  it('ask_user 暂停后用同一个 runReviewId 恢复，重复回答被拒绝', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn()
      .mockResolvedValueOnce({
        output: { status: 'need_more_info' },
        requestUser: {
          question: '你每天能投入多久？',
          reason: '缺少时间约束',
          answerMode: 'free_text',
          canSkip: true,
          intent: 'continue_goal_intake'
        }
      })
      .mockResolvedValueOnce({ output: { status: 'ready' } });
    registry.register({
      name: 'propose_goal',
      description: 'test',
      contexts: ['goal_intake'],
      execute
    });
    registry.register({
      name: 'ask_user',
      description: 'test',
      contexts: ['goal_intake'],
      execute: async (input) => ({ output: input })
    });
    const persistence = new MemoryAgentPersistence();
    const loop = new AgentLoop(registry, persistence);

    const waiting = await loop.run({
      toolName: 'propose_goal',
      input: { messages: ['目标'] },
      context,
      audit
    });
    expect(waiting.status).toBe('waiting_user');
    expect(waiting.pendingInteraction?.question).toBe('你每天能投入多久？');

    await expect(loop.resume({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: '过期上下文中的回答',
      expectedContextVersion: 99,
      input: {},
      context,
      audit,
      toolName: 'propose_goal'
    })).rejects.toThrow('对话内容已发生变化');
    expect(persistence.pending.get(waiting.pendingInteraction!.id)?.status).toBe('open');

    const resumed = await loop.resume({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: '每天一小时',
      expectedContextVersion: 2,
      input: { messages: ['目标', '每天一小时'] },
      context: { ...context, contextVersion: 4 },
      audit,
      toolName: 'propose_goal'
    });
    expect(resumed.runReviewId).toBe(waiting.runReviewId);
    expect(resumed.status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(2);

    await expect(loop.resume({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: '重复回答',
      expectedContextVersion: 2,
      input: {},
      context,
      audit,
      toolName: 'propose_goal'
    })).rejects.toThrow('已经处理');
  });

  it('工具失败时同时关闭工具调用和根 Run 的运行状态', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'propose_goal',
      description: 'test',
      contexts: ['goal_intake'],
      execute: async () => {
        throw new Error('model failed');
      }
    });
    const persistence = new MemoryAgentPersistence();
    const loop = new AgentLoop(registry, persistence);

    await expect(loop.run({ toolName: 'propose_goal', input: {}, context, audit }))
      .rejects.toThrow('model failed');
    expect([...persistence.reviews.values()].every((item) => item.status === 'failed')).toBe(true);
  });

  it('支持显式跳过或取消 ask_user，且不会留下 waiting_user 工具调用', async () => {
    const makeRegistry = () => {
      const registry = new ToolRegistry();
      const execute = vi.fn()
        .mockResolvedValueOnce({
          output: { status: 'need_more_info' },
          requestUser: {
            question: '是否补充期限？',
            reason: '期限可选',
            answerMode: 'free_text',
            canSkip: true,
            intent: 'optional_deadline'
          }
        })
        .mockResolvedValueOnce({ output: { status: 'ready' } });
      registry.register({
        name: 'propose_goal',
        description: 'test',
        contexts: ['goal_intake'],
        execute
      });
      registry.register({
        name: 'ask_user',
        description: 'test',
        contexts: ['goal_intake'],
        execute: async (input) => ({ output: input })
      });
      return registry;
    };

    const skippedPersistence = new MemoryAgentPersistence();
    const skippedLoop = new AgentLoop(makeRegistry(), skippedPersistence);
    const waiting = await skippedLoop.run({
      toolName: 'propose_goal',
      input: {},
      context,
      audit
    });
    await skippedLoop.resume({
      pendingInteractionId: waiting.pendingInteraction!.id,
      answer: '使用已有信息',
      expectedContextVersion: 2,
      resolution: 'skipped',
      input: {},
      context: { ...context, contextVersion: 3 },
      audit,
      toolName: 'propose_goal'
    });
    expect(skippedPersistence.pending.get(waiting.pendingInteraction!.id)?.status).toBe('skipped');
    expect([...skippedPersistence.reviews.values()].some((item) => item.status === 'waiting_user'))
      .toBe(false);

    const cancelledPersistence = new MemoryAgentPersistence();
    const cancelledLoop = new AgentLoop(makeRegistry(), cancelledPersistence);
    const cancellable = await cancelledLoop.run({
      toolName: 'propose_goal',
      input: {},
      context: { ...context, scopeId: 'intake-cancel' },
      audit
    });
    await expect(
      cancelledLoop.cancelPendingInteraction(cancellable.pendingInteraction!.id)
    ).resolves.toBe(true);
    expect(cancelledPersistence.pending.get(cancellable.pendingInteraction!.id)?.status)
      .toBe('cancelled');
    expect([...cancelledPersistence.reviews.values()].some((item) => item.status === 'waiting_user'))
      .toBe(false);
  });
});
