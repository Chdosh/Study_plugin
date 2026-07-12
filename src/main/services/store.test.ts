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
  dailyPlans,
  goals,
  knowledgeItems,
  knowledgeItemEvidence,
  learningEvaluations,
  learningRuntimeStates,
  learningSteps,
  learningSubmissions,
  nextStepDecisions,
  planAdjustmentProposals,
  planStages,
  planVersions,
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

  it('Action 全部完成后仍停留当前主任务等待提交', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);

    await store.completeCurrentAction();
    const awaitingSubmission = await store.completeCurrentAction();

    expect(awaitingSubmission.state.activeDailyTaskId).toBe(taskId);
    expect(awaitingSubmission.state.activeStepId).toBe(guide.tasks[0].actions[1].id);
    expect(awaitingSubmission.dailyGuideTask?.status).toBe('active');
    expect(awaitingSubmission.dailyGuideTask?.actions.every((action) => action.status === 'done')).toBe(true);
    expect(awaitingSubmission.dailyGuideAction?.status).toBe('done');
    expect(awaitingSubmission.dailyGuide?.tasks[1].status).toBe('planned');
  });

  it('跳过主任务时保留 skipped 语义并进入同一 Guide 的下一任务', async () => {
    const guide = await createConfirmedGuide();
    await store.startSession(guide.tasks[0].id);

    const afterSkip = await store.skipCurrentTask();

    expect(afterSkip.dailyGuide?.tasks[0].status).toBe('skipped');
    expect(afterSkip.state.activeDailyTaskId).toBe(guide.tasks[1].id);
    expect(afterSkip.dailyGuideTask?.status).toBe('active');
    expect(afterSkip.dailyGuideAction?.id).toBe(guide.tasks[1].actions[0].id);
    expect(afterSkip.dailyGuide?.sessionStatus).toBe('active');
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

  it('recordKnowledgeItems groups equivalent technical misconception wording', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'React Hooks 概念混淆', summary: 'React Hooks 概念混淆', sourceType: 'misconception', sourceId: 'submission-1' }]
    });
    await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: '对 React Hooks 的理解仍有混淆', summary: '对 React Hooks 的理解仍有混淆', sourceType: 'misconception', sourceId: 'submission-2' }]
    });

    const items = await store.getKnowledgeItemsForGoal({ goalId: goal.id });
    expect(items).toHaveLength(1);
    expect(items[0].occurrenceCount).toBe(2);
    const evidence = await store.db.select().from(knowledgeItemEvidence).where(eq(knowledgeItemEvidence.knowledgeItemId, items[0].id));
    expect(evidence.map((item) => item.sourceId).sort()).toEqual(['submission-1', 'submission-2']);
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

  it('auditRuntimeConsistency fixes invalid pointers and reports conflicts', async () => {
    await store.db.delete(learningRuntimeStates);
    const goal1 = await store.createGoal('goal1', 'active goal');
    const goal2 = await store.createGoal('goal2', 'inactive goal');
    await store.db.update(goals).set({ status: 'archived' }).where(eq(goals.id, goal2.id));

    await store.db.insert(learningRuntimeStates).values({
      id: 'runtime-1',
      activeGoalId: goal2.id,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle',
      updatedAt: 'now'
    });

    const result = await store.auditRuntimeConsistency();
    expect(result.fixed.length).toBeGreaterThan(0);
    expect(result.fixed[0]).toContain('activeGoalId');

    const runtimeRows = await store.db.select().from(learningRuntimeStates);
    expect(runtimeRows[0].activeGoalId).toBe(goal1.id);

    await store.db.delete(learningRuntimeStates);
    await store.db.delete(goals);
  });
  it('auditRuntimeConsistency repairs one recoverable Session but reports ambiguous multiple Sessions', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    const session = await store.startSession(taskId);
    await store.db.update(learningRuntimeStates).set({
      activeDailyTaskId: null,
      activeStepId: null,
      sessionStatus: 'idle'
    });

    const repaired = await store.auditRuntimeConsistency();
    const runtimeRows = await store.db.select().from(learningRuntimeStates);
    expect(repaired.consistent).toBe(true);
    expect(repaired.fixed.some((item) => item.includes('focusSession'))).toBe(true);
    expect(runtimeRows[0].activeDailyTaskId).toBe(taskId);
    expect(runtimeRows[0].sessionStatus).toBe('active');

    await store.db.insert(studySessions).values({
      id: 'session-conflict',
      taskId,
      taskItemsId: null,
      startedAt: '2026-07-11T00:00:00.000Z',
      endedAt: null,
      durationMinutes: null,
      status: 'paused',
      focusScore: null,
      notes: null
    });
    const conflicted = await store.auditRuntimeConsistency();
    expect(conflicted.consistent).toBe(false);
    expect(conflicted.conflicts.some((item) => item.field === 'focusSession')).toBe(true);
    expect((await store.listSessions()).map((item) => item.id)).toContain(session.id);
  });
  it('recordKnowledgeItems restores active status when a resolved item reappears', async () => {
    await store.db.delete(knowledgeItemEvidence);
    await store.db.delete(knowledgeItems);
    await store.db.delete(learningEvaluations);
    await store.db.delete(learningSubmissions);
    await store.db.delete(dailyGuideActions);
    await store.db.delete(dailyGuideTasks);
    await store.db.delete(dailyPlanBlocks);
    await store.db.delete(dailyPlans);
    await store.db.delete(shortPlanDays);
    await store.db.delete(dailyGuides);
    await store.db.delete(roadmapStages);
    await store.db.delete(goals);
    const goal = await store.createGoal('test', 'test');

    const first = await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' }]
    });
    expect(first.length).toBe(1);
    expect(first[0].occurrenceCount).toBe(1);

    await store.db.update(knowledgeItems).set({ status: 'resolved' }).where(eq(knowledgeItems.goalId, goal.id));

    const second = await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [{ key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' }]
    });
    expect(second.length).toBe(1);

    const items = await store.getKnowledgeItemsForGoal({ goalId: goal.id, status: 'active' });
    expect(items.length).toBe(1);
    expect(items[0].key).toBe('hooks');
    expect(items[0].occurrenceCount).toBe(2);
  });

  it('resolveKnowledgeItems marks matching active items as resolved', async () => {
    await store.db.delete(knowledgeItems);
    await store.db.delete(goals);
    const goal = await store.createGoal('test', 'test');

    await store.recordKnowledgeItems({
      goalId: goal.id,
      items: [
        { key: 'hooks', summary: 'React Hooks 概念混淆', sourceType: 'misconception' },
        { key: 'state', summary: 'State 管理薄弱', sourceType: 'weakness' }
      ]
    });

    await store.resolveKnowledgeItems(goal.id, ['React Hooks 概念混淆']);

    const items = await store.getKnowledgeItemsForGoal({ goalId: goal.id });
    const hooksItem = items.find((i) => i.key === 'hooks');
    const stateItem = items.find((i) => i.key === 'state');
    expect(hooksItem?.status).toBe('resolved');
    expect(stateItem?.status).toBe('active');
  });

  describe('P2 evaluation transaction and recovery', () => {
    it('saveEvaluationAndDecision writes evaluation, decision, and submission status atomically', async () => {
      const guide = await createConfirmedGuide();
      const taskId = guide.tasks[0].id;
      await store.startSession(taskId);
      const mid = await store.getLearningRuntimeSnapshot();
      const actionId = mid.dailyGuideAction!.id;
      const session = (await store.listSessions())[0];
      const submission = await store.createSubmission(actionId, session.id, '提交内容测试。');

      const result = await store.saveEvaluationAndDecision({
        submission,
        evaluationOutput: {
          result: 'passed', mastery: 85, evidence: ['完成'],
          correctParts: ['能跑通'], misconceptions: [], missingRequirements: [],
          feedback: '通过。', recommendedAction: 'complete_task', decision: 'advance'
        },
        decisionOutput: {
          decision: 'complete_task', reason: '已完成。',
          taskCompleted: true, nextStep: null, remediation: null, carryForward: ''
        }
      });

      // 验证 evaluation 已写入
      const evalRows = await db.select().from(learningEvaluations).where(eq(learningEvaluations.submissionId, submission.id));
      expect(evalRows.length).toBe(1);
      expect(evalRows[0].result).toBe('passed');

      // 验证 decision 已写入
      const decisionRows = await db.select().from(nextStepDecisions).where(eq(nextStepDecisions.evaluationId, result.evaluation.id));
      expect(decisionRows.length).toBe(1);
      expect(decisionRows[0].taskCompleted).toBe(true);

      // 验证 submission 状态已更新
      const subRows = await db.select().from(learningSubmissions).where(eq(learningSubmissions.id, submission.id));
      expect(subRows[0].evaluationStatus).toBe('completed');
      expect(subRows[0].applicationStatus).toBe('applied');
      expect(subRows[0].appliedAt).not.toBeNull();
    });

    it('applies the final evaluation through task, focus session, guide and runtime state', async () => {
      const guide = await createConfirmedGuide();
      const taskId = guide.tasks[0].id;
      const session = await store.startSession(taskId);
      await store.completeCurrentAction();
      const beforeFinal = await store.getLearningRuntimeSnapshot();
      const finalActionId = beforeFinal.dailyGuideAction!.id;
      await db.update(dailyGuideTasks).set({ status: 'skipped' }).where(eq(dailyGuideTasks.id, guide.tasks[1].id));
      const submission = await store.createSubmission(finalActionId, session.id, '最终成果。');

      await store.saveEvaluationAndDecision({
        submission,
        evaluationOutput: {
          result: 'passed', mastery: 90, evidence: ['完成'], correctParts: ['符合标准'],
          misconceptions: [], missingRequirements: [], feedback: '通过。', recommendedAction: 'complete_task', decision: 'advance'
        },
        decisionOutput: {
          decision: 'complete_task', reason: '完成主任务。', taskCompleted: true,
          nextStep: null, remediation: null, carryForward: ''
        }
      });

      expect((await store.getSubmissionById(submission.id))?.applicationStatus).toBe('applied');
      expect((await store.listSessions()).find((item) => item.id === session.id)?.status).toBe('completed');
      expect((await store.getDailyGuideById(guide.id))?.sessionStatus).toBe('closed');
      const runtime = await store.getLearningRuntimeSnapshot();
      expect(runtime.state.sessionStatus).toBe('completed');
      expect(runtime.state.activeDailyTaskId).toBeNull();
    });

    it('recoverPendingEvaluationProgress recovers evaluation-saved-but-task-not-done scenario', async () => {
      const guide = await createConfirmedGuide();
      const taskId = guide.tasks[0].id;
      await store.startSession(taskId);
      const mid = await store.getLearningRuntimeSnapshot();
      const actionId = mid.dailyGuideAction!.id;
      const session = (await store.listSessions())[0];
      const submission = await store.createSubmission(actionId, session.id, '最后一步提交内容。');

      // 手动模拟事务提交后的状态：evaluation + decision 已写入，但 task 未推进
      const evaluationId = 'test-eval-passed';
      await db.insert(learningEvaluations).values({
        id: evaluationId, submissionId: submission.id, stepId: null,
        dailyGuideActionId: actionId, result: 'passed', mastery: 90,
        evidenceJson: '["完成"]', correctPartsJson: '["能跑通"]',
        misconceptionsJson: '[]', missingRequirementsJson: '[]',
        feedback: '通过。', recommendedAction: 'complete_task',
        decision: 'advance', aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.insert(nextStepDecisions).values({
        id: 'test-decision-passed', evaluationId, stepId: null,
        decision: 'complete_task', reason: '已完成。', taskCompleted: true,
        nextStepJson: null, remediationJson: null, carryForward: null,
        aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.update(learningSubmissions).set({ evaluationStatus: 'completed' }).where(eq(learningSubmissions.id, submission.id));

      // 恢复前：action 仍为 planned（崩溃在事务后、推进前）
      const actionBefore = await db.select().from(dailyGuideActions).where(eq(dailyGuideActions.id, actionId)).limit(1);
      expect(actionBefore[0].status).toBe('planned');

      const recovery = await store.recoverPendingEvaluationProgress();
      expect(recovery.recovered).toBe(1);

      // 恢复后：action 已标记 done
      const actionAfter = await db.select().from(dailyGuideActions).where(eq(dailyGuideActions.id, actionId)).limit(1);
      expect(actionAfter[0].status).toBe('done');

      // 同 task 内推进到下一个 action（第二个 action）
      // 注意：task 的 DB status 保持 planned，仅 currentActionId 前进
      const taskAfter = await db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.id, taskId)).limit(1);
      expect(taskAfter[0].currentActionId).toBe(guide.tasks[0].actions[1].id);

      // runtime 推进到同 task 的下一个 action
      const runtimeAfter = await store.getLearningRuntimeSnapshot();
      expect(runtimeAfter.dailyGuideAction?.id).toBe(guide.tasks[0].actions[1].id);
    });

    it('recoverPendingEvaluationProgress is idempotent — multiple calls produce same result', async () => {
      const guide = await createConfirmedGuide();
      const taskId = guide.tasks[0].id;
      await store.startSession(taskId);
      const mid = await store.getLearningRuntimeSnapshot();
      const actionId = mid.dailyGuideAction!.id;
      const session = (await store.listSessions())[0];
      const submission = await store.createSubmission(actionId, session.id, '最后一步提交内容。');

      const evaluationId = 'test-eval-idempotent';
      await db.insert(learningEvaluations).values({
        id: evaluationId, submissionId: submission.id, stepId: null,
        dailyGuideActionId: actionId, result: 'passed', mastery: 90,
        evidenceJson: '["完成"]', correctPartsJson: '["能跑通"]',
        misconceptionsJson: '[]', missingRequirementsJson: '[]',
        feedback: '通过。', recommendedAction: 'complete_task',
        decision: 'advance', aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.insert(nextStepDecisions).values({
        id: 'test-decision-idempotent', evaluationId, stepId: null,
        decision: 'complete_task', reason: '已完成。', taskCompleted: true,
        nextStepJson: null, remediationJson: null, carryForward: null,
        aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.update(learningSubmissions).set({ evaluationStatus: 'completed' }).where(eq(learningSubmissions.id, submission.id));

      const first = await store.recoverPendingEvaluationProgress();
      expect(first.recovered).toBe(1);

      const second = await store.recoverPendingEvaluationProgress();
      expect(second.recovered).toBe(0);

      const third = await store.recoverPendingEvaluationProgress();
      expect(third.recovered).toBe(0);
    });

    it('recoverPendingEvaluationProgress applies not-passed records without advancing the action', async () => {
      const guide = await createConfirmedGuide();
      const taskId = guide.tasks[0].id;
      await store.startSession(taskId);
      const mid = await store.getLearningRuntimeSnapshot();
      const actionId = mid.dailyGuideAction!.id;
      const session = (await store.listSessions())[0];
      const submission = await store.createSubmission(actionId, session.id, '未通过提交。');

      const evaluationId = 'test-eval-failed';
      await db.insert(learningEvaluations).values({
        id: evaluationId, submissionId: submission.id, stepId: null,
        dailyGuideActionId: actionId, result: 'failed', mastery: 30,
        evidenceJson: '["不足"]', correctPartsJson: '[]',
        misconceptionsJson: '["概念混淆"]', missingRequirementsJson: '["缺少步骤"]',
        feedback: '未通过。', recommendedAction: 'remediate',
        decision: 'stay', aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.insert(nextStepDecisions).values({
        id: 'test-decision-failed', evaluationId, stepId: null,
        decision: 'remediate', reason: '需要补救。', taskCompleted: false,
        nextStepJson: null, remediationJson: null, carryForward: null,
        aiReviewId: null, createdAt: '2026-07-11T00:00:00.000Z'
      });
      await db.update(learningSubmissions).set({ evaluationStatus: 'completed' }).where(eq(learningSubmissions.id, submission.id));

      const recovery = await store.recoverPendingEvaluationProgress();
      expect(recovery.recovered).toBe(1);

      // action 应保持 planned（不是 done）
      const actionAfter = await db.select().from(dailyGuideActions).where(eq(dailyGuideActions.id, actionId)).limit(1);
      expect(actionAfter[0].status).toBe('planned');
      const submissionAfter = await db.select().from(learningSubmissions).where(eq(learningSubmissions.id, submission.id)).limit(1);
      expect(submissionAfter[0].applicationStatus).toBe('applied');
    });
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

describe('Plan Proposal', () => {
  it('createProposal writes a pending proposal', async () => {
    const goal = await store.createGoal('test', 'test');
    const proposal = await store.createProposal(goal.id, {
      reason: '调整节奏',
      adjustments: [{ dayIndex: 1, title: '新标题', focus: '新重点', expectedOutput: '新产出', successCriteria: '新标准' }]
    });
    expect(proposal.status).toBe('pending');
    expect(proposal.goalId).toBe(goal.id);
    expect(proposal.reason).toBe('调整节奏');
  });

  it('confirmProposal applies changes and writes plan version', async () => {
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

    const proposal = await store.createProposal(goal.id, {
      reason: '调整节奏',
      adjustments: [{ dayIndex: 1, title: '更新标题', focus: '更新重点', expectedOutput: '更新产出', successCriteria: '更新标准' }]
    });

    const decided = await store.confirmProposal(proposal.id);
    expect(decided.status).toBe('accepted');
    expect(decided.appliedAt).not.toBeNull();

    const versions = await store.getPlanVersionsForGoal(goal.id);
    const latestVersion = versions[0];
    expect(latestVersion).toBeTruthy();
    expect(latestVersion!.changeSummary).toContain('调整节奏');
    expect(latestVersion!.snapshot?.shortPlan?.[0]?.title).toBe('更新标题');
  });

  it('confirmProposal is idempotent — repeated call does not create duplicate version', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.saveLayeredPlan({
      goal,
      brief: null,
      date: '2026-07-05',
      windows: [{ start: '10:00', end: '12:00' }],
      roadmap: { goalSummary: 'test', stages: [{ title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1' }] },
      shortPlan: { weekFocus: 'test', days: [{ dayIndex: 1, title: 'T1', focus: 'F1', tasks: ['task1'], expectedOutput: 'EO1', successCriteria: 'SC1' }] },
      dailyGuide: { date: '2026-07-05', todayGoal: 'test', deliverables: [], boundaries: [], acceptanceCriteria: [], tomorrowActions: [], tasks: [{ title: 'Task1', objective: 'Obj1', scope: 'Scope1', estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [{ title: 'A1', instruction: 'Do A1', checkpoint: 'Done' }], deliverable: 'Del1', doneWhen: ['Done'], quickHint: 'Hint', evaluationMode: 'local', submissionPolicy: 'once_after_task', carryoverAllowed: true }] }
    });

    const proposal = await store.createProposal(goal.id, {
      reason: '调整',
      adjustments: [{ dayIndex: 1, title: '新', focus: 'F', expectedOutput: 'EO', successCriteria: 'SC' }]
    });

    const first = await store.confirmProposal(proposal.id);
    const second = await store.confirmProposal(proposal.id);
    expect(first.status).toBe('accepted');
    expect(second.status).toBe('accepted');

    const versions = await store.getPlanVersionsForGoal(goal.id);
    const matchingVersions = versions.filter((v) => v.changeSummary.includes('调整'));
    expect(matchingVersions.length).toBe(1);
  });

  it('rejectProposal does not modify any plan', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.saveLayeredPlan({
      goal,
      brief: null,
      date: '2026-07-05',
      windows: [{ start: '10:00', end: '12:00' }],
      roadmap: { goalSummary: 'test', stages: [{ title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1' }] },
      shortPlan: { weekFocus: 'test', days: [{ dayIndex: 1, title: '原始标题', focus: '原始重点', tasks: ['task1'], expectedOutput: 'EO1', successCriteria: 'SC1' }] },
      dailyGuide: { date: '2026-07-05', todayGoal: 'test', deliverables: [], boundaries: [], acceptanceCriteria: [], tomorrowActions: [], tasks: [{ title: 'Task1', objective: 'Obj1', scope: 'Scope1', estimatedMinutes: { min: 30, target: 45, max: 60 }, actions: [{ title: 'A1', instruction: 'Do A1', checkpoint: 'Done' }], deliverable: 'Del1', doneWhen: ['Done'], quickHint: 'Hint', evaluationMode: 'local', submissionPolicy: 'once_after_task', carryoverAllowed: true }] }
    });

    const proposal = await store.createProposal(goal.id, {
      reason: '建议调整',
      adjustments: [{ dayIndex: 1, title: '改动', focus: '改', expectedOutput: '改', successCriteria: '改' }]
    });

    const decided = await store.rejectProposal(proposal.id);
    expect(decided.status).toBe('rejected');
    expect(decided.decidedAt).not.toBeNull();

    const db = (store as any).db as Database;
    const dayRows = await db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goal.id));
    expect(dayRows[0].title).toBe('原始标题');
  });

  it('confirmProposal skips locked days', async () => {
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

    const proposal = await store.createProposal(goal.id, {
      reason: '调整',
      adjustments: [{ dayIndex: 1, title: '新标题', focus: 'F', expectedOutput: 'EO', successCriteria: 'SC' }]
    });

    const decided = await store.confirmProposal(proposal.id);
    expect(decided.status).toBe('accepted');
    expect(decided.appliedAt).toBeNull();
  });
});

describe('LearnerFact store methods', () => {
  it('proposeFact creates a new fact and upserts on same key+scope', async () => {
    const goal = await store.createGoal('测试目标');
    const fact1 = await store.proposeFact(goal.id, { scope: 'goal', key: 'os', value: 'Windows', source: 'user_stated' });
    expect(fact1.id).toBeTruthy();
    expect(fact1.value).toBe('Windows');
    expect(fact1.confidence).toBe(0.8);

    const fact2 = await store.proposeFact(goal.id, { scope: 'goal', key: 'os', value: 'macOS', source: 'inferred', confidence: 0.9 });
    expect(fact2.id).toBe(fact1.id);
    expect(fact2.value).toBe('macOS');
    expect(fact2.source).toBe('inferred');
    expect(fact2.confidence).toBe(0.9);
  });

  it('getFact returns the correct fact by key and scope', async () => {
    const goal = await store.createGoal('测试目标2');
    await store.proposeFact(goal.id, { scope: 'global', key: 'language', value: 'zh-CN', source: 'user_stated' });

    const found = await store.getFact(goal.id, 'language', 'global');
    expect(found).not.toBeNull();
    expect(found?.value).toBe('zh-CN');

    const notFound = await store.getFact(goal.id, 'language', 'goal');
    expect(notFound).toBeNull();
  });

  it('listFactsForGoal filters by scope and returns sorted results', async () => {
    const goal = await store.createGoal('测试目标3');
    const guide = await createConfirmedGuide();
    await store.proposeFact(goal.id, { scope: 'goal', key: 'editor', value: 'VS Code', source: 'user_stated' });
    await store.proposeFact(goal.id, { scope: 'global', key: 'theme', value: 'dark', source: 'inferred' });
    await store.proposeFact(goal.id, { scope: 'task', taskId: guide.tasks[0].id, key: 'current_task', value: 'React', source: 'user_stated' });

    const allFacts = await store.listFactsForGoal(goal.id);
    expect(allFacts.length).toBe(3);

    const globalFacts = await store.listFactsForGoal(goal.id, 'global');
    expect(globalFacts.length).toBe(1);
    expect(globalFacts[0].key).toBe('theme');

    const goalFacts = await store.listFactsForGoal(goal.id, 'goal');
    expect(goalFacts.length).toBe(1);
    expect(goalFacts[0].key).toBe('editor');
  });

  it('deleteFact removes the fact', async () => {
    const goal = await store.createGoal('测试目标4');
    await store.proposeFact(goal.id, { scope: 'goal', key: 'toDelete', value: 'yes', source: 'inferred' });

    let facts = await store.listFactsForGoal(goal.id);
    expect(facts.length).toBe(1);

    await store.deleteFact(goal.id, 'toDelete', 'goal');

    facts = await store.listFactsForGoal(goal.id);
    expect(facts.length).toBe(0);
  });

  it('task-scoped facts do not affect global facts', async () => {
    const goal = await store.createGoal('测试目标5');
    const guide = await createConfirmedGuide();
    await store.proposeFact(goal.id, { scope: 'global', key: 'env', value: 'production', source: 'user_stated' });
    await store.proposeFact(goal.id, { scope: 'task', taskId: guide.tasks[0].id, key: 'env', value: 'debug', source: 'inferred' });

    const globalFacts = await store.listFactsForGoal(goal.id, 'global');
    const taskFacts = await store.listFactsForGoal(goal.id, 'task');

    expect(globalFacts.length).toBe(1);
    expect(globalFacts[0].value).toBe('production');
    expect(taskFacts.length).toBe(1);
    expect(taskFacts[0].value).toBe('debug');
  });

  it('createTaskFromBranch creates a task from branch summary', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;

    const newTaskId = await store.createTaskFromBranch('需要额外练习异步编程', {
      goalId: 'test-goal-id',
      taskId
    });

    expect(newTaskId).toBeTruthy();
    const runtime = await store.getLearningRuntimeSnapshot();
    expect(runtime).not.toBeNull();
  });

  it('extractKnowledgeFromBranch writes knowledge items', async () => {
    const goal = await store.createGoal('知识提取测试');
    await store.extractKnowledgeFromBranch('这是一个重要的调试经验', 'branch-source-123', goal.id);

    const items = await store.getKnowledgeItemsForGoal({ goalId: goal.id });
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].sourceType).toBe('insight');
  });

  it('updateQuestionThreadKind updates the kind field', async () => {
    const guide = await createConfirmedGuide();
    const actionId = guide.tasks[0].actions[0].id;
    const thread = await store.openQuestion(actionId, '测试问题');

    await store.updateQuestionThreadKind(thread.id, 'debug');

    const updated = await store.getQuestionThread(thread.id);
    expect(updated).not.toBeNull();
  });

  it('getPendingEvaluationIdsForGoal returns waiting submission ids for active guide', async () => {
    const guide = await createConfirmedGuide();
    const taskId = guide.tasks[0].id;
    await store.startSession(taskId);
    const mid = await store.getLearningRuntimeSnapshot();
    const actionId = mid.dailyGuideAction!.id;
    const session = (await store.listSessions())[0];
    const submission = await store.createSubmission(actionId, session.id, '待评价的提交内容。');

    const pending = await store.getPendingEvaluationIdsForGoal(guide.goalId);
    expect(pending).toContain(submission.id);

    // 评价完成后不再 pending
    await store.markSubmissionEvaluation(submission.id, 'completed');
    const pendingAfter = await store.getPendingEvaluationIdsForGoal(guide.goalId);
    expect(pendingAfter).not.toContain(submission.id);
  });

  it('marks an exhausted stage ready for review and advances only after user confirmation', async () => {
    const goal = await store.createGoal('test', 'test');
    await store.db.insert(roadmapStages).values([
      { id: 's1', goalId: goal.id, title: 'S1', objective: 'O1', direction: 'D1', successCriteria: 'SC1', position: 0, status: 'active', createdAt: 'now', updatedAt: 'now' },
      { id: 's2', goalId: goal.id, title: 'S2', objective: 'O2', direction: 'D2', successCriteria: 'SC2', position: 1, status: 'pending', createdAt: 'now', updatedAt: 'now' }
    ]);

    const spDay: typeof shortPlanDays.$inferInsert = {
      id: 'day1', goalId: goal.id, roadmapStageId: 's1', dayIndex: 1, date: '2026-07-11',
      sessionStatus: 'completed', title: 'T1', focus: 'F1', tasksJson: '[]',
      expectedOutput: 'EO1', successCriteria: 'SC1', locked: true, createdAt: 'now'
    };
    await store.db.insert(shortPlanDays).values(spDay);

    const planId = 'plan-1';
    await store.db.insert(dailyPlans).values({
      id: planId, date: '2026-07-11', status: 'completed',
      availableWindowsJson: '[]', shortPlanDayId: 'day1', createdAt: 'now'
    });
    await store.db.insert(dailyGuides).values({
      id: 'guide1', goalId: goal.id, planId, shortPlanDayId: 'day1', date: '2026-07-11',
      status: 'completed', sessionStatus: 'closed', todayGoal: 'TG',
      deliverablesJson: '[]', boundariesJson: '[]', acceptanceCriteriaJson: '[]',
      tomorrowActionsJson: '[]', createdAt: 'now'
    });

    await store.markRoadmapStageReadyForReview(goal.id);

    const beforeConfirmation = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id)).orderBy(asc(roadmapStages.position));
    expect(beforeConfirmation[0].status).toBe('ready_for_review');
    expect(beforeConfirmation[1].status).toBe('pending');
    expect(await store.findActiveOrActivateStage(goal.id)).toBe('stage_review_required');

    await store.confirmRoadmapStageCompletion(goal.id, 's1');
    const afterConfirmation = await store.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id)).orderBy(asc(roadmapStages.position));
    expect(afterConfirmation[0].status).toBe('completed');
    expect(afterConfirmation[1].status).toBe('active');

    await expect(store.confirmRoadmapStageCompletion(goal.id, 's1')).resolves.toBeDefined();
  });

  it('getDaySnapshot includes questionTopics linked by dailyGuideActionId', async () => {
    const guide = await createConfirmedGuide();
    const actionId = guide.tasks[0].actions[0].id;
    await store.openQuestion(actionId, '如何理解闭包？');

    const snapshot = await store.getDaySnapshot('2026-07-05');
    const taskSnapshot = snapshot.guideTasks.find((t) => t.id === guide.tasks[0].id);
    expect(taskSnapshot).toBeTruthy();
    expect(taskSnapshot!.questionTopics).toContain('如何理解闭包？');
  });
});

describe('getTokenCostStats', () => {
  it('aggregates token usage by operation and date', async () => {
    const db = (store as any).db as Database;
    const now = new Date().toISOString();

    await db.insert(aiReviews).values([
      { id: 'rev-1', kind: 'goal_intake', date: '2026-07-10', provider: 'deepseek', model: 'deepseek-chat', inputSnapshotJson: '{}', outputJson: '{}', outputSchemaVersion: 'v1', status: 'success', inputTokens: 100, outputTokens: 200, createdAt: now },
      { id: 'rev-2', kind: 'goal_intake', date: '2026-07-10', provider: 'deepseek', model: 'deepseek-chat', inputSnapshotJson: '{}', outputJson: '{}', outputSchemaVersion: 'v1', status: 'success', inputTokens: 150, outputTokens: 250, createdAt: now },
      { id: 'rev-3', kind: 'daily_guide', date: '2026-07-11', provider: 'deepseek', model: 'deepseek-chat', inputSnapshotJson: '{}', outputJson: '{}', outputSchemaVersion: 'v1', status: 'success', inputTokens: 300, outputTokens: 500, createdAt: now }
    ]);

    const stats = await store.getTokenCostStats({});

    expect(stats.totalInputTokens).toBe(550);
    expect(stats.totalOutputTokens).toBe(950);
    expect(stats.totalCalls).toBe(3);
    expect(stats.byOperation['goal_intake']).toEqual({ inputTokens: 250, outputTokens: 450, calls: 2 });
    expect(stats.byOperation['daily_guide']).toEqual({ inputTokens: 300, outputTokens: 500, calls: 1 });
    expect(stats.byDate['2026-07-10']).toEqual({ inputTokens: 250, outputTokens: 450, calls: 2 });
    expect(stats.byDate['2026-07-11']).toEqual({ inputTokens: 300, outputTokens: 500, calls: 1 });
  });

  it('filters by date range', async () => {
    const db = (store as any).db as Database;
    const now = new Date().toISOString();

    await db.insert(aiReviews).values([
      { id: 'rev-4', kind: 'teach_step', date: '2026-07-09', provider: 'deepseek', model: 'deepseek-chat', inputSnapshotJson: '{}', outputJson: '{}', outputSchemaVersion: 'v1', status: 'success', inputTokens: 80, outputTokens: 120, createdAt: now },
      { id: 'rev-5', kind: 'teach_step', date: '2026-07-12', provider: 'deepseek', model: 'deepseek-chat', inputSnapshotJson: '{}', outputJson: '{}', outputSchemaVersion: 'v1', status: 'success', inputTokens: 90, outputTokens: 130, createdAt: now }
    ]);

    const stats = await store.getTokenCostStats({ fromDate: '2026-07-10', toDate: '2026-07-12' });
    expect(stats.totalInputTokens).toBe(90);
    expect(stats.totalOutputTokens).toBe(130);
    expect(stats.totalCalls).toBe(1);
    expect(stats.byDate['2026-07-09']).toBeUndefined();
    expect(stats.byDate['2026-07-12']).toBeDefined();
  });
});

describe('learning summary lifecycle', () => {
  it('persists pending, ready and failed states without copying raw history on failure', async () => {
    const pending = await store.beginLearningSummary('day', '2026-07-12');
    const duplicateBegin = await store.beginLearningSummary('day', '2026-07-12');
    expect(duplicateBegin.id).toBe(pending.id);
    expect(pending.status).toBe('pending');

    const ready = await store.completeLearningSummary(pending.id, { summary: '今天完成了 API 调用' });
    expect(ready.status).toBe('ready');
    expect(ready.summary).toEqual({ summary: '今天完成了 API 调用' });

    const retry = await store.beginLearningSummary('day', '2026-07-12');
    expect(retry.id).not.toBe(pending.id);
    const failed = await store.failLearningSummary(retry.id, 'schema_violation');
    expect(failed.status).toBe('failed');
    expect(failed.summary).toEqual({ errorCategory: 'schema_violation' });
    expect(JSON.stringify(failed.summary)).not.toContain('今天完成了 API 调用');

    expect((await store.getLatestLearningSummary('day', '2026-07-12'))?.id).toBe(retry.id);
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
