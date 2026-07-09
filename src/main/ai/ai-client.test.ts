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
    expect(openAiMocks.create.mock.calls[0][1]).toEqual({ timeout: 1234 });
    expect(openAiMocks.create.mock.calls[1][0].messages[1].content).toContain('上一次 AI 输出');
    expect(openAiMocks.create.mock.calls[1][0].messages[1].content).toContain('解析或校验问题');
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
});
