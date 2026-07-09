import OpenAI from 'openai';
import { z } from 'zod';

export interface AiJsonRequest<TSchema extends z.ZodTypeAny> {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: TSchema;
  timeoutMs?: number;
}

export class AiClient {
  async generateJson<TSchema extends z.ZodTypeAny>(request: AiJsonRequest<TSchema>): Promise<z.infer<TSchema>> {
    if (!request.apiKey) {
      throw new Error('缺少 DeepSeek API Key。请先在“设置”里填写密钥，再运行 AI 功能。');
    }

    const client = new OpenAI({
      apiKey: request.apiKey,
      baseURL: request.baseUrl,
      timeout: request.timeoutMs ?? 60_000
    });

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
      return parseAndValidate(content, request.schema);
    } catch (error) {
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
            describeSchemaError(error),
            '',
            '请返回一个完整 JSON object。'
          ].join('\n')
        }
      ]);
      return parseAndValidate(repairedContent, request.schema);
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
