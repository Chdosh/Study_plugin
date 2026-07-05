import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClient } from '../ai/ai-client';
import { createDatabase, type DatabaseClient } from '../db/client';
import { AppService } from './app-service';
import type { SettingsService } from './settings-service';
import { StudyStore } from './store';

vi.mock('./windows-foreground', () => ({
  getForegroundWindowInfo: vi.fn(async () => ({
    appName: 'Vitest',
    windowTitle: 'AppService progressive flow'
  }))
}));

let tmpPath: string;
let client: DatabaseClient;
let store: StudyStore;
let appService: AppService;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-supervisor-app-service-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  store = new StudyStore(created.db);
  await store.seedDefaults();
  appService = new AppService(
    store,
    createFakeSettingsService(),
    () => null,
    () => null
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  client.close();
  await removeTempDir(tmpPath);
});

describe('AppService progressive AI flow', () => {
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
    expect((await appService.listTodayGuide()).guide).toBeNull();

    await appService.sendOnboardingMessage('直接开始，先生成计划。');
    const afterRestartMessage = await appService.getCurrentOnboarding();
    expect(afterRestartMessage.intake.id).toBe(nextIntake.intake.id);
    expect(afterRestartMessage.messages.map((message) => message.content)).toContain('直接开始，先生成计划。');
  });

  it('keeps the confirmed Daily Guide as the execution spine through questions, actions, and submission', async () => {
    const aiCalls = installDeterministicAi();

    await appService.sendOnboardingMessage('我想三个月内达到初级前端工程师水平，每天晚上有 2 小时。');
    const confirmed = await appService.confirmOnboardingGoal();
    const layered = await appService.generateLayeredPlan(confirmed.goal.id);
    await appService.confirmDailyGuide(layered.guide.id);

    const firstBlockId = layered.guide.blocks[0].planBlockId;
    const secondBlockId = layered.guide.blocks[1].planBlockId;
    const session = await appService.startSession(firstBlockId);
    expect(session.blockId).toBe(firstBlockId);

    const started = await appService.getLearningState();
    expect(started.state.activeDailyTaskId).toBe(firstBlockId);
    expect(started.step?.title).toBe('打开项目');

    const taught = await appService.teachCurrentStep();
    expect(taught.step.id).toBe(started.step?.id);
    expect(taught.step.title).toBe('打开项目');

    const answer = await appService.askStepQuestion('入口在哪？');
    expect(answer.thread.status).toBe('open');
    expect((await appService.getLearningState()).state.activeQuestionThreadId).toBe(answer.thread.id);

    const resolved = await appService.resolveQuestion(answer.thread.id, '已经知道入口文件。');
    expect(resolved.state.activeQuestionThreadId).toBeNull();
    expect(resolved.state.activeStepId).toBe(started.step?.id);

    expect((await appService.completeCurrentAction()).step?.title).toBe('跑主流程');
    const finalAction = await appService.completeCurrentAction();
    expect(finalAction.state.activeDailyTaskId).toBe(firstBlockId);
    expect(finalAction.step?.title).toBe('写边界');

    const submitted = await appService.submitLearningResult('已完成当前版本功能清单，并记录今天做和不做的边界。');
    expect(submitted.evaluation.result).toBe('passed');
    expect(submitted.nextStep?.title).toBe('找入口');

    const afterSubmit = await appService.getLearningState();
    expect(afterSubmit.state.activeDailyTaskId).toBe(secondBlockId);
    expect(afterSubmit.step?.title).toBe('找入口');

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

});


function installDeterministicAi(): Array<{ operation: string; user: string }> {
  const calls: Array<{ operation: string; user: string }> = [];

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

    throw new Error(`Unexpected AI operation: ${operation}`);
  });

  return calls;
}

function operationFromSystem(system: string): string {
  if (system.includes('goal-intake-agent')) return 'goal_intake';
  if (system.includes('generate-roadmap-agent')) return 'roadmap';
  if (system.includes('generate-short-plan-agent')) return 'short_plan';
  if (system.includes('generate-daily-guide-agent')) return 'daily_guide';
  if (system.includes('tutoring-service')) return 'teach_step';
  if (system.includes('question-branch')) return 'question';
  if (system.includes('evaluation-service')) return 'submission_evaluation';
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
