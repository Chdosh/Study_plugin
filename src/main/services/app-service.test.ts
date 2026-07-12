import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AiClient } from '../ai/ai-client';
import { aiReviews, dailyGuides, goals, learningEvaluations, learningSubmissions, shortPlanDays } from '../db/schema';
import { createDatabase, type DatabaseClient } from '../db/client';
import type { Database } from '../db/client';
import type { InferSelectModel } from 'drizzle-orm';
import { AppService } from './app-service';
import type { SettingsService } from './settings-service';
import { StudyStore } from './store';

function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

vi.mock('./windows-foreground', () => ({
  getForegroundWindowInfo: vi.fn(async () => ({
    appName: 'Vitest',
    windowTitle: 'AppService progressive flow'
  }))
}));

let tmpPath: string;
let client: DatabaseClient;
let db: Database;
let store: StudyStore;
let appService: AppService;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-supervisor-app-service-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  db = created.db;
  store = new StudyStore(created.db);
  await store.seedDefaults();
  appService = new AppService(
    store,
    createFakeSettingsService(),
    () => null
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  client.close();
  await removeTempDir(tmpPath);
});

describe('AppService progressive AI flow', () => {
  it('runs runtime consistency audit during initialization and exposes the cached result once', async () => {
    const audit = vi.spyOn(store, 'auditRuntimeConsistency');

    await appService.initialize();
    const startup = await appService.auditRuntimeConsistency();

    expect(audit).toHaveBeenCalledTimes(1);
    expect(startup.checkedAt).toBeTruthy();
    expect(startup.requiresUserAction).toBe(false);

    await appService.auditRuntimeConsistency();
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it('runs active goal intake and generates a layered first-day guide', async () => {
    const aiCalls = installDeterministicAi();

    const initial = await appService.getCurrentOnboarding();
    expect(initial.messages[0].content).toContain('目标');

    const ready = await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    expect(ready.intake.status).toBe('ready');
    expect(ready.intake.brief?.title).toBe('三个月达到初级前端工程师水平');

    const confirmed = await appService.confirmOnboardingGoal();
    expect(confirmed.goal.title).toBe('三个月达到初级前端工程师水平');

    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    expect(layered.roadmap[0].title).toBe('项目接管基础');
    expect(layered.shortPlan[0].title).toBe('跑通并梳理项目');
    expect(layered.shortPlan).toHaveLength(3);
    expect(layered.shortPlan.every((day) => day.roadmapStageId === layered.roadmap[0].id)).toBe(true);
    expect(layered.guide.weekFocus).toBe('把项目变成可讲、可演示的资产');
    expect(layered.guide.tasks[0].title).toBe('锁定今天边界');
    expect(layered.guide.tasks[0].actions).toHaveLength(3);
    expect(layered.guide.blocks[0].title).toBe('锁定今天边界');
    expect(layered.guide.blocks[0].planBlockId).toBeTruthy();

    const today = await appService.listTodayGuide();
    expect(today.goal?.id).toBe(confirmed.goal.id);
    expect(today.guide?.tasks).toHaveLength(2);
    expect(today.guide?.blocks).toHaveLength(2);

    const confirmedGuide = await appService.confirmDailyGuide(layered.guide.id);
    expect(confirmedGuide.status).toBe('confirmed');

    expect(aiCalls.map((call) => call.operation)).toEqual(['goal_intake', 'roadmap', 'short_plan', 'daily_guide']);
  });

  it('archives today guide and reopens active intake', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    expect((await appService.listTodayGuide()).guide?.id).toBe(layered.guide.id);

    const nextIntake = await appService.archiveTodayAndRestart();
    expect(nextIntake.intake.status).toBe('collecting');
    expect(nextIntake.messages[0].content).toContain('归档');
    const afterArchive = await appService.listTodayGuide();
    expect(afterArchive.goal).toBeNull();
    expect(afterArchive.guide).toBeNull();
    const goalRows = await db.select().from(goals).where(eq(goals.id, confirmed.goal.id));
    expect(goalRows[0].status).toBe('archived');

    await appService.sendOnboardingMessage('直接开始，先生成计划。');
    const afterRestartMessage = await appService.getCurrentOnboarding();
    expect(afterRestartMessage.intake.id).toBe(nextIntake.intake.id);
    expect(afterRestartMessage.messages.map((message) => message.content)).toContain('直接开始，先生成计划。');
  });

  it('archives every guide for the active goal before reopening intake', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await store.completeLearningDay(layered.guide.id);

    const nextDay = await appService.startNextSession();
    expect(nextDay.todayState).toBe('active');
    await store.completeLearningDay(nextDay.result!.guide.id);

    const intake = await appService.archiveTodayAndRestart();
    expect(intake.intake.status).toBe('collecting');

    const guideRows = await db.select().from(dailyGuides).where(eq(dailyGuides.goalId, confirmed.goal.id));
    expect(guideRows).toHaveLength(2);
    expect(guideRows.every((guide) => guide.status === 'archived')).toBe(true);
    const afterArchive = await appService.listTodayGuide();
    expect(afterArchive.goal).toBeNull();
    expect(afterArchive.guide).toBeNull();
  });

  it('keeps the confirmed Daily Guide as the execution spine through questions, actions, and submission', async () => {
    const aiCalls = installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    const firstTaskId = layered.guide.tasks[0].id;
    const secondTaskId = layered.guide.tasks[1].id;
    const session = await appService.startSession(firstTaskId);
    expect(session.taskId).toBe(firstTaskId);

    const started = await appService.getLearningState();
    expect(started.state.activeDailyTaskId).toBe(layered.guide.tasks[0].id);
    expect(started.dailyGuideAction?.title).toBe('打开项目');

    const taught = await appService.teachCurrentStep();
    expect(taught.action.id).toBe(started.dailyGuideAction?.id);
    expect(taught.action.title).toBe('打开项目');

    const answer = await appService.askStepQuestion('入口在哪？');
    expect(answer.thread.status).toBe('open');
    expect((await appService.getLearningState()).state.activeQuestionThreadId).toBe(answer.thread.id);

    const resolved = await appService.resolveQuestion(answer.thread.id, '已经知道入口文件。');
    expect(resolved.state.activeQuestionThreadId).toBeNull();
    expect(resolved.state.activeStepId).toBe(started.dailyGuideAction?.id);

    expect((await appService.completeCurrentAction()).dailyGuideAction?.title).toBe('跑主流程');
    const finalAction = await appService.completeCurrentAction();
    expect(finalAction.state.activeDailyTaskId).toBe(layered.guide.tasks[0].id);
    expect(finalAction.dailyGuideAction?.title).toBe('写边界');

    const submitted = await appService.submitLearningResult('已完成当前版本功能清单，并记录今天做和不做的边界。');
    expect(submitted.evaluation.result).toBe('passed');
    expect(submitted.nextAction?.title).toBe('找入口');
    expect(await appService.getActiveSession()).toBeNull();

    const afterSubmit = await appService.getLearningState();
    expect(afterSubmit.state.activeDailyTaskId).toBe(secondTaskId);
    expect(afterSubmit.dailyGuideAction?.title).toBe('找入口');

    expect(aiCalls.map((call) => call.operation)).toEqual([
      'goal_intake',
      'roadmap',
      'short_plan',
      'daily_guide',
      'teach_step',
      'question',
      'submission_evaluation'
    ]);
  });

  it('treats a paused Focus Session as the current recoverable session', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    const taskId = layered.guide.tasks[0].id;
    const started = await appService.startSession(taskId);
    const paused = await appService.pauseSession(started.id);
    const current = await appService.getActiveSession();

    expect(paused.status).toBe('paused');
    expect(current?.session.id).toBe(started.id);
    expect(current?.session.status).toBe('paused');
    expect(current?.session.status).toBe('paused');
  });

  it('handles need_more_info then ready in goal intake multi-round flow', async () => {
    installDeterministicAiWithNeedMoreInfo();

    const initial = await appService.getCurrentOnboarding();
    expect(initial.messages[0].content).toContain('目标');

    const firstMessage = await appService.sendOnboardingMessage('我想学前端，但不确定具体方向。');
    expect(firstMessage.intake.status).toBe('collecting');
    expect(firstMessage.intake.brief).toBeNull();

    const secondMessage = await appService.sendOnboardingMessage('每天晚上 2 小时，三个月内达到初级水平。');
    expect(secondMessage.intake.status).toBe('ready');
    expect(secondMessage.intake.brief?.title).toBe('三个月达到初级前端工程师水平');

    const confirmed = await appService.confirmOnboardingGoal();
    expect(confirmed.goal.title).toBe('三个月达到初级前端工程师水平');

    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    expect(layered.guide.tasks).toHaveLength(1);
  });

  it('generates a daily review via ReflectionAgent', async () => {
    const date = todayIso();
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    const review = await appService.generateReview(date);
    expect(review.completionScore).toBe(75);
    expect(review.focusScore).toBe(80);
    expect(review.summary).toBeTruthy();
    expect(review.reviewId).toBeTruthy();
    expect(review.date).toBe(date);
  });

  it('starts the next learning session from a closed guide and keeps the generated review readable', async () => {
    const aiCalls = installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await store.completeLearningDay(layered.guide.id);

    const result = await appService.startNextSession();

    expect(result.todayState).toBe('active');
    expect(result.review?.summary).toContain('今天完成了两个主任务');
    expect(result.result?.guide.id).not.toBe(layered.guide.id);
    expect(result.result?.guide.sessionStatus).toBe('active');

    const today = await appService.listTodayGuide();
    expect(today.todayState).toBe('active');
    expect(today.guide?.id).toBe(result.result?.guide.id);

    const latestReview = await appService.getLatestReview(result.review!.date);
    expect(latestReview?.reviewId).toBe(result.review?.reviewId);
    expect(aiCalls.map((call) => call.operation)).toEqual([
      'goal_intake',
      'roadmap',
      'short_plan',
      'daily_guide',
      'reflection',
      'daily_guide'
    ]);
  });

  it('rejects advancing an active guide before all tasks are done', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    await expect(appService.startNextSession()).rejects.toThrow('当前学习日还有未完成任务');

    const today = await appService.listTodayGuide();
    expect(today.guide?.id).toBe(layered.guide.id);
    expect(today.guide?.sessionStatus).toBe('active');
  });

  it('returns a clear exhausted result when every short plan day has already been used', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await store.completeLearningDay(layered.guide.id);

    const day2 = await appService.startNextSession();
    expect(day2.todayState).toBe('active');
    await store.completeLearningDay(day2.result!.guide.id);

    const day3 = await appService.startNextSession();
    expect(day3.todayState).toBe('active');
    await store.completeLearningDay(day3.result!.guide.id);

    const exhausted = await appService.startNextSession();
    expect(exhausted.todayState).toBe('plan_exhausted');
    expect(exhausted.errorMessage).toContain('复盘');
    expect(exhausted.result).toBeUndefined();
  });

  it('records daily_guide failure to ai_reviews when schema validation fails', async () => {
    const aiCalls = installDeterministicAiWithDailyGuideFailure();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();

    await expect(
      appService.generateLayeredPlan(confirmed.goal.id)
    ).rejects.toThrow('生成今日执行稿失败');

    expect(aiCalls.map((call) => call.operation)).toEqual(['goal_intake', 'roadmap', 'short_plan', 'daily_guide']);

    const reviews = await db.select().from(aiReviews);
    const failedReview = reviews.find((r: InferSelectModel<typeof aiReviews>) => r.kind === 'daily_guide' && r.status === 'failed');
    expect(failedReview).toBeTruthy();
    expect(failedReview!.errorMessage).toContain('schema');
  });

  it('records daily_guide timeout to ai_reviews', async () => {
    const aiCalls: Array<{ operation: string }> = [];

    vi.spyOn(AiClient.prototype, 'generateJson').mockImplementation(async (request) => {
      const operation = operationFromSystem(request.system);
      aiCalls.push({ operation });

      if (operation === 'goal_intake') {
        return request.schema.parse({
          status: 'ready',
          reply: '确认目标。',
          missingInfo: [],
          shouldForceStart: false,
          brief: {
            title: '测试目标',
            targetOutcome: '完成测试',
            currentLevel: '初级',
            availableTime: '每天 1 小时',
            deadline: '一个月',
            constraints: [],
            successCriteria: ['测试通过']
          }
        });
      }

      if (operation === 'roadmap') {
        return request.schema.parse({
          goalSummary: '测试。',
          stages: [{ title: '阶段1', objective: '测试', direction: '测试', successCriteria: '测试' }]
        });
      }

      if (operation === 'short_plan') {
        return request.schema.parse({
          weekFocus: '测试',
          days: [{
            dayIndex: 1, title: '测试', focus: '测试',
            tasks: ['测试'], expectedOutput: '测试', successCriteria: '测试'
          }]
        });
      }

      if (operation === 'daily_guide') {
        throw new Error('AI 请求超时');
      }

      throw new Error(`Unexpected operation: ${operation}`);
    });

    await appService.sendOnboardingMessage('测试目标。');
    const confirmed = await appService.confirmOnboardingGoal();

    await expect(
      appService.generateLayeredPlan(confirmed.goal.id)
    ).rejects.toThrow('生成今日执行稿失败');

    expect(aiCalls.map((c) => c.operation)).toEqual(['goal_intake', 'roadmap', 'short_plan', 'daily_guide']);

    const reviews = await db.select().from(aiReviews);
    const failedReview = reviews.find((r: InferSelectModel<typeof aiReviews>) => r.kind === 'daily_guide' && r.status === 'failed');
    expect(failedReview).toBeTruthy();
    expect(failedReview!.errorMessage).toContain('超时');
  });

  it('getTodayState returns needs_goal when no goal exists', async () => {
    const state = await appService.getTodayState();
    expect(state).toBe('needs_goal');
  });

  it('prepareCurrentLearningDay returns active when guide already exists', async () => {
    installDeterministicAi();
    await appService.sendOnboardingMessage('我想学 React。');
    const confirmed = await appService.confirmOnboardingGoal();
    await appService.generateLayeredPlan(confirmed.goal.id);

    const result = await appService.prepareCurrentLearningDay();
    expect(result.todayState).toBe('active');
    expect(result.result).toBeUndefined();
  });

  it('prepareCurrentLearningDay returns plan_exhausted when no shortPlanDays', async () => {
    installDeterministicAi();
    await appService.sendOnboardingMessage('我想学 React。');
    await appService.confirmOnboardingGoal();

    const result = await appService.prepareCurrentLearningDay();
    expect(result.todayState).toBe('plan_exhausted');
  });

  it('generateRollingPlan reuses the next pending stage day before asking AI for more items', async () => {
    const aiCalls = installDeterministicAi();
    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    for (const task of layered.guide.tasks) {
      await appService.startSession(task.id);
      await appService.completeCurrentAction();
      await appService.completeCurrentAction();
      await appService.submitLearningResult('已完成');
    }

    const shortPlanCallsBeforeRolling = aiCalls.filter((call) => call.operation === 'short_plan').length;
    const rolling = await appService.generateRollingPlan(confirmed.goal.id);
    expect(rolling.guide).toBeTruthy();
    expect(rolling.guide.shortPlanDayId).toBe(layered.shortPlan[1].id);
    expect(rolling.activatedStage).toBeTruthy();
    expect(rolling.shortPlan).toHaveLength(layered.shortPlan.length);
    expect(aiCalls.filter((call) => call.operation === 'short_plan')).toHaveLength(shortPlanCallsBeforeRolling);
    expect(aiCalls.at(-1)?.operation).toBe('daily_guide');

    const afterState = await appService.getTodayState();
    expect(afterState).toBe('active');
  });

  it('generateRollingPlan asks AI for more items only after current stage days are exhausted', async () => {
    const aiCalls = installDeterministicAi();
    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    for (const task of layered.guide.tasks) {
      await appService.startSession(task.id);
      await appService.completeCurrentAction();
      await appService.completeCurrentAction();
      await appService.submitLearningResult('已完成');
    }
    await db
      .update(shortPlanDays)
      .set({ sessionStatus: 'completed' })
      .where(eq(shortPlanDays.goalId, confirmed.goal.id));

    const shortPlanCallsBeforeRolling = aiCalls.filter((call) => call.operation === 'short_plan').length;
    const rolling = await appService.generateRollingPlan(confirmed.goal.id);

    expect(aiCalls.filter((call) => call.operation === 'short_plan')).toHaveLength(shortPlanCallsBeforeRolling + 1);
    expect(rolling.shortPlan.length).toBeGreaterThan(layered.shortPlan.length);
    expect(rolling.guide.shortPlanDayId).not.toBe(layered.shortPlan[1].id);
  });

  it('applies review adjustments only through an explicit plan proposal confirmation', async () => {
    installDeterministicAi();
    await appService.sendOnboardingMessage('我想学 React。');
    const confirmed = await appService.confirmOnboardingGoal();
    await appService.generateLayeredPlan(confirmed.goal.id);

    const proposal = await appService.createPlanProposal(confirmed.goal.id, {
      reason: '用户确认采纳复盘建议',
      adjustments: [
        {
          dayIndex: 2,
          title: '调整后的标题',
          focus: '调整后的重点',
          expectedOutput: '调整后的产出',
          successCriteria: '调整后的标准'
        }
      ]
    });
    expect(proposal.status).toBe('pending');
    const accepted = await appService.confirmPlanProposal(proposal.id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.appliedAt).not.toBeNull();
    const today = await appService.listTodayGuide();
    expect(today.shortPlan.find((day) => day.dayIndex === 2)?.title).toBe('调整后的标题');
  });

  it('completeLearningDay is triggered when all tasks are done', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    for (const task of layered.guide.tasks) {
      await appService.startSession(task.id);
      await appService.completeCurrentAction();
      await appService.completeCurrentAction();
      await appService.submitLearningResult('Done.');
    }

    const today = await appService.listTodayGuide();
    expect(today.guide).toBeTruthy();
    expect(today.guide!.status).toBe('completed');
    expect(today.guide!.tasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('deduplicates concurrent sendOnboardingMessage calls with the same content', async () => {
    const aiCalls = installDeterministicAi();

    const [first, second] = await Promise.all([
      appService.sendOnboardingMessage('我想学前端。'),
      appService.sendOnboardingMessage('我想学前端。')
    ]);

    expect(first).toBe(second);
    expect(aiCalls.filter((c) => c.operation === 'goal_intake')).toHaveLength(1);
  });

  it('deduplicates concurrent askStepQuestion calls with the same content', async () => {
    const aiCalls = installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);

    const [first, second] = await Promise.all([
      appService.askStepQuestion('入口在哪？'),
      appService.askStepQuestion('入口在哪？')
    ]);

    expect(first).toBe(second);
    expect(aiCalls.filter((c) => c.operation === 'question')).toHaveLength(1);
  });

  it('deduplicates concurrent submitLearningResult calls with the same content', async () => {
    const aiCalls = installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);
    await appService.completeCurrentAction();

    const [first, second] = await Promise.all([
      appService.submitLearningResult('已完成第一个任务的最终产出。'),
      appService.submitLearningResult('已完成第一个任务的最终产出。')
    ]);

    expect(first).toBe(second);
    expect(aiCalls.filter((c) => c.operation === 'submission_evaluation')).toHaveLength(1);
  });

  it('keeps a failed next-day guide recoverable across restart and orphaned lock', async () => {
    installDeterministicAi({ failDailyGuideAttempts: [2] });

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await store.completeLearningDay(layered.guide.id);

    const failed = await appService.startNextSession();
    expect(failed.todayState).toBe('generation_failed');
    expect(await appService.getTodayState()).toBe('generation_failed');

    const failedGuide = (await appService.listTodayGuide()).guide;
    expect(failedGuide?.sessionStatus).toBe('draft');
    expect(failedGuide?.tasks).toHaveLength(0);

    const failedDay = (await appService.listTodayGuide()).shortPlan.find((day) => day.sessionStatus === 'active');
    expect(failedDay).toBeTruthy();
    expect(await store.acquireGenerationLock(`daily_guide:${confirmed.goal.id}`)).toBe(true);

    appService = new AppService(store, createFakeSettingsService(), () => null);
    const retried = await appService.prepareCurrentLearningDay(true);
    expect(retried.todayState).toBe('active');
    expect(retried.result?.guide.shortPlanDayId).toBe(failedDay!.id);
    expect(retried.result?.guide.id).toBe(failedGuide!.id);
  });

  it('uses the local calendar date for generated guides near UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T16:30:00.000Z'));
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);

    expect(layered.guide.date).toBe('2026-07-11');
    expect(layered.shortPlan[0].date).toBe('2026-07-11');

    await store.completeLearningDay(layered.guide.id);
    const next = await appService.startNextSession();
    expect(next.result?.guide.date).toBe('2026-07-11');
  });

  it('recovers a failed evaluation by reusing the saved submission', async () => {
    const aiCalls = installDeterministicAi({ failEvaluationAttempts: 1 });

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);

    await expect(appService.submitLearningResult('这份提交必须先保存。')).rejects.toThrow('请重试评价');

    const failedState = await appService.getLearningState();
    expect(failedState.latestSubmission?.evaluationStatus).toBe('failed');
    const failedSubmissionId = failedState.latestSubmission!.id;

    // Simulate an application restart with an orphaned persistent evaluation lock.
    expect(await store.acquireGenerationLock(`evaluation:${failedSubmissionId}`)).toBe(true);
    appService = new AppService(store, createFakeSettingsService(), () => null);

    const retried = await appService.retrySubmissionEvaluation(failedSubmissionId);
    expect(retried.submission.id).toBe(failedSubmissionId);
    expect(retried.submission.evaluationStatus).toBe('completed');
    expect(aiCalls.filter((c) => c.operation === 'submission_evaluation')).toHaveLength(2);

    const submissionRows = await db.select().from(learningSubmissions);
    const evaluationRows = await db.select().from(learningEvaluations);
    expect(submissionRows).toHaveLength(1);
    expect(evaluationRows).toHaveLength(1);
  });

  it('deduplicates concurrent retries for the same failed submission', async () => {
    const aiCalls = installDeterministicAi({ failEvaluationAttempts: 1 });

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);

    await expect(appService.submitLearningResult('并发重试也只能复用这一条提交。')).rejects.toThrow('请重试评价');
    const failedSubmission = (await appService.getLearningState()).latestSubmission!;

    const [first, second] = await Promise.all([
      appService.retrySubmissionEvaluation(failedSubmission.id),
      appService.retrySubmissionEvaluation(failedSubmission.id)
    ]);

    expect(first).toBe(second);
    expect(first.submission.id).toBe(failedSubmission.id);
    expect(aiCalls.filter((c) => c.operation === 'submission_evaluation')).toHaveLength(2);
    expect(await db.select().from(learningSubmissions)).toHaveLength(1);
    expect(await db.select().from(learningEvaluations)).toHaveLength(1);
  });

  it('resolves knowledge against the evaluated task before advancing to the next task', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);
    await store.recordKnowledgeItems({
      goalId: confirmed.goal.id,
      items: [{ key: layered.guide.tasks[0].title, summary: '第一个任务仍需验证', sourceType: 'weakness' }]
    });

    await appService.completeCurrentAction();
    await appService.completeCurrentAction();
    await appService.submitLearningResult('第一个任务的最终产出。');

    const items = await store.getKnowledgeItemsForGoal({ goalId: confirmed.goal.id });
    expect(items[0].status).toBe('resolved');
  });

  it('allows the same onboarding content again after the dedup window expires', async () => {
    installDeterministicAi();

    await appService.sendOnboardingMessage('我想学前端。');
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await appService.sendOnboardingMessage('我想学前端。');

    const intake = await appService.getCurrentOnboarding();
    expect(intake.messages.filter((m) => m.role === 'user')).toHaveLength(2);
  }, 10_000);

  it('startSession rejects completed block after task done', async () => {
    installDeterministicAi();
    await appService.sendOnboardingMessage('我想学 React。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    const taskId = layered.guide.tasks[0].id;
    await appService.startSession(taskId);
    await appService.completeCurrentAction();
    await appService.completeCurrentAction();
    await appService.submitLearningResult('Done.');

    await expect(appService.startSession(taskId)).rejects.toThrow('已完成');
  });

  it('结束本次学习会暂停持久化 Session 并保留当前任务位置', async () => {
    installDeterministicAi();
    await appService.sendOnboardingMessage('我想学 React。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);
    await appService.startSession(layered.guide.tasks[0].id);

    const ended = await appService.terminateLearning();
    const recoverable = await appService.getActiveSession();

    expect(ended.state.sessionStatus).toBe('paused');
    expect(ended.state.activeDailyTaskId).toBe(layered.guide.tasks[0].id);
    expect(recoverable?.session.status).toBe('paused');
    expect(recoverable?.session.taskId).toBe(layered.guide.tasks[0].id);
  });

});


