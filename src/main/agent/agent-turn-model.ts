import { z } from 'zod';
import { AiClient, type AiCallMetrics } from '../ai/ai-client';
import type {
  AgentTurnDecision,
  AgentTurnModel,
  AgentTurnModelRequest,
  AgentToolName
} from './agent-types';

const decisionSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.unknown())
});

export class AiAgentTurnModel implements AgentTurnModel {
  constructor(private readonly ai: AiClient) {}

  async selectNext(request: AgentTurnModelRequest): Promise<AgentTurnDecision> {
    if (request.tools.length === 0) {
      throw new Error('当前上下文没有可用的 Agent 工具。');
    }

    let metrics: AiCallMetrics | undefined;
    const decision = await this.ai.generateJson({
      apiKey: request.modelConfig.apiKey,
      baseUrl: request.modelConfig.baseUrl,
      model: request.modelConfig.model,
      system: request.modelConfig.system,
      timeoutMs: request.modelConfig.timeoutMs,
      traceId: request.modelConfig.traceId,
      schema: decisionSchema,
      user: [
        `本轮学习意图：${request.intent}`,
        request.userInput ? `用户输入：${request.userInput}` : '',
        `可信学习上下文：${JSON.stringify(request.boundedContext)}`,
        `已经完成的工具调用：${JSON.stringify(request.previousToolResults)}`,
        '从下面已挂载工具中选择且只选择一个工具。input 必须符合该工具的输入说明。',
        '如果已有信息足以直接教学，选择内容类工具结束本轮；只有确实需要外部事实时才先 search_kb。',
        `工具：${JSON.stringify(request.tools)}`
      ].filter(Boolean).join('\n'),
      onMetrics: (value) => {
        metrics = value;
      }
    });

    const mounted = request.tools.some((tool) => tool.name === decision.toolName);
    if (!mounted) {
      throw new Error(`Agent 选择了未挂载工具：${decision.toolName}`);
    }
    return {
      toolName: decision.toolName as AgentToolName,
      input: decision.input,
      metrics
    };
  }
}
