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
  });

  it('generates a daily plan from a manual goal after stage confirmation', async () => {
    const aiCalls = installDeterministicAi();
    const goal = await appService.createGoal('掌握 HTTP 缓存', '能解释并选择基础缓存策略');

    expect(await appService.listTasks()).toHaveLength(0);

    const outline = await appService.generateStageOutline(goal.id);
    await appService.confirmStages(goal.id);
    const plan = await appService.generatePlan('2026-07-02', [{ start: '20:00', end: '20:30' }]);
    const tasks = await appService.listTasks();

    expect(outline.stages[0].status).toBe('proposed');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('阶段起步：缓存语义基础');
    expect(plan.blocks[0].taskId).toBe(tasks[0].id);
    expect(plan.blocks[0].objective).toBe('区分 Cache-Control 指令');
    expect(aiCalls.map((call) => call.operation)).toEqual(['stage_outline', 'plan']);
  });

  it('runs a structured AI learning flow without turning Study into a long chat', async () => {
    const aiCalls = installDeterministicAi();
    const rawImport = await appService.createImport('我要学习 HTTP 缓存。', 'manual');
    const imported = await appService.parseImport(rawImport.id);
    const goal = (await appService.listGoals())[0];

    expect(imported.tasksCreated).toBe(1);
    expect(goal.title).toBe('掌握 HTTP 缓存');

    const outline = await appService.generateStageOutline(goal.id);
    expect(outline.stages[0].status).toBe('proposed');

    await appService.confirmStages(goal.id);
    const plan = await appService.generatePlan('2026-07-02', [{ start: '20:00', end: '20:30' }]);
    await appService.confirmPlan(plan.id);
    const session = await appService.startSession(plan.blocks[0].id);
    const firstTeaching = await appService.teachCurrentStep();

    expect(firstTeaching.step.status).toBe('waiting_for_submission');
    expect(firstTeaching.contextSourceIds).toContain(goal.id);

    const firstQuestion = await appService.askStepQuestion('no-cache 是不缓存吗？');
    const openQuestionState = await appService.getLearningState();

    expect(firstQuestion.resolved).toBe(false);
    expect(openQuestionState.state.activeStepId).toBe(firstTeaching.step.id);
    expect(openQuestionState.state.activeQuestionThreadId).toBe(firstQuestion.thread.id);

    const secondQuestion = await appService.askStepQuestion('must-revalidate 呢？');
    const resolvedQuestionState = await appService.getLearningState();

    expect(secondQuestion.resolved).toBe(true);
    expect(resolvedQuestionState.state.activeStepId).toBe(firstTeaching.step.id);
    expect(resolvedQuestionState.state.activeQuestionThreadId).toBeNull();

    const firstResult = await appService.submitLearningResult('我能解释 max-age 和 no-cache，但还没覆盖 must-revalidate。');

    expect(firstResult.evaluation.result).toBe('partial');
    expect(firstResult.decision.decision).toBe('remediate');
    expect(firstResult.nextStep).toBeNull();

    const remediationState = await appService.getLearningState();
    expect(remediationState.step?.status).toBe('needs_revision');
    expect(remediationState.state.activeStepId).toBe(firstTeaching.step.id);

    await appService.teachCurrentStep();
    const completedResult = await appService.submitLearningResult('no-cache 可存但使用前验证；must-revalidate 强制过期后验证。');

    expect(completedResult.evaluation.result).toBe('passed');
    expect(completedResult.decision.decision).toBe('complete_task');

    await appService.completeSession(session.id, '完成 Cache-Control 基础学习。');
    const completedState = await appService.getLearningState();

    expect(completedState.state.sessionStatus).toBe('completed');
    expect(completedState.step?.status).toBe('completed');
    expect(completedState.pendingAdjustment?.status).toBe('pending');

    const accepted = await appService.decidePlanAdjustment(completedState.pendingAdjustment!.id, 'accepted');
    expect(accepted.status).toBe('accepted');
    expect(accepted.appliedTaskId).toBeTruthy();

    const followUpPlan = await appService.generatePlan('2026-07-03', [{ start: '20:00', end: '20:30' }]);

    expect(followUpPlan.blocks[0].taskId).toBe(accepted.appliedTaskId);
    await appService.confirmPlan(followUpPlan.id);

    const secondSession = await appService.startSession(followUpPlan.blocks[0].id);
    const secondTeaching = await appService.teachCurrentStep();

    expect(secondTeaching.step.status).toBe('waiting_for_submission');
    expect(secondTeaching.step.id).not.toBe(firstTeaching.step.id);

    const followUpQuestion = await appService.askStepQuestion('hash 文件名为什么适合长缓存？');
    const followUpQuestionState = await appService.getLearningState();

    expect(followUpQuestion.resolved).toBe(true);
    expect(followUpQuestionState.state.activeStepId).toBe(secondTeaching.step.id);
    expect(followUpQuestionState.state.activeQuestionThreadId).toBeNull();

    const secondResult = await appService.submitLearningResult('静态资源可用 max-age=31536000, immutable；HTML 使用 no-cache。');

    expect(secondResult.evaluation.result).toBe('passed');
    expect(secondResult.decision.decision).toBe('complete_task');

    await appService.completeSession(secondSession.id, '完成静态资源缓存头练习。');
    const secondCompletedState = await appService.getLearningState();

    expect(secondCompletedState.state.sessionStatus).toBe('completed');
    expect(secondCompletedState.state.activeDailyTaskId).toBe(followUpPlan.blocks[0].id);
    expect(secondCompletedState.step?.id).toBe(secondTeaching.step.id);
    expect(secondCompletedState.step?.status).toBe('completed');
    expect(secondCompletedState.latestEvaluation?.result).toBe('passed');
    expect(secondCompletedState.pendingAdjustment?.status).toBe('pending');

    client.close();
    const reopened = await createDatabase(tmpPath);
    client = reopened.client;
    store = new StudyStore(reopened.db);
    await store.seedDefaults();
    appService = new AppService(
      store,
      createFakeSettingsService(),
      () => null,
      () => null
    );

    const restoredState = await appService.getLearningState();

    expect(restoredState.state.sessionStatus).toBe('completed');
    expect(restoredState.state.activeGoalId).toBe(goal.id);
    expect(restoredState.state.activeStageId).toBe(outline.stages[0].id);
    expect(restoredState.state.activeDailyTaskId).toBe(followUpPlan.blocks[0].id);
    expect(restoredState.state.activeStepId).toBe(secondTeaching.step.id);
    expect(restoredState.state.activeQuestionThreadId).toBeNull();
    expect(restoredState.step?.status).toBe('completed');
    expect(restoredState.pendingAdjustment?.status).toBe('pending');

    expect(aiCalls.map((call) => call.operation)).toEqual([
      'import',
      'stage_outline',
      'plan',
      'teach_step',
      'question',
      'question',
      'submission_evaluation',
      'teach_step',
      'submission_evaluation',
      'plan',
      'teach_step',
      'question',
      'submission_evaluation'
    ]);
  });
});