function installDeterministicAi(options: { failEvaluationAttempts?: number; failDailyGuideAttempts?: number[] } = {}): Array<{ operation: string; user: string }> {
  const calls: Array<{ operation: string; user: string }> = [];
  let evaluationAttempts = 0;
  let dailyGuideAttempts = 0;

  vi.spyOn(AiClient.prototype, 'generateJson').mockImplementation(async (request) => {
    const operation = operationFromSystem(request.system);
    calls.push({ operation, user: request.user });

    if (operation === 'goal_intake') {
      return request.schema.parse({
        status: 'ready',
        reply: '我理解你的目标是三个月内达到初级前端工程师水平。请确认后我会生成第一天执行稿。',
        missingInfo: [],
        shouldForceStart: false,
        brief: {
          title: '三个月达到初级前端工程师水平',
          targetOutcome: '能完成一个可展示项目并准备求职面试',
          currentLevel: '有基础网页经验，需要系统补齐工程能力',
          availableTime: '每天晚上 2 小时',
          deadline: '三个月',
          constraints: ['不能一次学太多方向', '先以可演示项目为核心'],
          successCriteria: ['能讲清项目主流程', '完成 README 初稿', '准备面试问答']
        }
      });
    }

    if (operation === 'roadmap') {
      return request.schema.parse({
        goalSummary: '围绕求职演示项目补齐工程能力。',
        stages: [
          {
            title: '项目接管基础',
            objective: '能跑通项目并讲清主流程',
            direction: '先理解已有项目，再补关键技术点',
            successCriteria: '能用 2 分钟讲清项目为什么做、怎么做'
          }
        ]
      });
    }

    if (operation === 'short_plan') {
      return request.schema.parse({
        weekFocus: '把项目变成可讲、可演示的资产',
        days: [
          {
            dayIndex: 1,
            title: '跑通并梳理项目',
            focus: '建立项目所有权',
            tasks: ['跑一遍主流程', '写代码地图'],
            expectedOutput: '项目接管文档初稿',
            successCriteria: '能说清入口、主流程和关键模块'
          },
          {
            dayIndex: 2,
            title: '修演示级问题',
            focus: '只修影响演示的 bug',
            tasks: ['整理 bug 清单', '修最高优先级问题'],
            expectedOutput: '演示稳定性清单',
            successCriteria: '能稳定展示 3 个场景'
          },
          {
            dayIndex: 3,
            title: '准备面试表达',
            focus: '把项目讲清楚',
            tasks: ['写 README', '写问答'],
            expectedOutput: 'README 和面试问答初稿',
            successCriteria: '能 2 分钟介绍项目'
          }
        ]
      });
    }

    if (operation === 'daily_guide') {
      dailyGuideAttempts += 1;
      if (options.failDailyGuideAttempts?.includes(dailyGuideAttempts)) {
        throw new Error('Daily Guide schema validation failed: ZodError');
      }
      return request.schema.parse({
        date: '2026-07-03',
        todayGoal: '今天把项目从“做过”推进到“能讲、能演示”。',
        deliverables: ['主流程说明', '代码目录地图'],
        boundaries: ['不做复杂知识图谱', '不大改 UI', '不换技术栈'],
        acceptanceCriteria: ['能讲清项目主流程', '有一份代码地图初稿'],
        tomorrowActions: ['修最高优先级 bug', '录制 60 秒演示'],
        tasks: [
          {
            title: '锁定今天边界',
            objective: '明确今天只做接管和文档',
            scope: '跑通主流程并记录今天不做的范围',
            estimatedMinutes: { min: 25, target: 35, max: 50 },
            actions: [
              { title: '打开项目', instruction: '启动应用并进入 Today', checkpoint: '看到主界面' },
              { title: '跑主流程', instruction: '按主动访谈到执行稿路径操作一次', checkpoint: '记录关键入口' },
              { title: '写边界', instruction: '列出今天做和不做的事', checkpoint: '边界清单可读' }
            ],
            deliverable: '当前版本功能清单',
            doneWhen: ['写出已完成能力和今天不做的事'],
            quickHint: '如果跑不通，只记录阻塞点和截图',
            evaluationMode: 'ai',
            submissionPolicy: 'once_after_task',
            carryoverAllowed: true
          },
          {
            title: '整理代码地图',
            objective: '知道核心文件分别负责什么',
            scope: '按入口、AI、数据、UI 四类梳理文件',
            estimatedMinutes: { min: 45, target: 60, max: 80 },
            actions: [
              { title: '找入口', instruction: '定位 Electron、preload 和 renderer 入口', checkpoint: '入口文件已列出' },
              { title: '找 AI 链路', instruction: '定位 prompt、agent 和 service 调用', checkpoint: 'AI 请求路径已列出' },
              { title: '写地图', instruction: '把模块职责写成短文档', checkpoint: '文档可讲清模块职责' }
            ],
            deliverable: '代码目录地图',
            doneWhen: ['能指出每个核心模块职责'],
            quickHint: '先只整理入口和 AI 请求链路',
            evaluationMode: 'ai',
            submissionPolicy: 'once_after_task',
            carryoverAllowed: true
          }
        ]
      });
    }

    if (operation === 'teach_step') {
      return request.schema.parse({
        title: '打开项目',
        objective: '确认应用入口和 Today 页面可进入',
        instruction: '启动应用，进入 Today，并记录当前主任务入口。',
        explanation: '先确认入口可以打开，再继续跑完整主流程。',
        userAction: '打开应用并记录入口文件。',
        expectedOutput: '入口文件和 Today 页面状态记录',
        successCriteria: '能说明从应用启动到 Today 的入口路径',
        requiresSubmission: false
      });
    }

    if (operation === 'question') {
      return request.schema.parse({
        answer: '入口从 Electron main 进入 renderer，Today 页面承接当前主任务。',
        relationToCurrentStep: '这个问题直接帮助你完成“打开项目”行动。',
        example: '先看 Electron 入口，再看 renderer 主页面。',
        resolved: false,
        returnToStepInstruction: '回到当前行动，继续记录入口路径。',
        resolutionSummary: ''
      });
    }

    if (operation === 'submission_evaluation') {
      evaluationAttempts += 1;
      if (evaluationAttempts <= (options.failEvaluationAttempts ?? 0)) {
        throw new Error('Submission evaluation timed out');
      }
      return request.schema.parse({
        result: 'passed',
        mastery: 92,
        evidence: ['提交包含功能清单和边界记录。'],
        correctParts: ['说明了当前版本能力。', '记录了今天不做的范围。'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '主任务提交达到验收标准，可以进入下一主任务。',
        recommendedAction: 'complete_task'
      });
    }

    if (operation === 'reflection') {
      return request.schema.parse({
        completionScore: 75,
        focusScore: 80,
        summary: '今天完成了两个主任务，专注度良好，明天继续推进代码地图整理。',
        nextActions: ['明天优先整理入口和 AI 链路', '补全代码地图并提交评估']
      });
    }

    throw new Error(`Unexpected AI operation: ${operation}`);
  });

  return calls;
}

function installDeterministicAiWithNeedMoreInfo(): Array<{ operation: string }> {
  const calls: Array<{ operation: string }> = [];
  let intakeCalls = 0;

  vi.spyOn(AiClient.prototype, 'generateJson').mockImplementation(async (request) => {
    const operation = operationFromSystem(request.system);
    calls.push({ operation });

    if (operation === 'goal_intake') {
      intakeCalls++;
      if (intakeCalls === 1) {
        return request.schema.parse({
          status: 'need_more_info',
          reply: '你提到想学前端，能否告诉我你的基础和时间安排？你希望达到什么具体水平？',
          missingInfo: ['当前基础', '可用时间', '具体目标水平'],
          shouldForceStart: false
        });
      }
      return request.schema.parse({
        status: 'ready',
        reply: '我理解了，你的目标是三个月内达到初级前端工程师水平，每天晚上 2 小时。请确认。',
        missingInfo: [],
        shouldForceStart: false,
        brief: {
          title: '三个月达到初级前端工程师水平',
          targetOutcome: '能完成一个可展示项目并准备求职面试',
          currentLevel: '有基础网页经验，需要系统补齐工程能力',
          availableTime: '每天晚上 2 小时',
          deadline: '三个月',
          constraints: ['不能一次学太多方向', '先以可演示项目为核心'],
          successCriteria: ['能讲清项目主流程', '完成 README 初稿', '准备面试问答']
        }
      });
    }

    if (operation === 'roadmap') {
      return request.schema.parse({
        goalSummary: '围绕求职演示项目补齐工程能力。',
        stages: [
          {
            title: '项目接管基础',
            objective: '能跑通项目并讲清主流程',
            direction: '先理解已有项目，再补关键技术点',
            successCriteria: '能用 2 分钟讲清项目为什么做、怎么做'
          }
        ]
      });
    }

    if (operation === 'short_plan') {
      return request.schema.parse({
        weekFocus: '把项目变成可讲、可演示的资产',
        days: [
          {
            dayIndex: 1, title: '跑通并梳理项目', focus: '建立项目所有权',
            tasks: ['跑一遍主流程', '写代码地图'],
            expectedOutput: '项目接管文档初稿',
            successCriteria: '能说清入口、主流程和关键模块'
          }
        ]
      });
    }

    if (operation === 'daily_guide') {
      return request.schema.parse({
        date: '2026-07-03',
        todayGoal: '今天把项目推进到可讲可演示。',
        deliverables: ['主流程说明'],
        boundaries: ['不做复杂知识图谱'],
        acceptanceCriteria: ['能讲清项目主流程'],
        tomorrowActions: ['修最高优先级 bug'],
        tasks: [
          {
            title: '锁定今天边界',
            objective: '明确今天只做接管和文档',
            scope: '跑通主流程并记录边界',
            estimatedMinutes: { min: 25, target: 35, max: 50 },
            actions: [
              { title: '打开项目', instruction: '启动应用', checkpoint: '看到主界面' },
              { title: '跑主流程', instruction: '按路径操作', checkpoint: '记录关键入口' }
            ],
            deliverable: '功能清单',
            doneWhen: ['写出已完成能力'],
            quickHint: '跑不通就记录阻塞点',
            evaluationMode: 'local' as const,
            submissionPolicy: 'once_after_task' as const,
            carryoverAllowed: true
          }
        ]
      });
    }

    throw new Error(`Unexpected AI operation: ${operation}`);
  });

  return calls;
}

function installDeterministicAiWithDailyGuideFailure(): Array<{ operation: string }> {
  const calls: Array<{ operation: string }> = [];

  vi.spyOn(AiClient.prototype, 'generateJson').mockImplementation(async (request) => {
    const operation = operationFromSystem(request.system);
    calls.push({ operation });

    if (operation === 'goal_intake') {
      return request.schema.parse({
        status: 'ready',
        reply: '确认目标。',
        missingInfo: [],
        shouldForceStart: false,
        brief: {
          title: '三个月达到初级前端工程师水平',
          targetOutcome: '完成可展示项目',
          currentLevel: '有基础经验',
          availableTime: '每天晚上 2 小时',
          deadline: '三个月',
          constraints: [],
          successCriteria: ['能讲清项目']
        }
      });
    }

    if (operation === 'roadmap') {
      return request.schema.parse({
        goalSummary: '测试。',
        stages: [{ title: '阶段1', objective: '测试', direction: '测试', successCriteria: '测试' }]
      });
    }

    if (operation === 'short_plan') {
      return request.schema.parse({
        weekFocus: '测试',
        days: [{
          dayIndex: 1, title: '测试', focus: '测试',
          tasks: ['测试'], expectedOutput: '测试', successCriteria: '测试'
        }]
      });
    }

    if (operation === 'daily_guide') {
      throw new Error('Daily Guide schema validation failed: ZodError');
    }

    throw new Error(`Unexpected AI operation: ${operation}`);
  });

  return calls;
}

function operationFromSystem(system: string): string {
  if (system.includes('goal-intake-agent')) return 'goal_intake';
  if (system.includes('generate-roadmap-agent')) return 'roadmap';
  if (system.includes('generate-short-plan-agent') || system.includes('rolling-plan-agent')) return 'short_plan';
  if (system.includes('generate-daily-guide-agent')) return 'daily_guide';
  if (system.includes('tutoring-service')) return 'teach_step';
  if (system.includes('question-branch')) return 'question';
  if (system.includes('evaluation-service')) return 'submission_evaluation';
  if (system.includes('reflection-agent')) return 'reflection';
  return 'unknown';
}


function createFakeSettingsService(): SettingsService {
  return {
    getRuntimeSettings: async () => ({
      deepseekBaseUrl: 'https://example.invalid',
      deepseekModel: 'fake-deepseek',
      deepseekApiKey: 'test-key',
      hasDeepseekApiKey: true,
      autoLaunch: false,
      defaultBlockMinutes: 10,
      dailyStudyWindows: [{ start: '20:00', end: '22:00' }]
    })
  } as unknown as SettingsService;
}

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
