import OpenAI from 'openai';
import type { z } from 'zod';

export interface AiJsonRequest<TSchema extends z.ZodTypeAny> {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: TSchema;
}

export class AiClient {
  async generateJson<TSchema extends z.ZodTypeAny>(request: AiJsonRequest<TSchema>): Promise<z.infer<TSchema>> {
    if (!request.apiKey) {
      throw new Error('缺少 DeepSeek API Key。请先在“设置”里填写密钥，再运行 AI 功能。');
    }

    const client = new OpenAI({
      apiKey: request.apiKey,
      baseURL: request.baseUrl
    });

    const response = await client.chat.completions.create({
      model: request.model,
      messages: [
        {
          role: 'system',
          content: `${request.system}\n只返回合法 JSON，不要包含 Markdown 代码块。`
        },
        {
          role: 'user',
          content: request.user
        }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: 0.2
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI 返回了空内容。');
    }

    const parsed = parseJsonObject(content);
    return request.schema.parse(parsed);
  }
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