function installDeterministicAi(): Array<{ operation: string; user: string }> {
  const calls: Array<{ operation: string; user: string }> = [];
  let questionCount = 0;
  let evaluationCount = 0;
  let decisionCount = 0;

  vi.spyOn(AiClient.prototype, 'generateJson').mockImplementation(async (request) => {
    const operation = operationFromSystem(request.system);
    calls.push({ operation, user: request.user });

    if (operation === 'import') {
      return request.schema.parse({
        goals: [
          {
            title: '掌握 HTTP 缓存',
            description: '能解释并选择基础缓存策略',
            priority: 2,
            dueDate: null
          }
        ],
        tasks: [
          {
            title: '理解 Cache-Control',
            description: '学习 max-age、no-cache 和 must-revalidate',
            goalTitle: '掌握 HTTP 缓存',
            priority: 2,
            difficulty: 'foundation',
            estimateMinutes: 20,
            acceptanceCriteria: '能解释三种指令的区别',
            dependsOnTitles: []
          }
        ]
      });
    }

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

    if (operation === 'stage_outline') {
      return request.schema.parse({
        goalSummary: '先掌握缓存指令语义，再练习静态资源响应头。',
        stages: [
          {
            title: '缓存语义基础',
            objective: '理解 Cache-Control 常用指令',
            prerequisites: 'HTTP 请求响应基础',
            successCriteria: '能解释并选择合适缓存指令'
          }
        ]
      });
    }

    if (operation === 'plan') {
      const taskTitle = findTaskTitleInPrompt(request.user) ?? '理解 Cache-Control';
      return request.schema.parse({
        blocks: [
          {
            taskTitle,
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: taskTitle.startsWith('跟进：') ? '练习静态资源缓存响应头' : '区分 Cache-Control 指令',
            action: taskTitle.startsWith('跟进：') ? '写出一组响应头并解释理由' : '写出 max-age、no-cache 和 must-revalidate 的区别',
            expectedOutput: '一段可检查的中文说明',
            difficulty: 'foundation',
            material: '本地 HTTP 笔记',
            successCheck: '能说明缓存命中后是否需要重新验证',
            fallback: '先只比较两个指令'
          }
        ]
      });
    }

    if (operation === 'teach_step') {
      return request.schema.parse({
        title: '当前 Cache-Control 步骤',
        objective: '说明当前缓存指令的使用场景',
        instruction: '写出指令含义，并说明浏览器下一次请求会发生什么。',
        explanation: '先判断缓存是否新鲜，再判断是否需要向服务器重新验证。',
        userAction: '用自己的话写出区别。',
        expectedOutput: '一段包含指令区别的说明',
        successCriteria: '能解释 no-cache 不是不缓存',
        requiresSubmission: true
      });
    }

    if (operation === 'question') {
      questionCount += 1;
      return request.schema.parse({
        answer: questionCount === 1
          ? 'no-cache 可以存储响应，但使用前必须重新验证。'
          : 'must-revalidate 表示过期后必须重新验证，不能随意使用陈旧缓存。',
        relationToCurrentStep: '都用于补全当前步骤的 Cache-Control 指令理解。',
        example: 'Cache-Control: max-age=60, must-revalidate',
        resolved: questionCount >= 2,
        returnToStepInstruction: '回到当前步骤，继续完成指令区别说明。',
        resolutionSummary: questionCount >= 2 ? '用户理解了 no-cache 与 must-revalidate。' : ''
      });
    }

    if (operation === 'submission_evaluation') {
      evaluationCount += 1;
      return request.schema.parse(
        evaluationCount === 1
          ? {
              result: 'partial',
              mastery: 62,
              evidence: ['说明了 max-age 和 no-cache'],
              correctParts: ['知道 no-cache 需要验证'],
              misconceptions: [],
              missingRequirements: ['补充 must-revalidate'],
              feedback: '还缺 must-revalidate 的强制重新验证语义。',
              recommendedAction: 'remediate'
            }
          : {
              result: 'passed',
              mastery: 90,
              evidence: ['完整说明三种指令'],
              correctParts: ['区分了验证和缓存存储'],
              misconceptions: [],
              missingRequirements: [],
              feedback: '已经达到当前任务完成标准。',
              recommendedAction: 'complete_task'
            }
      );
    }

    if (operation === 'next_step') {
      decisionCount += 1;
      return request.schema.parse(
        decisionCount === 1
          ? {
              decision: 'remediate',
              reason: '需要补齐 must-revalidate 后再完成任务。',
              taskCompleted: false,
              nextStep: null,
              remediation: {
                title: '补齐 must-revalidate',
                instruction: '用一句话比较 no-cache 和 must-revalidate。',
                expectedOutput: '包含两个指令区别的说明',
                successCriteria: '能说明过期后强制重新验证'
              },
              carryForward: '用户已掌握 max-age 和 no-cache。'
            }
          : {
              decision: 'complete_task',
              reason: '当前任务完成，可以安排响应头配置练习。',
              taskCompleted: true,
              nextStep: null,
              remediation: null,
              carryForward: '下一次练习为静态资源选择缓存响应头。'
            }
      );
    }

    throw new Error(`Unexpected AI operation: ${operation}`);
  });

  return calls;
}

