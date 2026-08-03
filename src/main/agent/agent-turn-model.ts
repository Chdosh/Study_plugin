import { z } from 'zod';
import { AiClient, type AiCallMetrics } from '../ai/ai-client';
import type {
  AgentTurnDecision,
  AgentTurnModel,
  AgentTurnModelRequest,
  AgentToolName,
  MountedAgentTool
} from './agent-types';

export class AiAgentTurnModel implements AgentTurnModel {
  constructor(private readonly ai: AiClient) {}

  async selectNext(request: AgentTurnModelRequest): Promise<AgentTurnDecision> {
    if (request.tools.length === 0) {
      throw new Error('当前上下文没有可用的 Agent 工具。');
    }

    if (request.tools.length === 1) {
      return this.generateForSingleTool(request, request.tools[0]);
    }

    const publicTools = request.tools.map(({ inputSchema: _inputSchema, ...tool }) => tool);
    const decisionSchema = createDecisionSchema(request.tools);
    let metrics: AiCallMetrics | undefined;
    const decision = await this.ai.generateJson({
      apiKey: request.modelConfig.apiKey,
      baseUrl: request.modelConfig.baseUrl,
      model: request.modelConfig.model,
      system: request.modelConfig.system,
      timeoutMs: request.modelConfig.timeoutMs,
      traceId: request.modelConfig.traceId,
      temperature: request.modelConfig.temperature,
      schema: decisionSchema,
      fallbackSchema: decisionFallbackSchema,
      user: [
        `本轮学习意图：${request.intent}`,
        request.userInput ? `用户输入：${request.userInput}` : '',
        `可信学习上下文：${JSON.stringify(request.boundedContext)}`,
        `已经完成的工具调用：${JSON.stringify(request.previousToolResults)}`,
        '你是导师在输出内容：讲解要具体、配例子、像真人说话，不要输出模板化套话。',
        '结构要求：唯一允许的顶层结构是 {"toolName":"已挂载工具名","input":{}}；业务内容必须放在 input 中，字段名与工具说明一致。',
        '从下面已挂载工具中选择且只选择一个工具。input 必须符合该工具的输入说明。',
        '如果已有信息足以直接教学，选择内容类工具结束本轮；只有确实需要外部事实时才先 search_kb。',
        `工具：${JSON.stringify(publicTools)}`
      ].filter(Boolean).join('\n'),
      onMetrics: (value) => {
        metrics = value;
      }
    });

    const mounted = request.tools.find((tool) => tool.name === decision.toolName);
    if (!mounted) {
      throw new Error(`Agent 选择了未挂载工具：${decision.toolName}`);
    }
    return {
      toolName: decision.toolName as AgentToolName,
      input: validateDecisionInput(decision.input, mounted),
      metrics
    };
  }

  private async generateForSingleTool(
    request: AgentTurnModelRequest,
    mounted: MountedAgentTool
  ): Promise<AgentTurnDecision> {
    const directSchema = mounted.inputSchema ?? z.record(z.unknown());
    const envelopeSchema = z.object({
      toolName: z.literal(mounted.name),
      input: directSchema
    });
    const wrappedSchema = z.record(directSchema).refine(
      (value) => Object.keys(value).length === 1,
      '业务包装层必须且只能包含一个字段。'
    );
    const responseSchema = z.union([
      directSchema,
      envelopeSchema,
      wrappedSchema
    ]);
    let metrics: AiCallMetrics | undefined;
    const response = await this.ai.generateJson({
      apiKey: request.modelConfig.apiKey,
      baseUrl: request.modelConfig.baseUrl,
      model: request.modelConfig.model,
      system: request.modelConfig.system,
      timeoutMs: request.modelConfig.timeoutMs,
      traceId: request.modelConfig.traceId,
      temperature: request.modelConfig.temperature,
      // Keep business validation at the Agent boundary while accepting the
      // three provider-neutral shapes seen across OpenAI-compatible services:
      // direct object, legacy Agent envelope, or one named business wrapper.
      schema: responseSchema,
      fallbackSchema: mounted.fallbackSchema,
      user: [
        `本轮学习意图：${request.intent}`,
        request.userInput ? `用户输入：${request.userInput}` : '',
        `可信学习上下文：${JSON.stringify(request.boundedContext)}`,
        `已经完成的工具调用：${JSON.stringify(request.previousToolResults)}`,
        `当前只挂载了工具 ${mounted.name}，不要再次选择工具。`,
        `直接返回符合以下说明的业务 JSON 对象：${mounted.inputDescription}`,
        `兼容格式 {"toolName":"${mounted.name}","input":{}} 也可接受，但优先直接返回业务对象。`
      ].filter(Boolean).join('\n'),
      onMetrics: (value) => {
        metrics = value;
      }
    });
    return {
      toolName: mounted.name,
      input: parseSingleToolInput(response, mounted, directSchema),
      metrics
    };
  }
}

function parseSingleToolInput(
  response: Record<string, unknown>,
  mounted: MountedAgentTool,
  directSchema: z.ZodTypeAny
): unknown {
  const direct = directSchema.safeParse(response);
  if (direct.success) return direct.data;

  const candidates = new Set<unknown>();
  if (response.toolName === mounted.name && 'input' in response) {
    candidates.add(response.input);
  }
  if ('input' in response) candidates.add(response.input);
  for (const value of Object.values(response)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      candidates.add(value);
    }
  }

  const valid = [...candidates]
    .map((candidate) => directSchema.safeParse(candidate))
    .filter((result): result is z.SafeParseSuccess<unknown> => result.success);
  if (valid.length === 1) return valid[0].data;

  return directSchema.parse(response);
}

function validateDecisionInput(
  input: unknown,
  mounted: MountedAgentTool
): unknown {
  if (mounted.inputSchema) {
    const main = mounted.inputSchema.safeParse(input);
    if (main.success) return main.data;
    const fallback = mounted.fallbackSchema?.safeParse(input);
    if (fallback?.success) return fallback.data;
    throw main.error;
  }
  return input;
}

const decisionFallbackSchema = z.preprocess(
  () => ({
    toolName: 'ask_user',
    input: {
      question: '我生成内容时遇到了困难，请稍后重试；也可以先告诉我你当前的想法或进度。',
      reason: '生成失败，需要你确认后继续。',
      answerMode: 'free_text',
      canSkip: true,
      intent: 'recover_from_failure'
    }
  }),
  z.object({
    toolName: z.literal('ask_user'),
    input: z.object({
      question: z.string().min(1),
      reason: z.string().min(1),
      answerMode: z.literal('free_text'),
      canSkip: z.boolean(),
      intent: z.string().min(1)
    })
  })
);

function createDecisionSchema(tools: MountedAgentTool[]) {
  return z.object({
    toolName: z.string().min(1),
    input: z.record(z.unknown())
  }).superRefine((decision, context) => {
    const selected = tools.find((tool) => tool.name === decision.toolName);
    if (!selected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toolName'],
        message: `必须选择已挂载工具：${tools.map((tool) => tool.name).join('、')}`
      });
      return;
    }
    if (!selected.inputSchema) return;
    const validated = selected.inputSchema.safeParse(decision.input);
    if (validated.success) return;
    if (selected.fallbackSchema?.safeParse(decision.input).success) return;
    for (const issue of validated.error.issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['input', ...issue.path],
        message: issue.message
      });
    }
  });
}
