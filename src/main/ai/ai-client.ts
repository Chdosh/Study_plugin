import OpenAI from 'openai';
import { z } from 'zod';
import { CategorizedError } from './categorized-error';

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
    if (!request.apiKey) {
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
        '缺少 DeepSeek API Key。请先在“设置”里填写密钥，再运行 AI 功能。'
      );
    }

    const traceId = request.traceId ?? `ta_${crypto.randomUUID()}`;
    const client = new OpenAI({
      apiKey: request.apiKey,
      baseURL: request.baseUrl,
      timeout: request.timeoutMs ?? 60_000
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
    response_format: {
      type: 'json_object'
    },
    temperature: 0.2
  }, { timeout: request.timeoutMs ?? 60_000 });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI 返回了空内容。');
  }
  return content;
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
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('AI 返回内容不是合法 JSON。');
    }
    return JSON.parse(match[0]);
  }
}

function nowMs(): number {
  return Date.now();
}

function categorizeThrownError(error: unknown): CategorizedError {
  if (error instanceof CategorizedError) return error;
  if (error instanceof z.ZodError) {
    return new CategorizedError(
      'schema_violation',
      'AI 返回的内容结构不完整，已阻止写入正式计划。',
      error
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/JSON|parse|valid|schema|required|expected|type/i.test(message)) {
    return new CategorizedError('schema_violation', message, error instanceof Error ? error : undefined);
  }
  if (/timeout|ECONNRESET|ETIMEDOUT|network|fetch failed|timed out/i.test(message)) {
    return new CategorizedError('ai_failure', message, error instanceof Error ? error : undefined);
  }
  if (/missing|缺少|API [Kk]ey/i.test(message)) {
    return new CategorizedError('missing_config', message, error instanceof Error ? error : undefined);
  }
  return new CategorizedError('ai_failure', message, error instanceof Error ? error : undefined);
}
