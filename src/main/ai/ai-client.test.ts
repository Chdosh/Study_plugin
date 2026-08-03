import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: openAiMocks.create
      }
    }
  }))
}));

import { AiClient } from './ai-client';

describe('AiClient', () => {
  beforeEach(() => {
    openAiMocks.create.mockReset();
  });

  const testSchema = z.object({
    result: z.literal('passed'),
    evidence: z.array(z.string()).min(1)
  });

  it.each([
    [{ apiKey: null, baseUrl: 'http://127.0.0.1/v1', model: 'test-model' }, 'API Key'],
    [{ apiKey: 'test-key', baseUrl: ' ', model: 'test-model' }, '服务地址'],
    [{ apiKey: 'test-key', baseUrl: 'http://127.0.0.1/v1', model: ' ' }, '模型名称']
  ])('rejects incomplete provider configuration before making a request', async (config, missing) => {
    await expect(new AiClient().generateJson({
      ...config,
      system: 'test-agent',
      user: 'return evaluation json',
      schema: testSchema
    })).rejects.toThrow(missing);

    expect(openAiMocks.create).not.toHaveBeenCalled();
  });

  it('asks the model to repair JSON once when schema validation fails', async () => {
    openAiMocks.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ result: 'passed' }) } }]
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ result: 'passed', evidence: ['ok'] }) } }]
      });

    const output = await new AiClient().generateJson({
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1/v1',
      model: 'test-model',
      system: 'test-agent',
      user: 'return evaluation json',
      timeoutMs: 1234,
      schema: testSchema
    });

    expect(output).toEqual({ result: 'passed', evidence: ['ok'] });
    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
    expect(openAiMocks.create.mock.calls[0][1]).toEqual({ timeout: 1234, maxRetries: 0 });
    expect(openAiMocks.create.mock.calls[1][0].messages[1].content).toContain('上一次 AI 输出');
    expect(openAiMocks.create.mock.calls[1][0].messages[1].content).toContain('解析或校验问题');
  });

  it('normalizes JSON returned through reasoning_content by an OpenAI-compatible model', async () => {
    openAiMocks.create.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          reasoning_content: [
            '先检查一个无关对象：{"draft":true}',
            JSON.stringify({ result: 'passed', evidence: ['ok'] })
          ].join('\n')
        }
      }]
    });

    const output = await new AiClient().generateJson({
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1/v1',
      model: 'reasoning-model',
      system: 'test-agent',
      user: 'return evaluation json',
      schema: testSchema
    });

    expect(output).toEqual({ result: 'passed', evidence: ['ok'] });
    expect(openAiMocks.create.mock.calls[0][1]).toEqual({ timeout: 180_000, maxRetries: 0 });
  });

  it('throws after repair also fails schema validation', async () => {
    openAiMocks.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ result: 'passed' }) } }]
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ result: 'passed' }) } }]
      });

    await expect(
      new AiClient().generateJson({
        apiKey: 'test-key',
        baseUrl: 'http://127.0.0.1/v1',
        model: 'test-model',
        system: 'test-agent',
        user: 'return evaluation json',
        schema: testSchema
      })
    ).rejects.toThrow();

    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
  });

  it('reconstructs a usable object from the fallback schema when repair also fails', async () => {
    openAiMocks.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({}) } }]
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({}) } }]
      });

    const fallbackSchema = z.object({
      explanation: z.string().default('默认讲解'),
      userAction: z.string().default('继续当前步骤'),
      requiresSubmission: z.boolean().default(false)
    });

    const output = await new AiClient().generateJson({
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1/v1',
      model: 'test-model',
      system: 'test-agent',
      user: 'return teaching json',
      schema: testSchema,
      fallbackSchema
    });

    expect(output).toEqual({
      explanation: '默认讲解',
      userAction: '继续当前步骤',
      requiresSubmission: false
    });
    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
  });

  it('fallback 在修复输出连合法 JSON 都不是时改用原始内容重建', async () => {
    openAiMocks.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ result: 'passed' }) } }]
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '我无法修复这个 JSON。' } }]
      });

    const fallbackSchema = z.preprocess(
      () => ({
        result: 'unclear',
        evidence: ['生成评价失败，请人工检查。'],
        correctParts: [],
        misconceptions: [],
        missingRequirements: [],
        feedback: '评价生成失败，请稍后重试。',
        recommendedAction: 'request_user_decision'
      }),
      z.object({
        result: z.literal('unclear'),
        evidence: z.array(z.string()),
        correctParts: z.array(z.string()),
        misconceptions: z.array(z.string()),
        missingRequirements: z.array(z.string()),
        feedback: z.string().min(1),
        recommendedAction: z.literal('request_user_decision')
      })
    );

    const output = await new AiClient().generateJson({
      apiKey: 'test-key',
      baseUrl: 'http://127.0.0.1/v1',
      model: 'test-model',
      system: 'test-agent',
      user: 'return evaluation json',
      schema: testSchema,
      fallbackSchema
    });

    expect(output).toMatchObject({
      result: 'unclear',
      recommendedAction: 'request_user_decision'
    });
    expect(openAiMocks.create).toHaveBeenCalledTimes(2);
  });
});
