import OpenAI from 'openai';
import { z } from 'zod';
import { CategorizedError, categorizeThrownError } from './categorized-error';

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 180_000;

export interface AiJsonRequest<TSchema extends z.ZodTypeAny> {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: TSchema;
  timeoutMs?: number;
  traceId?: string;
  onMetrics?: (metrics: AiCallMetrics) => void;
}

export interface AiCallMetrics {
  traceId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  errorCategory: import('./categorized-error').AppErrorCategory | null;
}

export class AiClient {
  async generateJson<TSchema extends z.ZodTypeAny>(request: AiJsonRequest<TSchema>): Promise<z.infer<TSchema>> {
    const missingConfiguration = [
      !request.apiKey ? 'API Key' : '',
      !request.baseUrl.trim() ? '服务地址' : '',
      !request.model.trim() ? '模型名称' : ''
    ].filter(Boolean);
    if (missingConfiguration.length > 0) {
      const metrics: AiCallMetrics = {
        traceId: request.traceId ?? `ta_${crypto.randomUUID()}`,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        errorCategory: 'missing_config'
      };
      request.onMetrics?.(metrics);
      throw new CategorizedError(
        'missing_config',
        `AI 配置不完整：缺少${missingConfiguration.join('、')}。请先在“设置”里填写当前 AI 服务配置。`
      );
    }

    const traceId = request.traceId ?? `ta_${crypto.randomUUID()}`;
    const client = new OpenAI({
      apiKey: request.apiKey!,
      baseURL: request.baseUrl,
      timeout: request.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS
    });

    const start = nowMs();
    try {
      const content = await createJsonCompletion(client, request, [
        {
          role: 'system',
          content: `${request.system}\n只返回合法 JSON，不要包含 Markdown 代码块。`
        },
        {
          role: 'user',
          content: request.user
        }
      ]);

      try {
        const result = parseAndValidate(content, request.schema);
        request.onMetrics?.({
          traceId,
          inputTokens: null,
          outputTokens: null,
          latencyMs: nowMs() - start,
          errorCategory: null
        });
        return result;
      } catch (schemaError) {
        const repairedContent = await createJsonCompletion(client, request, [
          {
            role: 'system',
            content: [
              request.system,
              '只返回合法 JSON，不要包含 Markdown 代码块。',
              '你正在修复上一次 JSON 输出，使其符合应用要求。',
              '不要新增事实；缺失字段只能根据原始用户请求和上一次输出提取，或使用安全的空字符串、空数组、null 和允许枚举值。'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              '原始用户请求：',
              request.user,
              '',
              '上一次 AI 输出：',
              content,
              '',
              '解析或校验问题：',
              describeSchemaError(schemaError),
              '',
              '请返回一个完整 JSON object。'
            ].join('\n')
          }
        ]);
        const repaired = parseAndValidate(repairedContent, request.schema);
        request.onMetrics?.({
          traceId,
          inputTokens: null,
          outputTokens: null,
          latencyMs: nowMs() - start,
          errorCategory: null
        });
        return repaired;
      }
    } catch (error) {
      const latencyMs = nowMs() - start;
      const categorized = categorizeThrownError(error);
      request.onMetrics?.({
        traceId,
        inputTokens: null,
        outputTokens: null,
        latencyMs,
        errorCategory: categorized.category
      });
      throw categorized;
    }
  }
}

async function createJsonCompletion<TSchema extends z.ZodTypeAny>(
  client: OpenAI,
  request: AiJsonRequest<TSchema>,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<string> {
  const response = await client.chat.completions.create({
    model: request.model,
    messages,
    temperature: 0.2
  }, { timeout: request.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS });

  const message = response.choices[0]?.message as
    | (OpenAI.Chat.Completions.ChatCompletionMessage & {
        reasoning_content?: unknown;
      })
    | undefined;
  const content = firstNonEmptyText(
    message?.content,
    message?.reasoning_content
  );
  if (!content) {
    throw new Error('AI 返回了空内容。');
  }
  return content;
}

function firstNonEmptyText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function parseAndValidate<TSchema extends z.ZodTypeAny>(content: string, schema: TSchema): z.infer<TSchema> {
  const parsed = parseJsonObject(content);
  return schema.parse(parsed);
}

function describeSchemaError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return JSON.stringify(error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    })));
  }
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const candidates = extractJsonObjectCandidates(trimmed);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(candidates[index]);
      } catch {
        // Continue backwards to the latest complete JSON object.
      }
    }
    throw new Error('AI 返回内容不是合法 JSON。');
  }
}

function extractJsonObjectCandidates(content: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function nowMs(): number {
  return Date.now();
}


