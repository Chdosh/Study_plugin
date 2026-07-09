import { describe, expect, it } from 'vitest';
import {
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  reviewAgentOutputSchema,
  roadmapAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema
} from '../../shared/schemas';
import { AiClient } from './ai-client';

const runRealContract = process.env.RUN_DEEPSEEK_CONTRACT === '1';
const contractTimeoutMs = Number.parseInt(process.env.DEEPSEEK_CONTRACT_TIMEOUT_MS ?? '90000', 10);
const requestTimeoutMs = Number.parseInt(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS ?? '45000', 10);

const maybeDescribe = runRealContract ? describe : describe.skip;

function apiConfig() {
  const apiKey = process.env.STUDY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.STUDY_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.STUDY_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  return { apiKey, baseUrl, model };
}

function withTotalTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DeepSeek contract timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
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

maybeDescribe('DeepSeek real API contract', () => {
  const { apiKey, baseUrl, model } = apiConfig();

  it('validates goal intake: returns ready with complete brief', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('goal_intake_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
          timeoutMs: requestTimeoutMs,
          schema: goalIntakeAgentOutputSchema,
          system: '你是本地优先 AI 学习管家的 goal-intake-agent。只返回合法 JSON。',
          user: [
            '你正在为一个本地优先 AI 学习系统进行首次主动访谈。',
            '用户想学 React 前端开发，目标是三个月内能独立完成一个小型项目。',
            '用户每天晚上有 2 小时学习时间，有一定 JavaScript 基础但没接触过框架。',
            '请输出 JSON：status、reply、brief、missingInfo、shouldForceStart。',
            'status 使用 need_more_info 或 ready。',
            'brief 包含 title、targetOutcome、currentLevel、availableTime、deadline、constraints、successCriteria。',
            '历史访谈：[{"role":"user","content":"我想三个月内学会 React，能自己做一个项目。每天晚上有 2 小时学习，JS 会但不熟。"}]'
          ].join('\n')
        }),
        contractTimeoutMs
      );
      logContractStage('goal_intake_schema_validated', started);
      expect(output.status).toBeTruthy();
      if (output.status === 'ready') {
        expect(output.brief).toBeTruthy();
        expect(output.brief!.title.length).toBeGreaterThan(0);
      }
    } catch (error) {
      logContractStage('goal_intake_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);

  it('validates roadmap: returns stages with proper structure', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('roadmap_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
          timeoutMs: requestTimeoutMs,
          schema: roadmapAgentOutputSchema,
          system: '你是本地优先 AI 学习管家的 generate-roadmap-agent。只返回合法 JSON。',
          user: [
            '根据已确认目标生成长期大纲。只展示阶段和方向。',
            '输出 JSON 字段：goalSummary、stages。每个 stage 包含 title、objective、direction、successCriteria。',
            '阶段数量 3-5 个。',
            '目标：{"title":"三个月学会 React 前端开发","description":"每天晚上 2 小时，有 JS 基础"}',
            '目标理解：{"title":"三个月学会 React 前端开发","targetOutcome":"能独立完成一个 React 小型项目并部署上线","currentLevel":"有 JS 基础，未接触框架","availableTime":"每天晚上 2 小时","deadline":"三个月","constraints":["不能一次学太多方向"],"successCriteria":["完成可运行的项目","能讲清楚组件化思想"]}'
          ].join('\n')
        }),
        contractTimeoutMs
      );
      logContractStage('roadmap_schema_validated', started);
      expect(output.stages.length).toBeGreaterThanOrEqual(1);
      expect(output.stages.length).toBeLessThanOrEqual(5);
      expect(output.stages[0].title.length).toBeGreaterThan(0);
      expect(output.stages[0].objective.length).toBeGreaterThan(0);
    } catch (error) {
      logContractStage('roadmap_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);

  it('validates short plan: returns rolling plan items with dayIndex 1+', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('short_plan_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
          timeoutMs: requestTimeoutMs,
          schema: shortPlanAgentOutputSchema,
          system: '你是本地优先 AI 学习管家的 generate-short-plan-agent。只返回合法 JSON。',
          user: [
            '根据目标和长期大纲生成下一批近期学习任务。默认 3-5 个学习单元。',
            '输出 JSON 字段：weekFocus、days。每个单元包含 dayIndex、title、focus、tasks、expectedOutput、successCriteria。',
            '目标：{"title":"三个月学会 React 前端开发"}',
            '目标理解：{"title":"三个月学会 React 前端开发","targetOutcome":"能独立完成一个 React 小型项目","currentLevel":"有 JS 基础","availableTime":"每天晚上 2 小时","deadline":"三个月","constraints":[],"successCriteria":["完成可运行的项目"]}',
            '长期大纲：[{"title":"React 基础与环境搭建","objective":"掌握 JSX、组件和状态","direction":"从 create-react-app 开始","successCriteria":"能写出带状态管理的组件"}]'
          ].join('\n')
        }),
        contractTimeoutMs
      );
      logContractStage('short_plan_schema_validated', started);
      expect(output.days.length).toBeGreaterThanOrEqual(1);
      expect(output.days.length).toBeLessThanOrEqual(10);
      expect(output.days[0].title.length).toBeGreaterThan(0);
      expect(output.days[0].tasks.length).toBeGreaterThan(0);
    } catch (error) {
      logContractStage('short_plan_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);

  it('validates daily guide: returns tasks with valid estimatedMinutes', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('daily_guide_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
          timeoutMs: Math.max(requestTimeoutMs, 120_000),
          schema: dailyGuideAgentOutputSchema,
          system: '你是本地优先 AI 学习管家的 generate-daily-guide-agent。只返回合法 JSON。',
          user: [
            '为 2026-07-05 生成第一天执行稿。核心原则：任务决定时长，不要先生成固定时间块。',
            '今日可用学习时间约 120 分钟。',
            '输出 JSON 字段：date、todayGoal、deliverables、boundaries、acceptanceCriteria、tomorrowActions、tasks。',
            '每日计划预留约 10%-15% 缓冲时间。',
            '每个 task 包含 title、objective、scope、estimatedMinutes、actions、deliverable、doneWhen、quickHint、evaluationMode、submissionPolicy、carryoverAllowed。',
            'estimatedMinutes 包含 min、target、max，满足 min <= target <= max。每个 action 必须是一个对象，包含 title、instruction、checkpoint 三个字段。actions 建议 3-6 个，最少 1 个。',
            'submissionPolicy 只能是 once_after_task。evaluationMode 可为 local 或 ai。',
            '可用时间段：[{"start":"20:00","end":"22:00"}]',
            '目标：{"title":"三个月学会 React 前端开发","description":"每天晚上 2 小时"}',
            '目标理解：{"title":"三个月学会 React 前端开发","currentLevel":"有 JS 基础","availableTime":"每天晚上 2 小时"}',
            '相关长期大纲：[{"title":"React 基础","objective":"掌握 JSX 和组件","direction":"从 create-react-app 开始","successCriteria":"能写组件"}]',
            '第一天计划：{"dayIndex":1,"title":"搭建环境与第一个组件","focus":"建立开发环境和组件概念","tasks":["搭建 React 项目","写第一个组件","理解 JSX 语法"],"expectedOutput":"可运行的 React 项目","successCriteria":"项目能启动并显示组件"}'
          ].join('\n')
        }),
        contractTimeoutMs
      );
      logContractStage('daily_guide_schema_validated', started);
      expect(output.tasks.length).toBeGreaterThanOrEqual(1);
      expect(output.tasks.length).toBeLessThanOrEqual(4);
      const firstTask = output.tasks[0];
      expect(firstTask.title.length).toBeGreaterThan(0);
      expect(firstTask.estimatedMinutes.min).toBeLessThanOrEqual(firstTask.estimatedMinutes.target);
      expect(firstTask.estimatedMinutes.target).toBeLessThanOrEqual(firstTask.estimatedMinutes.max);
      expect(firstTask.actions.length).toBeGreaterThanOrEqual(1);
      expect(['local', 'ai']).toContain(firstTask.evaluationMode);
      expect(firstTask.submissionPolicy).toBe('once_after_task');
    } catch (error) {
      logContractStage('daily_guide_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);

  it('validates review: returns completion/focus scores 0-100', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('review_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
          timeoutMs: requestTimeoutMs,
          schema: reviewAgentOutputSchema,
          system: '你是本地优先 AI 学习管家的 reflection-agent。只返回合法 JSON。',
          user: [
            '复盘 2026-07-05 的学习执行情况。',
            '完成度和专注度按 0-100 打分。',
            '输出 JSON 字段：completionScore、focusScore、summary、nextActions。',
            'Snapshot: {"sessions":[],"todayGuide":{"tasks":[{"title":"搭建环境与第一个组件","status":"completed"}]}}'
          ].join('\n')
        }),
        contractTimeoutMs
      );
      logContractStage('review_schema_validated', started);
      expect(output.completionScore).toBeGreaterThanOrEqual(0);
      expect(output.completionScore).toBeLessThanOrEqual(100);
      expect(output.focusScore).toBeGreaterThanOrEqual(0);
      expect(output.focusScore).toBeLessThanOrEqual(100);
      expect(output.summary.length).toBeGreaterThan(0);
    } catch (error) {
      logContractStage('review_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);

  it('validates submission evaluation: returns valid result and recommendedAction', async () => {
    expect(apiKey, 'missing STUDY_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY').toBeTruthy();

    const started = Date.now();
    try {
      logContractStage('evaluation_request_start', started);
      const output = await withTotalTimeout(
        new AiClient().generateJson({
          apiKey: apiKey ?? null,
          baseUrl,
          model,
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
      logContractStage('evaluation_schema_validated', started);
      expect(output.result).toBeTruthy();
      expect(output.feedback.length).toBeGreaterThan(0);
    } catch (error) {
      logContractStage('evaluation_failed', started, classifyError(error));
      throw error;
    }
  }, contractTimeoutMs + 5000);
});
