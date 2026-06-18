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
      throw new Error('DeepSeek API key is missing. Add it in Settings before running AI actions.');
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
          content: `${request.system}\nReturn only valid JSON. Do not include Markdown fences.`
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
      throw new Error('AI returned an empty response.');
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
      throw new Error('AI response was not valid JSON.');
    }
    return JSON.parse(match[0]);
  }
}
