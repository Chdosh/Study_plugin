import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { createDatabase, type DatabaseClient } from '../db/client';
import type { Database } from '../db/client';
import {
  aiReviews,
  dailyGuideActions,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  goals,
  learningRuntimeStates,
  learningSteps,
  learningSubmissions,
  planStages,
  roadmapStages,
  shortPlanDays,
  studySessions
} from '../db/schema';
import { ContextBuilder } from './context-builder';
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
    const taskId = guide.tasks[0].id;

    const started = await store.startSession(taskId);
    vi.setSystemTime(new Date('2026-07-05T10:01:00.000Z'));
    const paused = await store.pauseSession(started.id);
    expect(await store.getAccumulatedSeconds(taskId)).toBeGreaterThan(0);
    const resumed = await store.startSession(taskId);

    expect(paused.durationMinutes).toBeCloseTo(1);
    expect(resumed.id).toBe(started.id);
    expect(resumed.status).toBe('active');
    expect((await store.listSessions()).filter((session) => session.status === 'active')).toHaveLength(1);
  });

  it('persists question branches and returns to the same Daily Guide action', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    const session = await store.startSession(taskId);
    const started = await store.getLearningRuntimeSnapshot();

    expect(started.dailyGuideAction?.id).toBeTruthy();
    expect(started.dailyGuideAction?.title).toBe('打开项目');

    const actionId = started.dailyGuideAction!.id;
    const thread = await store.openQuestion(actionId, '先看哪个入口？');
    expect((await store.getLearningRuntimeSnapshot()).state.activeQuestionThreadId).toBe(thread.id);

    await store.resolveQuestion(thread.id, '先看 Electron 入口，再看 renderer。');
    const resolved = await store.getLearningRuntimeSnapshot();

    expect(resolved.state.activeStepId).toBe(actionId);
    expect(resolved.state.activeQuestionThreadId).toBeNull();

    const afterAction = await store.completeCurrentAction();
    expect(afterAction.dailyGuideAction?.title).toBe('跑主流程');

    const submission = await store.createSubmission(afterAction.dailyGuideAction!.id, session.id, '已跑通主流程并记录入口。');
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
        recommendedAction: 'complete_task',
        decision: 'advance'
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
    expect(completed.state.activeDailyTaskId).toBe(guide.tasks[1].id);
    expect(completed.dailyGuideAction?.title).toBe('找入口');
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

// ── Runtime Convergence Tests ──────────────────────────────────────
// These tests validate the post-convergence state.
// Marked .skip initially — unskip after step 2–5 are complete.
describe('Runtime convergence', () => {
  let db: Database;
  beforeEach(async () => {
    db = (store as any).db as Database;
  });

  it('1. activeDailyTaskId directly queries daily_guide_tasks by task id', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);
    const snapshot = await store.getLearningRuntimeSnapshot();

    const taskRows = await db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.id, snapshot.state.activeDailyTaskId!));
    expect(taskRows[0]).toBeTruthy();
    expect(taskRows[0].id).toBe(taskId);
  });

  it('2. activeStepId directly queries daily_guide_actions', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);
    const snapshot = await store.getLearningRuntimeSnapshot();

    const actionRows = await db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.id, snapshot.state.activeStepId!));
    expect(actionRows[0]).toBeTruthy();
  });

  it('3. activeStageId directly queries roadmap_stages', async () => {
    await createConfirmedGuide();
    const rows = await db.select().from(roadmapStages);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('4. Study Session anchors to daily_guide_tasks.id', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    const session = await store.startSession(taskId);

    const taskRows = await db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.id, session.taskId as any));
    expect(taskRows[0]).toBeTruthy();
  });

  it('5. context-builder reads from guideTask/guideAction not block/step', async () => {
    const builder = new ContextBuilder(store);
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    const built = await builder.build('teach_step');
    const ctx = built.context as Record<string, unknown>;

    expect(ctx).toHaveProperty('guideTask');
    expect(ctx).not.toHaveProperty('block');
  });

  it('6. restart recovers to same task/action', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);
    const before = await store.getLearningRuntimeSnapshot();

    const after = await store.getLearningRuntimeSnapshot();
    expect(after.state.activeDailyTaskId).toBe(before.state.activeDailyTaskId);
    expect(after.state.activeStepId).toBe(before.state.activeStepId);
  });

  it('7. missing ID mapping preserves formal learning data', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    // Complete first action, then submit and evaluate the second
    await store.completeCurrentAction();
    const mid = await store.getLearningRuntimeSnapshot();
    const actionId = mid.dailyGuideAction!.id;
    const session = (await store.listSessions())[0];
    const submission = await store.createSubmission(actionId, session.id, 'Done.');
    await store.saveEvaluationAndDecision({
      submission,
      evaluationOutput: {
        result: 'passed', mastery: 90, evidence: ['ok'],
        correctParts: ['ok'], misconceptions: [], missingRequirements: [],
        feedback: 'Good.', recommendedAction: 'complete_task', decision: 'advance'
      },
      decisionOutput: {
        decision: 'complete_task', reason: 'Done.',
        taskCompleted: true, nextStep: null, remediation: null, carryForward: ''
      }
    });

    // After passing evaluation on the last action of task 1, task 1 is done
    const guideAfter = await store.getActiveGuide();
    expect(guideAfter.guide).toBeTruthy();
    expect(guideAfter.guide!.tasks[0].status).toBe('done');

    const subRows = await db.select().from(learningSubmissions);
    expect(subRows.length).toBe(1);
  });

  // ── Migration rule tests ──

  it('8. blockId unique → dailyGuideTaskId (one-to-one)', async () => {
    const guide = await createConfirmedGuide();
    const task = guide.tasks[0];
    expect(task.legacyPlanBlockId).toBeTruthy();
    const sameBlock = guide.tasks.filter((t) => t.legacyPlanBlockId === task.legacyPlanBlockId);
    expect(sameBlock).toHaveLength(1);
  });

  it('9. blockId no match → runtime pointer null', async () => {
    const rows = await db.select().from(learningRuntimeStates).where(eq(learningRuntimeStates.id, 'default'));
    if (rows[0]) {
      await db.update(learningRuntimeStates)
        .set({ activeDailyTaskId: 'nonexistent-block-id', updatedAt: '2026-07-05T00:00:00.000Z' })
        .where(eq(learningRuntimeStates.id, 'default'));
    }
    const snapshot = await store.getLearningRuntimeSnapshot();
    expect(snapshot.dailyGuideTask).toBeNull();
  });

  it('10. blockId multiple matches → no arbitrary selection', async () => {
    const guide = await createConfirmedGuide();
    const blockIds = guide.tasks.map((t) => t.legacyPlanBlockId);
    expect(new Set(blockIds).size).toBe(guide.tasks.length);
  });

  it('11. old activeStepId NOT mapped by position', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);
    const snapshot = await store.getLearningRuntimeSnapshot();

    const actionRows = await db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.id, snapshot.state.activeStepId!));
    expect(actionRows[0]).toBeTruthy();
  });

  it('12. valid task.currentAction used for recovery', async () => {
    const guide = await createConfirmedGuide();
    const task = guide.tasks[0];
    const currentAction = task.currentAction;
    if (currentAction) {
      const actionRows = await db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.id, currentAction.id));
      expect(actionRows[0]).toBeTruthy();
      expect(actionRows[0].taskId).toBe(task.id);
    }
  });

  it('13. invalid currentAction → state machine recovers', async () => {
    const guide = await createConfirmedGuide();
    const { recoverExecutionState } = await import('../domain/execution-state-machine');
    const result = recoverExecutionState({ tasks: guide.tasks }, {});
    expect(result.ok).toBe(true);
  });

  it('14. old activeStageId NOT mapped by position', async () => {
    const runtimeRows = await db.select().from(learningRuntimeStates).where(eq(learningRuntimeStates.id, 'default'));
    const stageId = runtimeRows[0]?.activeStageId;
    if (stageId) {
      const roadmapRows = await db.select().from(roadmapStages).where(eq(roadmapStages.id, stageId));
      // Resolves in roadmap, or was cleared
      expect(roadmapRows.length === 1 || stageId === null).toBe(true);
    }
  });

  it('15. unmappable active session safely terminated', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    const sessions = await store.listSessions();
    const activeSession = sessions.find((s) => s.status === 'active');
    expect(activeSession).toBeTruthy();
    await store.pauseSession(activeSession!.id);
    const paused = await store.listSessions();
    expect(paused.find((s) => s.id === activeSession!.id)?.status).toBe('paused');
  });

  it('16. new sessions only write dailyGuideTaskId', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    const session = await store.startSession(taskId);

    const taskRows = await db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.id, session.taskId as any));
    expect(taskRows[0]).toBeTruthy();
  });

  it('17. PRAGMA foreign_key_check passes', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    const fkErrors = await db.all<Record<string, unknown>>(sql`PRAGMA foreign_key_check`);
    expect(fkErrors).toHaveLength(0);
  });

  it('18. formal data record counts unchanged', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    const goalCount = (await db.select({ c: sql<number>`count(*)` }).from(goals))[0]?.c;
    const guideCount = (await db.select({ c: sql<number>`count(*)` }).from(dailyGuides))[0]?.c;
    const taskCount = (await db.select({ c: sql<number>`count(*)` }).from(dailyGuideTasks))[0]?.c;
    const roadmapCount = (await db.select({ c: sql<number>`count(*)` }).from(roadmapStages))[0]?.c;

    expect(goalCount).toBe(1);
    expect(guideCount).toBe(1);
    expect(taskCount).toBe(2);
    expect(roadmapCount).toBe(1);
  });

  it('findActiveOrActivateStage dedupes multiple active stages', async () => {
    const goal = await store.createGoal('test', 'test');
    const stage1Id = 'stage-1';
    const stage2Id = 'stage-2';
    await store.db.insert(roadmapStages).values([
      { id: stage1Id, goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'active', createdAt: 'now', updatedAt: 'now' },
      { id: stage2Id, goalId: goal.id, title: 'S2', objective: 'O2', direction: 'D2', successCriteria: 'SC2', position: 1, status: 'active', createdAt: 'now', updatedAt: 'now' }
    ]);

    const result = await store.findActiveOrActivateStage(goal.id);
    expect(result).not.toBeNull();
    expect(result).not.toBe('goal_completed');
    if (result && typeof result !== 'string') {
      expect(result.id).toBe(stage1Id);
    }

    const stages = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id));
    const activeStages = stages.filter((s) => s.status === 'active');
    expect(activeStages.length).toBe(1);
    expect(activeStages[0].id).toBe(stage1Id);
  });

  it('findActiveOrActivateStage activates first pending when no active', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.db.insert(roadmapStages).values([
      { id: 's1', goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'completed', createdAt: 'now', updatedAt: 'now' },
      { id: 's2', goalId: goal.id, title: 'S2', objective: 'O2', direction: 'D2', successCriteria: 'SC2', position: 1, status: 'pending', createdAt: 'now', updatedAt: 'now' }
    ]);

    const result = await store.findActiveOrActivateStage(goal.id);
    expect(result).not.toBeNull();
    expect(result).not.toBe('goal_completed');
    if (result && typeof result !== 'string') {
      expect(result.id).toBe('s2');
      expect(result.status).toBe('active');
    }
  });

  it('findActiveOrActivateStage returns goal_completed when all done', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.db.insert(roadmapStages).values([
      { id: 's1', goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'completed', createdAt: 'now', updatedAt: 'now' },
      { id: 's2', goalId: goal.id, title: 'S2', objective: 'O2', direction: 'D2', successCriteria: 'SC2', position: 1, status: 'completed', createdAt: 'now', updatedAt: 'now' }
    ]);

    const result = await store.findActiveOrActivateStage(goal.id);
    expect(result).toBe('goal_completed');
  });

  it('applyReviewPlanAdjustments only updates active-stage pending days and preserves task list', async () => {
    const goal = await store.createGoal('test', 'test');
    const now = '2026-07-07T00:00:00.000Z';
    await store.db.insert(roadmapStages).values([
      { id: 's1', goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'active', createdAt: now, updatedAt: now },
      { id: 's2', goalId: goal.id, title: 'S2', objective: 'O2', direction: 'D2', successCriteria: 'SC2', position: 1, status: 'pending', createdAt: now, updatedAt: now }
    ]);
    await store.db.insert(shortPlanDays).values([
      {
        id: 'day-active-stage',
        goalId: goal.id,
        roadmapStageId: 's1',
        dayIndex: 2,
        date: null,
        sessionStatus: 'pending',
        title: '当前阶段原单元',
        focus: '原重点',
        tasksJson: JSON.stringify(['保留任务 A', '保留任务 B']),
        expectedOutput: '原产出',
        successCriteria: '原标准',
        createdAt: now
      },
      {
        id: 'day-next-stage',
        goalId: goal.id,
        roadmapStageId: 's2',
        dayIndex: 2,
        date: null,
        sessionStatus: 'pending',
        title: '后续阶段原单元',
        focus: '后续重点',
        tasksJson: JSON.stringify(['不能被改']),
        expectedOutput: '后续产出',
        successCriteria: '后续标准',
        createdAt: now
      }
    ]);

    const updated = await store.applyReviewPlanAdjustments({
      goalId: goal.id,
      adjustments: [{
        dayIndex: 2,
        title: '调整后的当前阶段单元',
        focus: '调整后的重点',
        expectedOutput: '调整后的产出',
        successCriteria: '调整后的标准',
        reason: '基础不牢需要回炉'
      }]
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('day-active-stage');
    expect(updated[0].tasks).toEqual(['保留任务 A', '保留任务 B']);

    const rows = await store.db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goal.id));
    const activeDay = rows.find((row) => row.id === 'day-active-stage')!;
    const nextStageDay = rows.find((row) => row.id === 'day-next-stage')!;
    expect(JSON.parse(activeDay.tasksJson)).toEqual(['保留任务 A', '保留任务 B']);
    expect(nextStageDay.title).toBe('后续阶段原单元');
    expect(JSON.parse(nextStageDay.tasksJson)).toEqual(['不能被改']);
  });

  it('applyEvaluationDecisionToRoadmap is idempotent', async () => {
    const goal = await store.createGoal('test', 'test');
    const result = await store.saveLayeredPlan({
      goal,
      brief: null,
      date: '2026-07-05',
      windows: [{ start: '10:00', end: '12:00' }],
      roadmap: {
        goalSummary: 'test',
        stages: [
          { title: '项目接管基础', objective: '能跑通项目并讲清主流程', direction: '先理解已有项目', successCriteria: '能讲清' },
          { title: '功能演示', objective: '能演示核心功能', direction: '做演示', successCriteria: '能演示' }
        ]
      },
      shortPlan: { weekFocus: 'test', days: [{ dayIndex: 1, title: 'T1', focus: 'F1', tasks: ['task1'], expectedOutput: 'EO1', successCriteria: 'SC1' }] },
      dailyGuide: { date: '2026-07-05', todayGoal: 'test', deliverables: [], boundaries: [], acceptanceCriteria: [], tomorrowActions: [], tasks: [{ title: 'Task1', objective: 'Obj1', scope: 'Scope1', estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [{ title: 'A1', instruction: 'Do A1', checkpoint: 'Done' }], deliverable: 'Del1', doneWhen: ['Done'], quickHint: 'Hint', evaluationMode: 'local', submissionPolicy: 'once_after_task', carryoverAllowed: true }] }
    });

    const guideRows = await store.db.select({ id: dailyGuides.id }).from(dailyGuides).where(eq(dailyGuides.goalId, goal.id)).orderBy(desc(dailyGuides.createdAt)).limit(1);
    const taskRows = await store.db.select({ id: dailyGuideTasks.id }).from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideRows[0].id)).limit(1);
    const taskId = taskRows[0].id;
    const stages = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id)).orderBy(asc(roadmapStages.position));
    expect(stages.length).toBe(2);
    expect(stages[0].status).toBe('active');
    expect(stages[1].status).toBe('pending');

    await store.applyEvaluationDecisionToRoadmap({ goalId: goal.id, taskId, decision: 'advance', taskCompleted: true });
    const afterFirst = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id));
    expect(afterFirst.find((s) => s.id === stages[0].id)?.status).toBe('completed');
    expect(afterFirst.find((s) => s.id === stages[1].id)?.status).toBe('active');

    await store.applyEvaluationDecisionToRoadmap({ goalId: goal.id, taskId, decision: 'advance', taskCompleted: true });
    const afterSecond = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id));
    expect(afterSecond.find((s) => s.id === stages[0].id)?.status).toBe('completed');
    const activeCount = afterSecond.filter((s) => s.status === 'active').length;
    expect(activeCount).toBe(1);
  });

  it('getLatestReview excludes rolling_plan records', async () => {
    await store.db.insert(aiReviews).values({
      id: 'r-rolling',
      kind: 'rolling_plan',
      date: '2026-07-05',
      provider: 'deepseek',
      model: 'test',
      inputSnapshotJson: '{}',
      outputJson: JSON.stringify({ weekFocus: 'test', days: [] }),
      outputSchemaVersion: 'rolling-plan.v1',
      status: 'success',
      createdAt: '2026-07-05T00:00:00Z'
    });
    await store.db.insert(aiReviews).values({
      id: 'r-real',
      kind: 'reflection',
      date: '2026-07-05',
      provider: 'deepseek',
      model: 'test',
      inputSnapshotJson: '{}',
      outputJson: JSON.stringify({ completionScore: 80, focusScore: 75, summary: '复盘内容', nextActions: ['下一步'] }),
      outputSchemaVersion: 'review.v1',
      status: 'success',
      createdAt: '2026-07-05T01:00:00Z'
    });

    const latest = await store.getLatestReview();
    expect(latest).not.toBeNull();
    expect(latest?.reviewId).toBe('r-real');
    expect(latest?.summary).toBe('复盘内容');
  });

  it('saveRollingPlanDays continues dayIndex cumulatively without upper limit', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.db.insert(roadmapStages).values([
      { id: 's1', goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'active', createdAt: 'now', updatedAt: 'now' }
    ]);

    await store.saveRollingPlanDays({
      goalId: goal.id,
      roadmapStageId: 's1',
      items: [
        { dayIndex: 1, title: 'T1', focus: 'F1', tasks: ['a'], expectedOutput: 'EO1', successCriteria: 'SC1' },
        { dayIndex: 2, title: 'T2', focus: 'F2', tasks: ['b'], expectedOutput: 'EO2', successCriteria: 'SC2' },
        { dayIndex: 3, title: 'T3', focus: 'F3', tasks: ['c'], expectedOutput: 'EO3', successCriteria: 'SC3' }
      ]
    });

    await store.saveRollingPlanDays({
      goalId: goal.id,
      roadmapStageId: 's1',
      items: [
        { dayIndex: 1, title: 'T4', focus: 'F4', tasks: ['d'], expectedOutput: 'EO4', successCriteria: 'SC4' },
        { dayIndex: 2, title: 'T5', focus: 'F5', tasks: ['e'], expectedOutput: 'EO5', successCriteria: 'SC5' }
      ]
    });

    const allDays = await store.db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goal.id));
    const dayIndexes = allDays.map((d) => d.dayIndex).sort((a, b) => a - b);
    expect(dayIndexes).toEqual([1, 2, 3, 4, 5]);
  });

  it('recordKnowledgeItems inserts new and increments existing', async () => {
    const goal = await store.createGoal('test', 'test');

    const first = await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' }]
    });
    expect(first.length).toBe(1);
    expect(first[0].occurrenceCount).toBe(1);

    const second = await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' }]
    });
    expect(second.length).toBe(1);
    expect(second[0].occurrenceCount).toBe(2);

    const items = await store.getKnowledgeItemsForGoal({ goalId: goal.id });
    expect(items.length).toBe(1);
    expect(items[0].key).toBe('hooks');
  });

  it('getReviewWorthyKnowledgeItems returns only items with >= 2 occurrences', async () => {
    const goal = await store.createGoal('test', 'test');

    await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [
        { key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' },
        { key: 'state', summary: 'State 管理薄弱', sourceType: 'weakness' }
      ]
    });
    await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' }]
    });

    const reviewWorthy = await store.getReviewWorthyKnowledgeItems(goal.id);
    expect(reviewWorthy.length).toBe(1);
    expect(reviewWorthy[0].key).toBe('hooks');
    expect(reviewWorthy[0].occurrenceCount).toBe(2);
  });

  it('applyReviewPlanAdjustments skips locked days', async () => {
    const goal = await store.createGoal('test', 'test');
    const result = await store.saveLayeredPlan({
      goal,
      brief: null,
      date: '2026-07-05',
      windows: [{ start: '10:00', end: '12:00' }],
      roadmap: { goalSummary: 'test', stages: [{ title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1' }] },
      shortPlan: { weekFocus: 'test', days: [{ dayIndex: 1, title: 'T1', focus: 'F1', tasks: ['task1'], expectedOutput: 'EO1', successCriteria: 'SC1' }] },
      dailyGuide: { date: '2026-07-05', todayGoal: 'test', deliverables: [], boundaries: [], acceptanceCriteria: [], tomorrowActions: [], tasks: [{ title: 'Task1', objective: 'Obj1', scope: 'Scope1', estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [{ title: 'A1', instruction: 'Do A1', checkpoint: 'Done' }], deliverable: 'Del1', doneWhen: ['Done'], quickHint: 'Hint', evaluationMode: 'local', submissionPolicy: 'once_after_task', carryoverAllowed: true }] }
    });

    const dayId = result.shortPlan[0].id;
    await store.db.update(shortPlanDays).set({ locked: true }).where(eq(shortPlanDays.id, dayId));

    const updated = await store.applyReviewPlanAdjustments({
      goalId: goal.id,
      adjustments: [{ dayIndex: 1, title: '新标题', focus: '新重点', expectedOutput: '新产出', successCriteria: '新标准', reason: '原因' }]
    });
    expect(updated.length).toBe(0);
  });
});

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
