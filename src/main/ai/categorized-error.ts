import { z } from 'zod';

export type AppErrorCategory =
  | 'user_input_error'
  | 'ai_failure'
  | 'schema_violation'
  | 'db_error'
  | 'validation_error'
  | 'missing_config';

export class CategorizedError extends Error {
  readonly category: AppErrorCategory;
  readonly cause?: Error;

  constructor(category: AppErrorCategory, message: string, cause?: Error) {
    super(message);
    this.name = 'CategorizedError';
    this.category = category;
    this.cause = cause;
  }
}

export function describeError(error: unknown): {
  category: AppErrorCategory;
  message: string;
} {
  if (error instanceof CategorizedError) {
    return { category: error.category, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/missing|缺少|API [Kk]ey/i.test(message)) {
    return { category: 'missing_config', message };
  }
  if (/JSON|parse|valid|schema|required|expected|type/i.test(message)) {
    return { category: 'schema_violation', message };
  }
  if (/timeout|ECONNRESET|ETIMEDOUT|network|fetch failed|timed out/i.test(message)) {
    return { category: 'ai_failure', message };
  }
  if (/cannot be empty|不能为空|必须填写/i.test(message)) {
    return { category: 'user_input_error', message };
  }
  return { category: 'ai_failure', message };
}

export function categorizeThrownError(error: unknown): CategorizedError {
  if (error instanceof CategorizedError) return error;
  if (error instanceof z.ZodError) {
    return new CategorizedError(
      'schema_violation',
      'AI 返回内容未通过业务格式校验；原始数据已保留，请在对应记录中重试。',
      error
    );
  }
  const described = describeError(error);
  return new CategorizedError(described.category, described.message, error instanceof Error ? error : undefined);
}
