import { describe, expect, it } from 'vitest';
import { submissionEvaluationAgentOutputSchema } from '../../shared/schemas';
import { AiClient } from './ai-client';

const runRealContract = process.env.RUN_DEEPSEEK_CONTRACT === '1';
const contractTimeoutMs = Number.parseInt(process.env.DEEPSEEK_CONTRACT_TIMEOUT_MS ?? '90000', 10);
const requestTimeoutMs = Number.parseInt(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS ?? '45000', 10);

const maybeDescribe = runRealContract ? describe : describe.skip;

maybeDescribe('DeepSeek real API contract', () => {
  it(
    'validates one evaluation response through JSON repair and schema parsing',
    async () => {
      const apiKey = process.env.STUDY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
      expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

      const started = Date.now();
      try {
        logContractStage('evaluation_request_start', started);
        const output = await withTotalTimeout(
          new AiClient().generateJson({
            apiKey: apiKey ?? null,
            baseUrl: process.env.STUDY_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
            model: process.env.STUDY_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            timeoutMs: requestTimeoutMs,
            schema: submissionEvaluationAgentOutputSchema,
            system: '你是渐进式 AI 学习导师的 evaluation-service。只返回合法 JSON。',
            user: [
              '评估用户对当前学习步骤的提交。',
              '必须返回 JSON object，字段为 result、mastery、evidence、correctParts、misconceptions、missingRequirements、feedback、recommendedAction。',
              'result 使用 passed、partial、failed、unclear。',
              'recommendedAction 使用 advance、explain_again、remediate、practice、simplify、complete_task、request_user_decision。',
              '数组字段必须返回字符串数组。',
              '当前步骤：解释 no-cache 的含义。',
              '完成标准：说明 no-cache 允许缓存存储，但每次使用前必须重新验证。',
              '用户提交：no-cache 不是禁止缓存，它可以保存副本，但每次使用前都要向服务器验证是否仍然有效。'
            ].join('\n')
          }),
          contractTimeoutMs
        );
        logContractStage('schema_validated', started);
        expect(output.result).toBeTruthy();
        expect(output.feedback.length).toBeGreaterThan(0);
      } catch (error) {
        logContractStage('failed', started, classifyError(error));
        throw error;
      }
    },
    contractTimeoutMs + 5000
  );
});

function withTotalTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DeepSeek contract timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function logContractStage(stage: string, started: number, errorType?: string): void {
  const elapsedMs = Date.now() - started;
  const suffix = errorType ? ` errorType=${errorType}` : '';
  console.log(`[deepseek-contract] stage=${stage} elapsedMs=${elapsedMs}${suffix}`);
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) return 'timeout';
  if (/ZodError|invalid_type|invalid_enum|validation/i.test(message)) return 'schema_validation';
  if (/JSON|Unexpected token/i.test(message)) return 'json_parse';
  if (/401|403|api key|unauthorized/i.test(message)) return 'auth';
  if (/429|rate/i.test(message)) return 'rate_limit';
  return 'unknown';
}