function operationFromSystem(system: string): string {
  if (system.includes('import-agent')) return 'import';
  if (system.includes('goal-intake-agent')) return 'goal_intake';
  if (system.includes('generate-roadmap-agent')) return 'roadmap';
  if (system.includes('generate-short-plan-agent')) return 'short_plan';
  if (system.includes('generate-daily-guide-agent')) return 'daily_guide';
  if (system.includes('planning-service')) return 'stage_outline';
  if (system.includes('planner-agent')) return 'plan';
  if (system.includes('tutoring-service')) return 'teach_step';
  if (system.includes('question-branch')) return 'question';
  if (system.includes('evaluation-service')) return 'submission_evaluation';
  if (system.includes('progression-service')) return 'next_step';
  return 'unknown';
}

function findTaskTitleInPrompt(prompt: string): string | null {
  const followUpMatch = prompt.match(/"title":"(跟进：[^"]+)"/);
  if (followUpMatch?.[1]) return followUpMatch[1];
  const stageStartMatch = prompt.match(/"title":"(阶段起步：[^"]+)"/);
  if (stageStartMatch?.[1]) return stageStartMatch[1];
  const cacheTaskMatch = prompt.match(/"title":"(理解 Cache-Control)"/);
  return cacheTaskMatch?.[1] ?? null;
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
