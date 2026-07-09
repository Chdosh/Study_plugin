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
  if (/DeepSeek API Key|API [Kk]ey|api.key|missing.*key/i.test(message)) {
    return { category: 'missing_config', message };
  }
  if (/JSON|schema|valid|parse|required|expected|ZodError/i.test(message)) {
    return { category: 'schema_violation', message };
  }
  if (/timeout|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(message)) {
    return { category: 'ai_failure', message };
  }
  if (/cannot be empty|不能为空|必须填写/i.test(message)) {
    return { category: 'user_input_error', message };
  }
  return { category: 'ai_failure', message };
}
