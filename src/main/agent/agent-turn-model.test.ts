import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiClient } from '../ai/ai-client';
import { AiAgentTurnModel } from './agent-turn-model';
import type { AgentTurnModelRequest, MountedAgentTool } from './agent-types';

describe('AiAgentTurnModel', () => {
  const guideTool: MountedAgentTool = {
    name: 'prepare_learning_guide',
    description: '生成当前 Learning Guide',
    inputDescription: '直接返回 Guide 业务对象',
    effect: 'proposal',
    inputSchema: z.object({
      date: z.string(),
      todayGoal: z.string(),
      tasks: z.array(z.object({ title: z.string() })).min(1)
    })
  };

  it('accepts a direct business object when exactly one tool is mounted', async () => {
    const businessOutput = {
      date: '2026-07-28',
      todayGoal: '掌握 Git 基础',
      tasks: [{ title: '理解三区模型' }]
    };
    const generateJson = vi.fn(async (request: { schema: z.ZodTypeAny }) =>
      request.schema.parse(businessOutput)
    );
    const model = new AiAgentTurnModel({ generateJson } as unknown as AiClient);

    const decision = await model.selectNext(createRequest([guideTool]));

    expect(decision).toEqual({
      toolName: 'prepare_learning_guide',
      input: businessOutput,
      metrics: undefined
    });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('keeps accepting the legacy envelope for a single mounted tool', async () => {
    const businessOutput = {
      date: '2026-07-28',
      todayGoal: '掌握 Git 基础',
      tasks: [{ title: '理解三区模型' }]
    };
    const generateJson = vi.fn(async (request: { schema: z.ZodTypeAny }) =>
      request.schema.parse({
        toolName: 'prepare_learning_guide',
        input: businessOutput
      })
    );
    const model = new AiAgentTurnModel({ generateJson } as unknown as AiClient);

    await expect(model.selectNext(createRequest([guideTool]))).resolves.toEqual({
      toolName: 'prepare_learning_guide',
      input: businessOutput,
      metrics: undefined
    });
  });

  it('unwraps one provider-added business wrapper for a single mounted tool', async () => {
    const businessOutput = {
      date: '2026-07-28',
      todayGoal: '掌握 Git 基础',
      tasks: [{ title: '理解三区模型' }]
    };
    const generateJson = vi.fn(async (request: { schema: z.ZodTypeAny }) =>
      request.schema.parse({ guide: businessOutput })
    );
    const model = new AiAgentTurnModel({ generateJson } as unknown as AiClient);

    await expect(model.selectNext(createRequest([guideTool]))).resolves.toEqual({
      toolName: 'prepare_learning_guide',
      input: businessOutput,
      metrics: undefined
    });
  });

  it('keeps tool selection for teaching turns with multiple mounted tools', async () => {
    const explainTool: MountedAgentTool = {
      name: 'explain',
      description: '解释当前内容',
      inputDescription: '{"explanation":"讲解"}',
      effect: 'content',
      inputSchema: z.object({ explanation: z.string().min(1) })
    };
    const askUserTool: MountedAgentTool = {
      name: 'ask_user',
      description: '询问用户',
      inputDescription: '{"question":"问题"}',
      effect: 'pause',
      inputSchema: z.object({ question: z.string().min(1) })
    };
    const generateJson = vi.fn(async (request: { schema: z.ZodTypeAny }) =>
      request.schema.parse({
        toolName: 'explain',
        input: { explanation: '先理解工作区、暂存区和版本库。' }
      })
    );
    const model = new AiAgentTurnModel({ generateJson } as unknown as AiClient);

    await expect(model.selectNext(createRequest([explainTool, askUserTool]))).resolves.toEqual({
      toolName: 'explain',
      input: { explanation: '先理解工作区、暂存区和版本库。' },
      metrics: undefined
    });
  });

  it('多工具决策为 generateJson 注入 ask_user 降级兜底 schema', async () => {
    const explainTool: MountedAgentTool = {
      name: 'explain',
      description: '解释当前内容',
      inputDescription: '{"explanation":"讲解"}',
      effect: 'content',
      inputSchema: z.object({ explanation: z.string().min(1) })
    };
    const askUserTool: MountedAgentTool = {
      name: 'ask_user',
      description: '询问用户',
      inputDescription: '{"question":"问题"}',
      effect: 'pause',
      inputSchema: z.object({ question: z.string().min(1) })
    };
    let captured: unknown;
    const generateJson = vi.fn(async (request: { schema: z.ZodTypeAny }) => {
      captured = request;
      return request.schema.parse({
        toolName: 'explain',
        input: { explanation: '讲解内容' }
      });
    });
    const model = new AiAgentTurnModel({ generateJson } as unknown as AiClient);

    await model.selectNext(createRequest([explainTool, askUserTool]));

    const fallback = (captured as { fallbackSchema?: z.ZodTypeAny }).fallbackSchema;
    expect(fallback).toBeDefined();
    const degraded = fallback?.safeParse({});
    expect(degraded?.success).toBe(true);
    expect(degraded?.data).toMatchObject({
      toolName: 'ask_user',
      input: expect.objectContaining({ canSkip: true })
    });
  });
});

function createRequest(tools: MountedAgentTool[]): AgentTurnModelRequest {
  return {
    intent: 'daily_guide',
    boundedContext: { goal: '掌握 Git' },
    previousToolResults: [],
    tools,
    modelConfig: {
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1/v1',
      model: 'test-model',
      system: 'test-system'
    }
  };
}
