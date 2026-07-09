import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseClient } from '../db/client';
import { StudyStore } from './store';

let tmpPath: string;
let client: DatabaseClient;
let store: StudyStore;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-supervisor-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  store = new StudyStore(created.db);
  await store.seedDefaults();
});

afterEach(async () => {
  vi.useRealTimers();
  client.close();
  await removeTempDir(tmpPath);
});

describe('StudyStore', () => {
  it('seeds editable prompt profiles', async () => {
    const prompts = await store.listPromptProfiles();

    expect(prompts.map((prompt) => prompt.key)).toContain('foundation');
    expect(prompts[0].version).toBeGreaterThan(0);
  });

  it('uses Daily Guide blocks as the session anchor without a separate daily-plan lifecycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T10:00:00.000Z'));
    const guide = await createConfirmedGuide();
    const blockId = guide.blocks[0].planBlockId;

    const started = await store.startSession(blockId);
    vi.setSystemTime(new Date('2026-07-05T10:01:00.000Z'));
    const paused = await store.pauseSession(started.id);
    expect(await store.getAccumulatedSeconds(blockId)).toBe(60);
    const resumed = await store.startSession(blockId);

    expect(paused.durationMinutes).toBeCloseTo(1);
    expect(resumed.id).toBe(started.id);
    expect(resumed.status).toBe('active');
    expect((await store.listSessions()).filter((session) => session.status === 'active')).toHaveLength(1);
  });

  it('persists question branches and returns to the same Daily Guide action', async () => {
    const guide = await createConfirmedGuide();
    const blockId = guide.blocks[0].planBlockId;
    const session = await store.startSession(blockId);
    const started = await store.getLearningRuntimeSnapshot();

    expect(started.step?.blockId).toBe(blockId);
    expect(started.step?.title).toBe('打开项目');

    const thread = await store.openQuestion(started.step!.id, '先看哪个入口？');
    expect((await store.getLearningRuntimeSnapshot()).state.activeQuestionThreadId).toBe(thread.id);

    await store.resolveQuestion(thread.id, '先看 Electron 入口，再看 renderer。');
    const resolved = await store.getLearningRuntimeSnapshot();

    expect(resolved.state.activeStepId).toBe(started.step?.id);
    expect(resolved.state.activeQuestionThreadId).toBeNull();

    const afterAction = await store.completeCurrentAction();
    expect(afterAction.step?.title).toBe('跑主流程');

    const submission = await store.createSubmission(afterAction.step!.id, session.id, '已跑通主流程并记录入口。');
    await store.saveEvaluationAndDecision({
      submission,
      evaluationOutput: {
        result: 'passed',
        mastery: 88,
        evidence: ['完成主流程记录'],
        correctParts: ['能指出入口'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '当前主任务达到提交标准。',
        recommendedAction: 'complete_task'
      },
      decisionOutput: {
        decision: 'complete_task',
        reason: '主任务已经完成，可以进入下一项。',
        taskCompleted: true,
        nextStep: null,
        remediation: null,
        carryForward: '下一项继续整理代码地图。'
      }
    });

    const completed = await store.getLearningRuntimeSnapshot();
    expect(completed.state.activeDailyTaskId).toBe(guide.blocks[1].planBlockId);
    expect(completed.step?.title).toBe('找入口');
  });
});

async function createConfirmedGuide() {
  const goal = await store.createGoal('接管项目', '能跑通并讲清当前项目');
  const result = await store.saveLayeredPlan({
    goal,
    brief: null,
    date: '2026-07-05',
    windows: [{ start: '10:00', end: '12:00' }],
    roadmap: {
      goalSummary: '先接管项目，再修演示级问题。',
      stages: [
        {
          title: '项目接管基础',
          objective: '能跑通项目并讲清主流程',
          direction: '先理解已有项目，再补关键技术点',
          successCriteria: '能用 2 分钟讲清项目为什么做、怎么做'
        }
      ]
    },
    shortPlan: {
      weekFocus: '把项目变成可讲、可演示的资产',
      days: [
        {
          dayIndex: 1,
          title: '跑通并梳理项目',
          focus: '建立项目所有权',
          tasks: ['跑一遍主流程', '写代码地图'],
          expectedOutput: '项目接管文档初稿',
          successCriteria: '能说清入口、主流程和关键模块'
        }
      ]
    },
    dailyGuide: {
      date: '2026-07-05',
      todayGoal: '今天把项目从做过推进到能讲、能演示。',
      deliverables: ['主流程说明', '代码目录地图'],
      boundaries: ['不大改 UI'],
      acceptanceCriteria: ['能讲清项目主流程'],
      tomorrowActions: ['修最高优先级 bug'],
      tasks: [
        {
          title: '锁定今天边界',
          objective: '明确今天只做接管和文档',
          scope: '跑通主流程并记录今天不做的范围',
          estimatedMinutes: { min: 25, target: 35, max: 50 },
          actions: [
            { title: '打开项目', instruction: '启动应用并进入 Today', checkpoint: '看到主界面' },
            { title: '跑主流程', instruction: '按主动访谈到执行稿路径操作一次', checkpoint: '记录关键入口' }
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
            { title: '找入口', instruction: '定位 Electron、preload 和 renderer 入口', checkpoint: '入口文件已列出' }
          ],
          deliverable: '代码目录地图',
          doneWhen: ['能指出每个核心模块职责'],
          quickHint: '先只整理入口和 AI 请求链路',
          evaluationMode: 'ai',
          submissionPolicy: 'once_after_task',
          carryoverAllowed: true
        }
      ]
    }
  });
  return store.confirmDailyGuide(result.guide.id);
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
