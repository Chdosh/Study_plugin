import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database, type DatabaseClient } from '../db/client';
import {
  aiReviews,
  currentLearningContext,
  focusSessions,
  goals,
  learningActions,
  learningEvaluations,
  learningGuides,
  knowledgeItemEvidence,
  knowledgeItems,
  nearTermPlanItems,
  roadmapStages,
  learningTasks
} from '../db/schema';
import { StudyStore } from './store';

const testDirs: string[] = [];

describe('StudyStore V2 business ownership', () => {
  let db: Database;
  let client: DatabaseClient;
  let store: StudyStore;

  beforeEach(async () => {
    const path = mkdtempSync(join(tmpdir(), 'study-store-v2-'));
    testDirs.push(path);
    const created = await createDatabase(path);
    db = created.db;
    client = created.client;
    store = new StudyStore(db);
    await store.seedDefaults();
  });

  afterEach(async () => {
    client.close();
    for (const path of testDirs.splice(0)) {
      await removeTempDir(path);
    }
  });

  it('keeps Focus Session and Task lifecycle independent', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const taskId = guide.tasks[0].id;

    const session = await store.startSession(taskId);
    const taskDuringSession = (await db.select().from(learningTasks)
      .where(eq(learningTasks.id, taskId)))[0];
    expect(taskDuringSession.status).toBe('active');

    await store.completeSession(session.id, '本次先到这里');
    const taskAfterSession = (await db.select().from(learningTasks)
      .where(eq(learningTasks.id, taskId)))[0];
    const sessionAfter = (await db.select().from(focusSessions)
      .where(eq(focusSessions.id, session.id)))[0];
    expect(taskAfterSession.status).toBe('active');
    expect(sessionAfter.status).toBe('ended');
  });

  it('keeps Task closure idempotent without allowing a different result to overwrite it', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const first = guide.tasks[0];
    const second = guide.tasks[1];

    await store.closeTask(first.id, 'partial', '本轮先完成核心部分', '从练习继续');
    await expect(
      store.closeTask(first.id, 'partial', '本轮先完成核心部分', '从练习继续')
    ).resolves.toBeUndefined();
    await expect(
      store.closeTask(first.id, 'completed', '后来改变了判断')
    ).rejects.toThrow('不能覆盖');

    const firstAfter = (await db.select().from(learningTasks)
      .where(eq(learningTasks.id, first.id)))[0];
    const runtime = await store.getLearningRuntimeSnapshot();
    expect(firstAfter.closureKind).toBe('partial');
    expect(firstAfter.closureReason).toBe('本轮先完成核心部分');
    expect(runtime.dailyGuideTask?.id).toBe(second.id);
  });

  it('marks the Roadmap Stage ready for review when its final Guide is closed', async () => {
    const { guide, roadmap } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);

    for (const task of guide.tasks) {
      await store.closeTask(task.id, 'completed');
    }

    const storedGuide = (await db.select().from(learningGuides)
      .where(eq(learningGuides.id, guide.id)))[0];
    const storedPlanItem = (await db.select().from(nearTermPlanItems)
      .where(eq(nearTermPlanItems.id, guide.nearTermPlanItemId!)))[0];
    const storedStage = (await db.select().from(roadmapStages)
      .where(eq(roadmapStages.id, roadmap[0].id)))[0];

    expect(storedGuide.status).toBe('closed');
    expect(storedPlanItem.status).toBe('completed');
    expect(storedStage.status).toBe('ready_for_review');
  });

  it('enforces one unfinished Focus Session globally', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const first = guide.tasks[0];
    const second = guide.tasks[1];
    await store.startSession(first.id);

    await expect(store.startSession(second.id)).rejects.toThrow('已有未结束');
  });

  it('keeps plan items and guides independent from calendar dates', async () => {
    await createLearningUnit(store);

    const planItems = await db.select().from(nearTermPlanItems);
    const guides = await db.select().from(learningGuides);
    expect(planItems).not.toHaveLength(0);
    expect(guides).not.toHaveLength(0);
    expect(planItems.every((item) => item.suggestedDate === null)).toBe(true);
    expect(guides.every((guide) => guide.suggestedDate === null)).toBe(true);
  });

  it('stores evaluation and recommendation without mutating Task or Action', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const task = guide.tasks[0];
    const action = task.actions[0];
    const session = await store.startSession(task.id);
    const submission = await store.createSubmission({
      taskId: task.id,
      stepId: action.id,
      sessionId: session.id,
      content: '这是我的显式成果'
    });
    expect(submission.stepId).toBe(action.id);
    expect(submission.dailyGuideActionId).toBe(action.id);
    expect(submission.applicationStatus).toBeNull();

    const result = await store.saveEvaluationAndDecision({
      submission,
      evaluationOutput: {
        result: 'passed',
        evidence: ['能说明基本概念'],
        correctParts: ['概念正确'],
        misconceptions: ['边界条件不清楚'],
        missingRequirements: ['补充失败路径'],
        feedback: '需要补充失败路径',
        recommendedAction: 'complete_task'
      },
      direction: 'advance',
      decisionOutput: {
        decision: 'complete_task',
        reason: '成果已经达到当前 Task 目标',
        taskCompleted: true,
        nextStep: null,
        remediation: null,
        carryForward: '用户尚未覆盖失败路径'
      }
    });

    const taskAfter = (await db.select().from(learningTasks)
      .where(eq(learningTasks.id, task.id)))[0];
    const evaluation = (await db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.id, result.evaluation.id)))[0];
    expect(taskAfter.status).toBe('active');
    expect(taskAfter.closureKind).toBeNull();
    expect(evaluation.selfNote).toBe('用户尚未覆盖失败路径');
    expect(evaluation.recommendationDecision).toBeNull();
    expect(evaluation.applicationStatus).toBeNull();

    await store.recordEvaluationCorrection(
      result.evaluation.id,
      '评价忽略了我提交中的失败路径测试'
    );
    const correctionRows = await db.select().from(learningEvaluations)
      .where(eq(learningEvaluations.supersedesEvaluationId, result.evaluation.id));
    const correctionKnowledge = await db.select().from(knowledgeItems)
      .where(eq(knowledgeItems.goalId, guide.goalId));
    expect(correctionRows).toHaveLength(1);
    expect(correctionRows[0].source).toBe('user_correction');
    expect(correctionKnowledge.some((item) => item.sourceType === 'correction')).toBe(true);
    expect(evaluation.applicationStatus).toBeNull();
  });

  it('derives qualitative mastery from durable evidence without a mastery table', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const task = guide.tasks[0];
    const firstSubmission = await store.createSubmission({ taskId: task.id, content: '第一份独立成果' });
    const first = await store.saveEvaluationAndDecision({
      submission: firstSubmission,
      evaluationOutput: {
        result: 'passed',
        evidence: ['独立完成'],
        correctParts: ['能够应用泛型约束'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '通过',
        recommendedAction: 'advance'
      },
      direction: 'advance',
      decisionOutput: {
        decision: 'advance',
        reason: '继续',
        taskCompleted: false,
        nextStep: null,
        remediation: null,
        carryForward: ''
      }
    });
    await store.recordKnowledgeItems({
      goalId: guide.goalId,
      items: [{
        key: '泛型约束应用',
        summary: '能够应用泛型约束',
        sourceType: 'insight',
        sourceId: 'positive-1',
        evidence: {
          submissionId: firstSubmission.id,
          evaluationId: first.evaluation.id,
          taskId: task.id
        }
      }]
    });
    let items = await store.getKnowledgeItemsForGoal({ goalId: guide.goalId });
    expect(items[0].masteryState).toBe('can_apply');

    const secondSubmission = await store.createSubmission({ taskId: task.id, content: '第二份独立成果' });
    const second = await store.saveEvaluationAndDecision({
      submission: secondSubmission,
      evaluationOutput: {
        result: 'passed',
        evidence: ['再次独立完成'],
        correctParts: ['能够应用泛型约束'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '再次通过',
        recommendedAction: 'advance'
      },
      direction: 'advance',
      decisionOutput: {
        decision: 'advance',
        reason: '继续',
        taskCompleted: false,
        nextStep: null,
        remediation: null,
        carryForward: ''
      }
    });
    await store.recordKnowledgeItems({
      goalId: guide.goalId,
      items: [{
        key: '泛型约束应用',
        summary: '能够应用泛型约束',
        sourceType: 'insight',
        sourceId: 'positive-2',
        evidence: {
          submissionId: secondSubmission.id,
          evaluationId: second.evaluation.id,
          taskId: task.id
        }
      }]
    });
    const evidenceRows = await db.select().from(knowledgeItemEvidence);
    await db.update(knowledgeItemEvidence).set({
      createdAt: '2026-07-20T00:00:00.000Z'
    }).where(eq(knowledgeItemEvidence.id, evidenceRows[0].id));
    await db.update(knowledgeItemEvidence).set({
      createdAt: '2026-07-22T00:00:00.000Z'
    }).where(eq(knowledgeItemEvidence.id, evidenceRows[1].id));

    items = await store.getKnowledgeItemsForGoal({ goalId: guide.goalId });
    expect(items[0].masteryState).toBe('stable');
    expect(items[0].masteryLabel).toBe('较稳定');
  });

  it('uses current_learning_context only as a navigation pointer', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const context = (await db.select().from(currentLearningContext)
      .where(eq(currentLearningContext.id, 'default')))[0];
    expect(context.guideId).toBe(guide.id);
    expect(context.taskId).toBe(guide.tasks[0].id);
    expect(Object.keys(context).sort()).toEqual([
      'actionId',
      'goalId',
      'guideId',
      'id',
      'taskId',
      'updatedAt',
      'version'
    ]);
  });

  it('does not restore an archived Goal and Guide from a stale current_learning_context pointer', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);

    await db.update(learningGuides).set({ status: 'archived' })
      .where(eq(learningGuides.id, guide.id));
    await db.update(goals).set({ status: 'archived' })
      .where(eq(goals.id, guide.goalId));

    const snapshot = await store.getLearningRuntimeSnapshot();
    const archivedGuide = await store.getDailyGuideById(guide.id);
    const context = (await db.select().from(currentLearningContext)
      .where(eq(currentLearningContext.id, 'default')))[0];

    expect(archivedGuide?.sessionStatus).toBe('archived');
    expect(snapshot.goal).toBeNull();
    expect(snapshot.dailyGuide).toBeNull();
    expect(snapshot.dailyGuideTask).toBeNull();
    expect(snapshot.dailyGuideAction).toBeNull();
    expect(context.goalId).toBeNull();
    expect(context.guideId).toBeNull();
    expect(context.taskId).toBeNull();
    expect(context.actionId).toBeNull();
  });

  it('lists and restores an archived Guide with open Tasks without reopening closed history', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const firstTask = guide.tasks[0];
    const nextTask = guide.tasks[1];
    await store.closeTask(firstTask.id, 'partial', '先完成基础部分', '继续练习');
    await store.archiveActiveGoalsAndRestart();

    const resumable = await store.listResumableGuides();
    expect(resumable).toEqual([expect.objectContaining({
      guideId: guide.id,
      taskTitle: nextTask.title,
      completedTaskCount: 0,
      totalTaskCount: 2
    })]);

    const restored = await store.restoreArchivedGuide(guide.id);
    expect(restored.dailyGuideTask?.id).toBe(nextTask.id);
    expect(restored.dailyGuideAction?.id).toBe(nextTask.actions[0].id);
    await expect(store.restoreArchivedGuide(guide.id)).resolves.toMatchObject({
      dailyGuideTask: { id: nextTask.id }
    });

    const storedGoal = (await db.select().from(goals).where(eq(goals.id, guide.goalId)))[0];
    const storedGuide = (await db.select().from(learningGuides).where(eq(learningGuides.id, guide.id)))[0];
    const storedFirstTask = (await db.select().from(learningTasks).where(eq(learningTasks.id, firstTask.id)))[0];
    expect(storedGoal.status).toBe('active');
    expect(storedGuide.status).toBe('active');
    expect(storedFirstTask.status).toBe('closed');
    expect(storedFirstTask.closureKind).toBe('partial');
  });

  it('does not list or restore a fully closed archived Guide', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    await store.closeTask(guide.tasks[0].id, 'completed');
    await store.closeTask(guide.tasks[1].id, 'completed');
    await store.archiveActiveGoalsAndRestart();

    expect(await store.listResumableGuides()).toEqual([]);
    await expect(store.restoreArchivedGuide(guide.id)).rejects.toThrow('全部收口');
  });

  it('rejects restoring an archived Guide while a Session is unfinished', async () => {
    const { goal, guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    const session = await store.startSession(guide.tasks[0].id);
    await db.update(learningGuides).set({ status: 'archived' }).where(eq(learningGuides.id, guide.id));
    await db.update(goals).set({ status: 'archived' }).where(eq(goals.id, goal.id));

    await expect(store.restoreArchivedGuide(guide.id)).rejects.toThrow('未结束的 Session');
    await store.completeSession(session.id);
  });

  it('derives provider health from any configured external AI service', async () => {
    await store.saveAiReview({
      kind: 'provider_check',
      provider: 'configured_ai',
      model: 'custom-model',
      inputSnapshot: {},
      output: { ok: true },
      outputSchemaVersion: 'provider-check.v1',
      status: 'completed',
      recordType: 'run'
    });
    await store.saveAiReview({
      kind: 'ask_user',
      provider: 'local',
      model: 'local',
      inputSnapshot: {},
      output: {},
      outputSchemaVersion: 'ask-user.v1',
      status: 'completed',
      recordType: 'run'
    });

    await expect(store.getLatestAiProviderDiagnostic()).resolves.toMatchObject({
      status: 'completed',
      model: 'custom-model'
    });
  });

  it('inserts an idempotent optional supplement into the current Guide and returns to the original Action', async () => {
    const { guide } = await createLearningUnit(store);
    await store.confirmLearningGuide(guide.id);
    await store.startSession(guide.tasks[0].id);
    const before = await store.getCurrentLearningContext();
    const originalActionId = before.actionId!;
    const reviewId = await store.saveAiReview({
      kind: 'tool_call',
      provider: 'test',
      model: 'test',
      inputSnapshot: {},
      output: {},
      outputSchemaVersion: 'supplement.v1',
      status: 'running',
      recordType: 'tool_call',
      toolName: 'insert_guide_supplement'
    });

    await expect(store.insertGuideSupplement({
      title: '过期补充',
      instruction: '不应写入',
      checkpoint: '不应写入',
      sourceAiReviewId: reviewId,
      expectedContextVersion: before.version + 1
    })).rejects.toThrow('上下文已经变化');

    const inserted = await store.insertGuideSupplement({
      title: '补充一个闭包示例',
      instruction: '先运行最小计数器示例',
      checkpoint: '能说明状态为何被保留',
      sourceAiReviewId: reviewId,
      expectedContextVersion: before.version
    });
    const duplicate = await store.insertGuideSupplement({
      title: '不应重复写入',
      instruction: '不应重复写入',
      checkpoint: '不应重复写入',
      sourceAiReviewId: reviewId,
      expectedContextVersion: before.version
    });
    const afterInsert = await store.getCurrentLearningContext();
    const actions = await db.select().from(learningActions)
      .where(eq(learningActions.taskId, guide.tasks[0].id))
      .orderBy(learningActions.position);

    expect(duplicate.id).toBe(inserted.id);
    expect(afterInsert.actionId).toBe(inserted.id);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      id: inserted.id,
      requirement: 'optional',
      origin: 'agent_supplement',
      sourceAiReviewId: reviewId
    });
    expect(actions[1].id).toBe(originalActionId);
    expect((await db.select().from(aiReviews).where(eq(aiReviews.id, reviewId)))[0]).toBeTruthy();

    const afterCompletion = await store.completeCurrentAction(inserted.id);
    expect(afterCompletion.dailyGuideAction?.id).toBe(originalActionId);
    const afterRepeatedCompletion = await store.completeCurrentAction(inserted.id);
    expect(afterRepeatedCompletion.dailyGuideAction?.id).toBe(originalActionId);
    expect((await db.select().from(learningActions)
      .where(eq(learningActions.id, originalActionId)))[0].status).toBe('planned');
  });

  it('falls back only to a uniquely recoverable level', async () => {
    await store.createGoal('第一个目标');
    await store.createGoal('第二个目标');
    await db.update(currentLearningContext).set({
      goalId: null,
      guideId: null,
      taskId: null,
      actionId: null
    }).where(eq(currentLearningContext.id, 'default'));

    const resolved = await store.getCurrentLearningContext();
    expect(resolved.goalId).toBeNull();
    expect(resolved.activeGuideId).toBeNull();
    expect(resolved.displayGuideId).toBeNull();
    expect(resolved.taskId).toBeNull();
    expect(resolved.actionId).toBeNull();
  });

  it('completes the Goal when the user confirms the final Roadmap Stage', async () => {
    const { goal, roadmap } = await createLearningUnit(store);
    await db.update(roadmapStages).set({ status: 'ready_for_review' })
      .where(eq(roadmapStages.id, roadmap[0].id));

    await store.confirmRoadmapStageCompletion(goal.id, roadmap[0].id);

    const storedGoal = (await db.select().from(goals).where(eq(goals.id, goal.id)))[0];
    const storedStage = (await db.select().from(roadmapStages)
      .where(eq(roadmapStages.id, roadmap[0].id)))[0];
    expect(storedStage.status).toBe('completed');
    expect(storedGoal.status).toBe('done');
  });

  it('Goal 无截止日期时，保存阶段日期会被归一为 null 而不是拒绝保存', async () => {
    const goal = await store.createGoal('掌握闭包');
    const brief = {
      title: '掌握闭包',
      targetOutcome: '能够解释并使用闭包',
      currentLevel: '基础',
      availableTime: '每天一小时',
      deadline: '未明确',
      depth: '',
      direction: '',
      constraints: [],
      successCriteria: ['能独立完成练习']
    };
    const result = await store.saveLayeredPlan({
      goal,
      brief,
      date: '2026-07-23',
      windows: [{ start: '20:00', end: '21:00' }],
      roadmap: {
        goalSummary: '掌握闭包',
        stages: [{
          title: '理解基础',
          objective: '理解词法作用域',
          direction: '从概念到实践',
          successCriteria: '能解释闭包',
          targetDate: '2026-08-01'
        }]
      },
      shortPlan: {
        weekFocus: '闭包',
        items: [{
          itemIndex: 1,
          roadmapStagePosition: 1,
          title: '闭包入门',
          focus: '词法作用域',
          tasks: ['解释闭包'],
          expectedOutput: '一段解释',
          successCriteria: '解释准确'
        }]
      },
      dailyGuide: {
        date: '2026-07-23',
        todayGoal: '理解闭包',
        deliverables: ['解释与示例'],
        boundaries: ['不涉及高级模式'],
        acceptanceCriteria: ['解释准确'],
        tomorrowActions: [],
        tasks: [{
          title: '理解闭包',
          objective: '理解词法作用域',
          scope: '概念',
          estimatedMinutes: { min: 30, target: 45, max: 60 },
          deliverable: '一段解释',
          doneWhen: ['解释准确'],
          quickHint: '从定义开始',
          evaluationMode: 'ai',
          actions: [{ title: '阅读概念', instruction: '通读定义', checkpoint: '能复述' }]
        }]
      }
    });
    expect(result.roadmap[0].targetDate).toBeNull();
    const storedStage = (await db.select().from(roadmapStages)
      .where(eq(roadmapStages.goalId, goal.id)))[0];
    expect(storedStage.targetDate).toBeNull();
  });
});

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function createLearningUnit(store: StudyStore) {
  const goal = await store.createGoal('掌握闭包');
  const brief = {
    title: '掌握闭包',
    targetOutcome: '能够解释并使用闭包',
    currentLevel: '基础',
    availableTime: '每天一小时',
    deadline: '',
    depth: '',
    direction: '',
    constraints: [],
    successCriteria: ['能独立完成练习']
  };
  return store.saveLayeredPlan({
    goal,
    brief,
    date: '2026-07-23',
    windows: [{ start: '20:00', end: '21:00' }],
    roadmap: {
      goalSummary: '掌握闭包',
      stages: [{
        title: '理解基础',
        objective: '理解词法作用域',
        direction: '从概念到实践',
        successCriteria: '能解释闭包',
        targetDate: null
      }]
    },
    shortPlan: {
      weekFocus: '闭包',
      items: [{
        itemIndex: 1,
        roadmapStagePosition: 1,
        title: '闭包入门',
        focus: '词法作用域',
        tasks: ['解释闭包'],
        expectedOutput: '一段解释',
        successCriteria: '解释准确'
      }]
    },
    dailyGuide: {
      date: '2026-07-23',
      todayGoal: '理解闭包',
      deliverables: ['解释与示例'],
      boundaries: ['不扩展到性能优化'],
      acceptanceCriteria: ['解释作用域保持'],
      tomorrowActions: ['继续练习'],
      tasks: [
        {
          title: '解释闭包',
          objective: '解释闭包机制',
          scope: 'JavaScript 基础',
          estimatedMinutes: { min: 10, target: 20, max: 30 },
          actions: [{
            title: '写出解释',
            instruction: '用自己的话解释',
            checkpoint: '包含词法作用域'
          }],
          deliverable: '闭包解释',
          doneWhen: ['包含例子'],
          quickHint: '关注函数与外部变量',
          evaluationMode: 'ai'
        },
        {
          title: '闭包练习',
          objective: '编写闭包',
          scope: 'JavaScript 基础',
          estimatedMinutes: { min: 10, target: 20, max: 30 },
          actions: [{
            title: '完成练习',
            instruction: '实现计数器',
            checkpoint: '状态被正确保留'
          }],
          deliverable: '计数器代码',
          doneWhen: ['连续调用结果递增'],
          quickHint: '返回内部函数',
          evaluationMode: 'ai'
        }
      ]
    }
  });
}
