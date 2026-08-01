import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database, type DatabaseClient } from '../db/client';
import { currentLearningContext, focusSessions, goals, learningGuides, learningSubmissions, learningTasks } from '../db/schema';
import { AppService } from './app-service';
import type { SettingsService } from './settings-service';
import { StudyStore } from './store';
import type { LearningSubmission } from '../../shared/types';

type AiReply = Record<string, unknown>;
type QueuedAiResponse =
  | { kind: 'json'; body: AiReply; responseField: 'content' | 'reasoning_content'; delayMs?: number }
  | { kind: 'http_error'; status: number; message: string };

describe('学习闭环端到端', () => {
  const fixtures: LearningFlowFixture[] = [];

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await fixture.destroy();
    }
  });

  it('1. 创建 Goal → 生成路径 → 打开学习页', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);

    const plan = await fixture.createGoalAndPlan();
    const learning = await fixture.app.getLearningState();
    const overview = await fixture.app.getOverview();
    const settings = await fixture.app.getSettings();

    expect(plan.goal.title).toBe('掌握 TypeScript');
    expect(plan.goal.dueDate).not.toBeNull();
    expect(plan.roadmap.map((stage) => stage.title)).toEqual(['打好基础', '完成项目']);
    expect(plan.roadmap.map((stage) => stage.targetDate)).toEqual([
      '2026-08-15',
      '2026-09-24'
    ]);
    expect(plan.shortPlan.every((item) => item.date === null)).toBe(true);
    expect(overview.goalProgress.status).toBe('on_schedule');
    expect(overview.preparationState).toBe('active');
    expect(settings.aiProviderStatus?.state).toBe('available');
    expect(learning.goal?.id).toBe(plan.goal.id);
    expect(learning.dailyGuide?.id).toBe(plan.guide.id);
    expect(learning.dailyGuideTask?.title).toBe('实现第一个功能');
    expect(learning.dailyGuideAction?.title).toBe('阅读需求');
  });

  it('2. ask_user 暂停 → 回答后继续', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueue(needMoreInfoReply(), readyGoalReply());

    const waiting = await fixture.app.sendOnboardingMessage('我想学习 TypeScript。');
    expect(waiting.intake.status).toBe('collecting');
    expect(waiting.pendingInteraction?.status).toBe('open');
    expect(waiting.pendingInteraction?.intent).toBe('continue_goal_intake');

    const resumed = await fixture.app.sendOnboardingMessage('我每天可以学习两小时，目标是完成项目。');
    expect(resumed.intake.status).toBe('ready');
    expect(resumed.pendingInteraction).toBeNull();

    fixture.enqueuePlan();
    const overview = await fixture.app.generateInitialLearningPlan();
    const learning = await fixture.app.getLearningState();
    expect(learning.goal?.id).toBe(overview.goal?.id);
    expect(learning.dailyGuideTask?.title).toBe('实现第一个功能');
    expect(overview.guide?.status).toBe('confirmed');
  });

  it('运行中的目标访谈不会把重复点击写成新的用户消息', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const before = await fixture.app.getCurrentOnboarding();
    await fixture.store.saveAiReview({
      kind: 'goal_intake',
      provider: 'configured_ai',
      model: 'deterministic-e2e-model',
      inputSnapshot: {},
      output: { phase: 'selecting_tool' },
      outputSchemaVersion: 'goal-intake.v1',
      status: 'running',
      recordType: 'run',
      conversationScope: 'goal_intake',
      conversationRefId: before.intake.id,
      startedAt: '2026-07-28T08:26:55.000Z'
    });

    await expect(
      fixture.app.sendOnboardingMessage('请使用当前信息生成初步计划。')
    ).rejects.toThrow('已有 AI 操作正在执行');

    const after = await fixture.app.getCurrentOnboarding();
    expect(after.messages).toEqual(before.messages);
  });

  it('目标访谈失败后重试同一句输入，不会重复保存用户原话', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueueHttpError(503, 'provider unavailable');
    fixture.ai.enqueueHttpError(503, 'provider unavailable');
    fixture.ai.enqueueHttpError(503, 'provider unavailable');

    await expect(
      fixture.app.sendOnboardingMessage('我想一天掌握 Git 核心操作。')
    ).rejects.toThrow('provider unavailable');
    fixture.ai.enqueue(readyGoalReply());
    await expect(
      fixture.app.sendOnboardingMessage('我想一天掌握 Git 核心操作。')
    ).resolves.toMatchObject({ intake: { status: 'ready' } });

    const current = await fixture.app.getCurrentOnboarding();
    expect(current.messages.filter((message) =>
      message.role === 'user' && message.content === '我想一天掌握 Git 核心操作。'
    )).toHaveLength(1);
  });

  it('首次计划生成失败后复用同一个正式 Goal 重试，不重新进入访谈', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueue(readyGoalReply());
    const ready = await fixture.app.sendOnboardingMessage('我想一天掌握 Git 核心操作。');
    expect(ready.intake.status).toBe('ready');

    fixture.ai.enqueueHttpError(503, 'provider unavailable');
    fixture.ai.enqueueHttpError(503, 'provider unavailable');
    fixture.ai.enqueueHttpError(503, 'provider unavailable');
    await expect(fixture.app.generateInitialLearningPlan()).rejects.toThrow('provider unavailable');
    const failed = await fixture.app.getCurrentOnboarding();
    expect(failed.intake.status).toBe('confirmed');
    const goalId = failed.intake.goalId;

    fixture.enqueuePlan();
    const recovered = await fixture.app.generateInitialLearningPlan();
    expect(recovered.goal?.id).toBe(goalId);
    expect(recovered.guide?.status).toBe('confirmed');
  });

  it('3. Session 暂停 → 恢复 → 结束', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;

    const started = await fixture.app.startSession(task.id);
    expect(started.status).toBe('active');

    const paused = await fixture.app.pauseSession(started.id);
    expect(paused.id).toBe(started.id);
    expect(paused.status).toBe('paused');

    const resumed = await fixture.app.startSession(task.id);
    expect(resumed.id).toBe(started.id);
    expect(resumed.status).toBe('active');

    const ended = await fixture.app.endSession(resumed.id);
    expect(ended.id).toBe(started.id);
    expect(ended.status).toBe('completed');
    expect(await fixture.app.getActiveSession()).toBeNull();
  });

  it('4. 提交后立即结束 Task 和 Session，评价在后台保存', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ evaluationMode: 'ai' });
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(task.id);
    await completeAllActions(fixture.app);
    fixture.ai.enqueue(passingEvaluationReply());

    const submitted = await fixture.app.submitLearningResult(
      '我已经完成函数实现，并运行类型检查确认没有错误。'
    );
    expect(submitted.submission.stepId).toBeNull();
    expect(submitted.submission.taskId).toBe(task.id);
    expect(submitted.state.dailyGuideTask).toBeNull();
    expect(await fixture.app.getActiveSession()).toBeNull();

    const evaluated = await waitForSubmissionStatus(
      fixture.store,
      submitted.submission.id,
      'completed'
    );
    expect(evaluated.evaluationStatus).toBe('completed');
  });

  it('5. 评价失败不阻塞学习推进，提交仍然保留', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 2, evaluationMode: 'ai' });
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(task.id);
    await completeAllActions(fixture.app);
    fixture.ai.enqueue({}, {});

    const submitted = await fixture.app.submitLearningResult(
      '这是已经持久化的完整实现说明和类型检查结果。'
    );
    const failedSubmission = await waitForSubmissionStatus(
      fixture.store,
      submitted.submission.id,
      'failed'
    );

    expect(failedSubmission.content).toBe('这是已经持久化的完整实现说明和类型检查结果。');
    expect(failedSubmission.evaluationStatus).toBe('failed');
    expect((await fixture.app.getLearningState()).dailyGuideTask?.id).not.toBe(task.id);
    expect(await fixture.app.getActiveSession()).toBeNull();
    expect(await fixture.store.getSubmissionsForTask(task.id)).toHaveLength(1);

    fixture.ai.enqueue(passingEvaluationReply());
    const retried = await fixture.app.retrySubmissionEvaluation(submitted.submission.id);
    expect(retried.evaluationStatus).toBe('completed');
    expect(retried.content).toBe(failedSubmission.content);
    expect((await fixture.app.getLearningState()).dailyGuideTask?.id).not.toBe(task.id);
  });

  it('提交成果立即结束当前 Task 和 Session，AI 评价在后台完成', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 2, evaluationMode: 'ai' });
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    await completeAllActions(fixture.app);
    fixture.ai.enqueueDelayed(600, passingEvaluationReply());

    const pending = fixture.app.submitLearningResult('提交后应立即进入下一任务，评价稍后返回。');
    const returnedImmediately = await Promise.race([
      pending.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150))
    ]);

    expect(returnedImmediately).toBe(true);
    const submitted = await pending;
    const after = await fixture.app.getLearningState();
    expect(after.dailyGuideTask?.id).not.toBe(before.dailyGuideTask?.id);
    expect(await fixture.app.getActiveSession()).toBeNull();
    await waitForSubmissionStatus(fixture.store, submitted.submission.id, 'completed');
  });

  it('7. 应用重启后恢复上次 Goal、Guide、Task、Action 和暂停 Session', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ actionCount: 2 });
    const initial = await fixture.app.getLearningState();
    const session = await fixture.app.startSession(initial.dailyGuideTask!.id);
    await fixture.app.completeCurrentAction(initial.dailyGuideAction!.id);
    const beforeRestart = await fixture.app.getLearningState();
    await fixture.app.pauseSession(session.id);

    await fixture.restart();

    const restored = await fixture.app.getLearningState();
    const restoredSession = await fixture.app.getActiveSession();
    expect(restored.goal?.id).toBe(beforeRestart.goal?.id);
    expect(restored.dailyGuide?.id).toBe(beforeRestart.dailyGuide?.id);
    expect(restored.dailyGuideTask?.id).toBe(beforeRestart.dailyGuideTask?.id);
    expect(restored.dailyGuideAction?.id).toBe(beforeRestart.dailyGuideAction?.id);
    expect(restoredSession?.id).toBe(session.id);
    expect(restoredSession?.status).toBe('paused');
    await fixture.app.endSession(session.id);
  });

  it('startup audit removes archived pointers left by an older runtime state', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const plan = await fixture.createGoalAndPlan();

    await fixture.db.update(learningGuides).set({ status: 'archived' })
      .where(eq(learningGuides.id, plan.guide.id));
    await fixture.db.update(goals).set({ status: 'archived' })
      .where(eq(goals.id, plan.goal.id));

    await fixture.restart();

    const audit = await fixture.app.auditRuntimeConsistency();
    const learning = await fixture.app.getLearningState();
    expect(audit.fixed).toContain('current_learning_context');
    expect(learning.goal).toBeNull();
    expect(learning.dailyGuide).toBeNull();
    expect(learning.dailyGuideTask).toBeNull();
    expect(learning.dailyGuideAction).toBeNull();
  });

  it('reset archives the old workspace atomically and allows a new Session to start', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const oldPlan = await fixture.createGoalAndPlan();
    const oldTask = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(oldTask.id);

    const intake = await fixture.app.resetLearningWorkspace();
    expect(intake.intake.status).toBe('collecting');
    expect(await fixture.app.getActiveSession()).toBeNull();

    const oldGoal = (await fixture.db.select().from(goals)
      .where(eq(goals.id, oldPlan.goal.id)))[0];
    const oldGuide = (await fixture.db.select().from(learningGuides)
      .where(eq(learningGuides.id, oldPlan.guide.id)))[0];
    const context = (await fixture.db.select().from(currentLearningContext)
      .where(eq(currentLearningContext.id, 'default')))[0];
    const unfinishedSessions = await fixture.db.select().from(focusSessions)
      .where(inArray(focusSessions.status, ['active', 'paused']));

    expect(oldGoal.status).toBe('archived');
    expect(oldGuide.status).toBe('archived');
    expect(context.goalId).toBeNull();
    expect(context.guideId).toBeNull();
    expect(context.taskId).toBeNull();
    expect(context.actionId).toBeNull();
    expect(unfinishedSessions).toHaveLength(0);

    fixture.ai.enqueue(readyGoalReply());
    const onboarding = await fixture.app.sendOnboardingMessage('我想开始一个新的学习目标。');
    expect(onboarding.intake.status).toBe('ready');
    fixture.enqueuePlan();
    await fixture.app.generateInitialLearningPlan();
    const newTask = (await fixture.app.getLearningState()).dailyGuideTask!;
    await expect(fixture.app.startSession(newTask.id)).resolves.toMatchObject({
      taskId: newTask.id,
      status: 'active'
    });
  });

  it('历史 Goal 可以查看，并能恢复仍有未完成 Task 的 Guide', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const oldPlan = await fixture.createGoalAndPlan({ actionCount: 2 });
    const oldTask = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.resetLearningWorkspace();

    const history = await fixture.app.exportGoalData(oldPlan.goal.id);
    expect(history.goal).toMatchObject({ id: oldPlan.goal.id, status: 'archived' });
    const resumable = await fixture.app.listResumableGuides();
    expect(resumable).toEqual([expect.objectContaining({ guideId: oldPlan.guide.id })]);

    const restored = await fixture.app.restoreArchivedGuide(oldPlan.guide.id);
    expect(restored.dailyGuide?.id).toBe(oldPlan.guide.id);
    expect(restored.dailyGuideTask?.id).toBe(oldTask.id);
    expect(restored.dailyGuideAction?.id).toBe(oldTask.actions[0].id);
  });

  it('accepts an OpenAI-compatible model that returns JSON in reasoning_content', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueueReasoning(readyGoalReply());

    const onboarding = await fixture.app.sendOnboardingMessage('我想系统学习 TypeScript。');

    expect(onboarding.intake.status).toBe('ready');
    expect(onboarding.intake.brief?.title).toBe('掌握 TypeScript');
  });

  it('repairs a valid Agent envelope whose selected tool input violates the business schema', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueue(
      toolReply('propose_goal', {
        status: 'ready',
        reply: '目标已经整理完成。',
        brief: {
          goal: '系统学习 TypeScript',
          target: '独立完成一个小项目',
          constraints: '每天学习一小时',
          level: '入门'
        }
      }),
      readyGoalReply()
    );

    const onboarding = await fixture.app.sendOnboardingMessage(
      '我想系统学习 TypeScript，目标是独立完成一个小项目。'
    );

    expect(onboarding.intake.status).toBe('ready');
    expect(onboarding.intake.brief?.title).toBe('掌握 TypeScript');
  });

  it('8. 全部 Action 完成后提问 → 回答后仍返回原 Task 的提交阶段', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    const session = await fixture.app.startSession(before.dailyGuideTask!.id);
    await completeAllActions(fixture.app);
    expect((await fixture.app.getLearningState()).dailyGuideAction).toBeNull();
    fixture.ai.enqueue(questionAnswerReply());

    const answer = await fixture.app.askStepQuestion('这里为什么要先定义类型？');
    const returned = await fixture.app.getLearningState();
    expect(answer.thread.status).toBe('resolved');
    expect(answer.thread.taskId).toBe(before.dailyGuideTask!.id);
    expect(answer.thread.stepId).toBeNull();
    expect(answer.resolved).toBe(true);
    expect(returned.questionThread).toBeNull();
    expect(returned.dailyGuideTask?.id).toBe(before.dailyGuideTask?.id);
    expect(returned.dailyGuideAction).toBeNull();
    await fixture.app.endSession(session.id);
  });

  it('9. 开始 Session 后未完成的 Task 可以提交，并且并发点击只创建一次', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 2, actionCount: 2, evaluationMode: 'ai' });
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    fixture.ai.enqueue(passingEvaluationReply());

    const [submitted, duplicate] = await Promise.all([
      fixture.app.submitLearningResult(
        '我已经通过其他方式完成了任务成果，并提供了可验证的运行结果。'
      ),
      fixture.app.submitLearningResult(
        '我已经通过其他方式完成了任务成果，并提供了可验证的运行结果。'
      )
    ]);

    expect(duplicate.submission.id).toBe(submitted.submission.id);
    const after = await fixture.app.getLearningState();
    expect(after.dailyGuideTask?.id).not.toBe(before.dailyGuideTask?.id);
    expect(after.dailyGuideTask?.actions.map((action) => action.status)).toEqual([
      'planned',
      'planned'
    ]);
    await waitForSubmissionStatus(fixture.store, submitted.submission.id, 'completed');
  });

  it('10. 并发点击展开当前步骤只执行一次 Learning Turn', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    fixture.ai.enqueue(toolReply('explain', {
      explanation: '先写类型契约，再实现函数体。',
      userAction: '为当前函数声明输入与返回类型。',
      requiresSubmission: false
    }));

    const [first, duplicate] = await Promise.all([
      fixture.app.teachCurrentStep(),
      fixture.app.teachCurrentStep()
    ]);

    expect(duplicate.runId).toBe(first.runId);
    expect(duplicate.action.id).toBe(before.dailyGuideAction!.id);
  });

  it('11. Learning Turn 自主串联知识查询和讲解', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    fixture.ai.enqueue(
      toolReply('search_kb', { query: 'TypeScript 类型契约', limit: 5 }),
      toolReply('explain', {
        explanation: '先把输入和输出类型写成契约，再实现函数体。',
        userAction: '为当前函数声明输入与返回类型。',
        requiresSubmission: false
      })
    );

    const teaching = await fixture.app.teachCurrentStep();

    expect(teaching.action.id).toBe(before.dailyGuideAction!.id);
    expect(teaching.artifacts.at(-1)?.explanation).toContain('输入和输出类型');
    expect(teaching.pendingInteraction).toBeUndefined();
  });

  it('11. AI 可在当前 Guide 插入临时补充 Action，但不会创建正式 Task', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    const originalTaskId = before.dailyGuideTask!.id;
    const originalActionId = before.dailyGuideAction!.id;
    await fixture.app.startSession(originalTaskId);
    fixture.ai.enqueue(toolReply('insert_guide_supplement', {
      kind: 'example',
      title: '补充类型契约示例',
      instruction: '先运行一个最小类型契约示例。',
      checkpoint: '能说明类型错误在哪里被阻止。',
      reason: '当前步骤需要一个具体例子。'
    }));

    const teaching = await fixture.app.teachCurrentStep();
    const afterInsert = await fixture.app.getLearningState();

    expect(teaching.artifacts.at(-1)?.explanation).toBe('当前步骤需要一个具体例子。');
    expect(afterInsert.dailyGuideTask?.id).toBe(originalTaskId);
    expect(afterInsert.dailyGuideAction).toMatchObject({
      title: '补充类型契约示例',
      origin: 'agent_supplement',
      requirement: 'optional'
    });

    const afterSupplement = await fixture.app.completeCurrentAction(afterInsert.dailyGuideAction!.id);
    expect(afterSupplement.dailyGuideTask?.id).toBe(originalTaskId);
    expect(afterSupplement.dailyGuideAction?.id).toBe(originalActionId);
  });

  it('12. ask_user 在应用重启后恢复同一个 Learning Turn', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    fixture.ai.enqueue(toolReply('ask_user', {
      question: '你希望示例使用函数还是类？',
      reason: '需要选择贴近当前经验的示例形式。',
      answerMode: 'single_choice',
      options: ['函数', '类'],
      canSkip: false,
      intent: 'choose_example_form'
    }));
    const waiting = await fixture.app.teachCurrentStep();
    expect(waiting.pendingInteraction?.status).toBe('open');

    await fixture.restart();
    fixture.ai.enqueue(toolReply('explain', {
      explanation: '下面使用函数形式说明类型契约。',
      userAction: '写出函数的参数和返回类型。',
      requiresSubmission: false
    }));
    const resumed = await fixture.app.resumeLearningTurn(
      waiting.pendingInteraction!.id,
      '函数',
      waiting.pendingInteraction!.expectedContextVersion
    );

    expect(resumed.runId).toBe(waiting.runId);
    expect(resumed.pendingInteraction).toBeUndefined();
    expect(resumed.artifacts.at(-1)?.explanation).toContain('函数形式');
  });

  it('13. 主动小测在同一个 Learning Turn 中等待、评价并沉淀过程证据', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const plan = await fixture.createGoalAndPlan();
    const before = await fixture.app.getLearningState();
    await fixture.app.startSession(before.dailyGuideTask!.id);
    fixture.ai.enqueue(
      toolReply('quiz', {
        explanation: '检查你是否理解类型契约。',
        questions: [{
          prompt: '返回类型为什么能保护调用方？',
          answerFormat: '一句话'
        }],
        userAction: '直接回答这个问题。',
        requiresSubmission: false
      }),
      toolReply('ask_user', {
        question: '返回类型为什么能保护调用方？',
        reason: '需要根据回答判断理解。',
        answerMode: 'free_text',
        canSkip: false,
        intent: 'evaluate_quiz_answer'
      })
    );

    const waiting = await fixture.app.teachCurrentStep();
    expect(waiting.artifacts.map((item) => item.kind)).toEqual(['quiz', 'question']);
    expect(waiting.pendingInteraction?.status).toBe('open');

    fixture.ai.enqueue(toolReply('evaluate', {
      mode: 'conversation_response',
      feedback: '你提到了约束，但还混淆了编译期和运行期。',
      correctParts: ['返回类型约束调用方可使用的结果'],
      misconceptions: ['把 TypeScript 返回类型当成运行期检查'],
      nextPrompt: '先完成一个编译期类型错误示例，再回到当前步骤。',
      requiresSubmission: false
    }));
    const evaluated = await fixture.app.resumeLearningTurn(
      waiting.pendingInteraction!.id,
      '它会在运行时阻止错误结果。',
      waiting.pendingInteraction!.expectedContextVersion
    );

    expect(evaluated.runId).toBe(waiting.runId);
    expect(evaluated.artifacts.map((item) => item.kind)).toEqual([
      'quiz',
      'question',
      'evaluation'
    ]);
    const knowledge = await fixture.app.getKnowledgeItemsForGoal({
      goalId: plan.goal.id,
      status: 'active'
    });
    expect(knowledge).toEqual(expect.arrayContaining([
      expect.objectContaining({
        summary: '把 TypeScript 返回类型当成运行期检查',
        sourceType: 'misconception'
      })
    ]));
    const misconception = knowledge.find((item) =>
      item.summary === '把 TypeScript 返回类型当成运行期检查'
    )!;
    await fixture.app.setKnowledgeItemStatus(misconception.id, 'dormant');
    expect(await fixture.app.getKnowledgeItemsForGoal({
      goalId: plan.goal.id,
      status: 'active'
    })).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: misconception.id })
    ]));
  });

  it('16. 临时学习不创建正式 Task，后续关联 Goal 只追加引用', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    fixture.ai.enqueue(questionAnswerReply());

    const temporary = await fixture.app.askTemporaryQuestion('什么是闭包？');
    const runtime = await fixture.app.getLearningState();
    expect(temporary.thread.goalId).toBeNull();
    expect(runtime.goal).toBeNull();
    expect(runtime.dailyGuideTask).toBeNull();

    const goal = await fixture.store.createGoal('掌握 JavaScript');
    const linked = await fixture.app.linkTemporaryQuestionToGoal(temporary.thread.id, goal.id);
    expect(linked.thread.goalId).toBe(goal.id);
    expect(linked.messages[0].content).toBe('什么是闭包？');
    expect(linked.messages).toHaveLength(3);
  });

  it('17. 临时学习在同一 Thread 续聊，并可显式转入当前 Guide', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const plan = await fixture.createGoalAndPlan();
    fixture.ai.enqueue(questionAnswerReply(), questionAnswerReply());

    const first = await fixture.app.askTemporaryQuestion('解释泛型约束');
    const continued = await fixture.app.askTemporaryQuestion(
      '给一个反例',
      undefined,
      first.thread.id
    );
    expect(continued.thread.id).toBe(first.thread.id);
    expect(continued.messages.map((message) => message.content)).toEqual(expect.arrayContaining([
      '解释泛型约束',
      '给一个反例'
    ]));
    expect(continued.messages).toHaveLength(4);

    const converted = await fixture.app.convertTemporaryQuestionToTask(
      first.thread.id,
      plan.goal.id
    );
    expect(converted.guideId).toBe(plan.guide.id);
    expect(converted.thread.status).toBe('resolved');
    const guide = await fixture.store.getDailyGuideById(plan.guide.id);
    const task = guide?.tasks.find((item) => item.id === converted.taskId);
    expect(task?.status).toBe('planned');
    expect(task?.actions[0].requirement).toBe('required');
    expect(converted.messages[0].content).toBe('解释泛型约束');
  });

  it('18. 没有当前 Guide 时，临时学习只转成对应 Goal 下的未安排 Task', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    const goal = await fixture.store.createGoal('掌握闭包');
    fixture.ai.enqueue(questionAnswerReply());
    const temporary = await fixture.app.askTemporaryQuestion('闭包如何保存状态？');

    const converted = await fixture.app.convertTemporaryQuestionToTask(
      temporary.thread.id,
      goal.id
    );
    expect(converted.guideId).toBeNull();
    const rows = await fixture.db.select().from(learningTasks);
    const task = rows.find((item) => item.id === converted.taskId);
    expect(task?.goalId).toBe(goal.id);
    expect(task?.guideId).toBeNull();
    expect(task?.status).toBe('planned');

    await fixture.restart();
    const restoredRows = await fixture.db.select().from(learningTasks);
    expect(restoredRows.find((item) => item.id === converted.taskId)?.guideId).toBeNull();
    expect((await fixture.app.getLatestTemporaryQuestion())?.thread.id).toBe(temporary.thread.id);
  });

  it('19. 后台评价与用户纠正都保留在已提交任务的评价链中', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 2, actionCount: 1 });
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(task.id);
    await completeAllActions(fixture.app);

    fixture.ai.enqueue(passingEvaluationReply());
    const submitted = await fixture.app.submitLearningResult('成果与验证记录');
    await waitForSubmissionStatus(fixture.store, submitted.submission.id, 'completed');
    const [aiEvaluation] = await fixture.store.getEvaluationsForTask(task.id);
    await fixture.app.recordEvaluationCorrection(
      aiEvaluation.id,
      '评价忽略了已经存在的边界条件'
    );

    const evaluations = await fixture.store.getEvaluationsForTask(task.id);
    expect(evaluations.map((evaluation) => evaluation.source)).toEqual([
      'user_correction',
      'ai'
    ]);
    expect((await fixture.app.getLearningState()).dailyGuideTask?.id).not.toBe(task.id);
  });

  it('20. 用户对评价推荐的决定由 CommandGateway 记录并应用，且不能改写已应用的决定', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 2, actionCount: 1, evaluationMode: 'ai' });
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(task.id);
    await completeAllActions(fixture.app);

    fixture.ai.enqueue(passingEvaluationReply());
    const submitted = await fixture.app.submitLearningResult('成果与验证记录');
    await waitForSubmissionStatus(fixture.store, submitted.submission.id, 'completed');
    const [evaluation] = await fixture.store.getEvaluationsForTask(task.id);
    expect(evaluation.recommendationDecision).toBeNull();

    await fixture.app.decideEvaluationRecommendation(evaluation.id, 'deferred');
    const [deferred] = await fixture.store.getEvaluationsForTask(task.id);
    expect(deferred.recommendationDecision).toBe('deferred');
    expect(deferred.applicationStatus).toBeNull();

    await fixture.app.decideEvaluationRecommendation(evaluation.id, 'accepted');
    const [accepted] = await fixture.store.getEvaluationsForTask(task.id);
    expect(accepted.recommendationDecision).toBe('accepted');
    expect(accepted.applicationStatus).toBe('applied');

    await expect(
      fixture.app.decideEvaluationRecommendation(evaluation.id, 'declined')
    ).rejects.toThrow('已应用');
    const [unchanged] = await fixture.store.getEvaluationsForTask(task.id);
    expect(unchanged.recommendationDecision).toBe('accepted');
    expect(unchanged.applicationStatus).toBe('applied');
  });

  it('21. 采纳属于较早成果尝试的推荐会标记 failed，用户重试后成功应用', async () => {
    const fixture = await LearningFlowFixture.create();
    fixtures.push(fixture);
    await fixture.createGoalAndPlan({ taskCount: 1, actionCount: 1, evaluationMode: 'ai' });
    const task = (await fixture.app.getLearningState()).dailyGuideTask!;
    await fixture.app.startSession(task.id);
    await completeAllActions(fixture.app);

    fixture.ai.enqueue(passingEvaluationReply());
    const first = await fixture.app.submitLearningResult('成果与验证记录');
    await waitForSubmissionStatus(fixture.store, first.submission.id, 'completed');
    const [evaluation] = await fixture.store.getEvaluationsForTask(task.id);

    const laterSubmission = await fixture.store.createSubmission({
      taskId: task.id,
      content: '后续版本'
    });

    await expect(
      fixture.app.decideEvaluationRecommendation(evaluation.id, 'accepted')
    ).rejects.toThrow('较早的成果尝试');
    const [failed] = await fixture.store.getEvaluationsForTask(task.id);
    expect(failed.recommendationDecision).toBe('accepted');
    expect(failed.applicationStatus).toBe('failed');

    await fixture.db.update(learningSubmissions).set({
      createdAt: '2020-01-01T00:00:00.000Z'
    }).where(eq(learningSubmissions.id, laterSubmission.id));
    const snapshot = await fixture.app.decideEvaluationRecommendation(evaluation.id, 'accepted');
    const [applied] = await fixture.store.getEvaluationsForTask(task.id);
    expect(applied.applicationStatus).toBe('applied');
    const closed = (await fixture.db.select().from(learningTasks)
      .where(eq(learningTasks.id, task.id)).limit(1))[0];
    expect(closed.status).toBe('closed');
    expect(closed.closureKind).toBe('completed');
    expect(snapshot.dailyGuideTask?.id).not.toBe(task.id);
  });
});

class LearningFlowFixture {
  private constructor(
    readonly root: string,
    readonly ai: LocalAiServer,
    public client: DatabaseClient,
    public db: Database,
    public store: StudyStore,
    public app: AppService
  ) {}

  static async create(): Promise<LearningFlowFixture> {
    const root = mkdtempSync(join(tmpdir(), 'study-flow-e2e-'));
    const ai = await LocalAiServer.start();
    const created = await createDatabase(root);
    const store = new StudyStore(created.db);
    await store.seedDefaults();
    const app = new AppService(store, createTestSettings(ai.baseUrl), () => null);
    return new LearningFlowFixture(root, ai, created.client, created.db, store, app);
  }

  async createGoalAndPlan(options: {
    taskCount?: number;
    actionCount?: number;
    evaluationMode?: 'local' | 'ai';
  } = {}) {
    this.ai.enqueue(readyGoalReply());
    const onboarding = await this.app.sendOnboardingMessage('我想系统掌握 TypeScript，并完成一个项目。');
    expect(onboarding.intake.status).toBe('ready');

    this.enqueuePlan(options);
    const plan = await this.app.generateInitialLearningPlan();
    if (!plan.goal || !plan.guide) {
      throw new Error('端到端夹具未生成正式 Goal 和 Learning Guide。');
    }
    return { ...plan, goal: plan.goal, guide: plan.guide };
  }

  enqueuePlan(options: {
    taskCount?: number;
    actionCount?: number;
    evaluationMode?: 'local' | 'ai';
  } = {}): void {
    this.ai.enqueue(
      roadmapReply(),
      shortPlanReply(),
      guideReply(options)
    );
  }

  async restart(): Promise<void> {
    this.client.close();
    const created = await createDatabase(this.root);
    this.client = created.client;
    this.db = created.db;
    this.store = new StudyStore(created.db);
    await this.store.seedDefaults();
    this.app = new AppService(this.store, createTestSettings(this.ai.baseUrl), () => null);
    await this.app.initialize();
  }

  async destroy(): Promise<void> {
    try {
      const active = await this.app.getActiveSession();
      if (active) await this.app.endSession(active.id);
    } catch {
      // The database may already be closed by a restart test.
    }
    this.client.close();
    await this.ai.stop();
    removeTempDir(this.root);
  }
}

class LocalAiServer {
  private readonly queue: QueuedAiResponse[] = [];

  private constructor(
    private readonly server: Server,
    readonly baseUrl: string
  ) {}

  static async start(): Promise<LocalAiServer> {
    let instance: LocalAiServer;
    const server = createServer((request, response) => {
      void readRequest(request).then(() => instance.respond(response));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    instance = new LocalAiServer(server, `http://127.0.0.1:${address.port}/v1`);
    return instance;
  }

  enqueue(...responses: AiReply[]): void {
    this.queue.push(...responses.map((body) => ({
      kind: 'json' as const,
      body,
      responseField: 'content' as const
    })));
  }

  enqueueReasoning(...responses: AiReply[]): void {
    this.queue.push(...responses.map((body) => ({
      kind: 'json' as const,
      body,
      responseField: 'reasoning_content' as const
    })));
  }

  enqueueDelayed(delayMs: number, ...responses: AiReply[]): void {
    this.queue.push(...responses.map((body) => ({
      kind: 'json' as const,
      body,
      responseField: 'content' as const,
      delayMs
    })));
  }

  enqueueHttpError(status = 500, message = 'temporary model failure'): void {
    this.queue.push({ kind: 'http_error', status, message });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async respond(response: ServerResponse): Promise<void> {
    const next = this.queue.shift();
    if (!next) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'No AI response queued.' } }));
      return;
    }
    if (next.kind === 'http_error') {
      response.writeHead(next.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: next.message } }));
      return;
    }
    if (next.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs));
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    const serialized = JSON.stringify(next.body);
    response.end(JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deterministic-e2e-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: next.responseField === 'content' ? serialized : null,
          ...(next.responseField === 'reasoning_content'
            ? { reasoning_content: serialized }
            : {})
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }));
  }
}

function createTestSettings(baseUrl: string): SettingsService {
  const appSettings = {
    aiBaseUrl: baseUrl,
    aiModel: 'deterministic-e2e-model',
    hasAiApiKey: true,
    autoLaunch: false,
    defaultBlockMinutes: 10,
    dailyStudyWindows: [{ start: '20:00', end: '22:00' }],
    learningStyle: 'detailed' as const
  };
  return {
    getAppSettings: async () => appSettings,
    getRuntimeSettings: async () => ({
      ...appSettings,
      aiApiKey: 'test-key'
    })
  } as unknown as SettingsService;
}

function readyGoalReply(): AiReply {
  return toolReply('propose_goal', {
    status: 'ready',
    reply: '目标已经清楚，可以生成学习路径。',
    brief: {
      title: '掌握 TypeScript',
      targetOutcome: '能够独立完成一个 TypeScript 项目',
      currentLevel: '了解 JavaScript 基础',
      availableTime: '每天两小时',
      deadline: '两个月',
      constraints: ['使用本地开发环境'],
      successCriteria: ['完成可运行项目']
    },
    missingInfo: [],
    shouldForceStart: false
  });
}

function needMoreInfoReply(): AiReply {
  return toolReply('propose_goal', {
    status: 'need_more_info',
    reply: '你每天可以学习多长时间，希望最终完成什么成果？',
    brief: null,
    missingInfo: ['可用时间', '目标成果'],
    shouldForceStart: false
  });
}

function roadmapReply(): AiReply {
  return toolReply('propose_roadmap', {
    goalSummary: '从类型基础推进到完整项目。',
    stages: [
      {
        title: '打好基础',
        objective: '掌握核心类型系统',
        direction: '通过小练习建立类型思维',
        successCriteria: '能为常见函数建模',
        targetDate: '2026-08-15'
      },
      {
        title: '完成项目',
        objective: '综合运用 TypeScript',
        direction: '完成一个可运行项目',
        successCriteria: '项目通过类型检查',
        targetDate: '2026-09-24'
      }
    ]
  });
}

function shortPlanReply(): AiReply {
  return toolReply('propose_short_plan', {
    weekFocus: '完成第一个可验证功能',
    items: [{
      itemIndex: 1,
      roadmapStagePosition: 1,
      title: '类型基础实践',
      focus: '用类型约束实现功能',
      tasks: ['实现第一个功能'],
      expectedOutput: '一个可运行函数',
      successCriteria: '类型检查通过'
    }]
  });
}

function guideReply(options: {
  taskCount?: number;
  actionCount?: number;
  evaluationMode?: 'local' | 'ai';
} = {}): AiReply {
  const taskCount = options.taskCount ?? 1;
  const actionCount = options.actionCount ?? 2;
  const evaluationMode = options.evaluationMode ?? 'ai';
  return toolReply('prepare_learning_guide', {
    date: '2026-07-24',
    todayGoal: '完成第一个 TypeScript 功能',
    deliverables: ['可运行函数'],
    boundaries: ['不引入额外框架'],
    acceptanceCriteria: ['类型检查通过'],
    tomorrowActions: ['继续扩展功能'],
    tasks: Array.from({ length: taskCount }, (_, taskIndex) => ({
      title: taskIndex === 0 ? '实现第一个功能' : `实现后续功能 ${taskIndex + 1}`,
      objective: '使用 TypeScript 完成可验证实现',
      scope: '类型定义和函数实现',
      estimatedMinutes: { min: 10, target: 20, max: 30 },
      actions: Array.from({ length: actionCount }, (_, actionIndex) => ({
        title: actionIndex === 0 ? '阅读需求' : `执行步骤 ${actionIndex + 1}`,
        instruction: '按照验收条件完成当前步骤',
        checkpoint: '获得可见的中间结果'
      })),
      deliverable: '可运行函数',
      doneWhen: ['提交内容包含实现说明和验证结果'],
      quickHint: '先写类型，再写实现',
      evaluationMode
    }))
  });
}

function passingEvaluationReply(): AiReply {
  return toolReply('evaluate', {
    result: 'passed',
    evidence: ['实现完整', '类型检查通过'],
    correctParts: ['类型定义正确'],
    misconceptions: [],
    missingRequirements: [],
    feedback: '成果满足验收条件，可以结束当前任务。',
    recommendedAction: 'complete_task'
  });
}

function questionAnswerReply(): AiReply {
  return toolReply('explain', {
    answer: '先定义类型可以固定输入和输出契约，让后续实现有明确边界。',
    relationToCurrentStep: '这直接解释了当前实现步骤的顺序。',
    example: '先写 type Input，再实现 function run(input: Input)。',
    resolved: true,
    returnToStepInstruction: '现在回到“阅读需求”，写出输入和输出类型。',
    resolutionSummary: '类型定义用于约束实现边界。'
  });
}

function toolReply(toolName: string, input: AiReply): AiReply {
  return { toolName, input };
}

async function completeAllActions(app: AppService): Promise<void> {
  while (true) {
    const action = (await app.getLearningState()).dailyGuideAction;
    if (!action) return;
    await app.completeCurrentAction(action.id);
  }
}

async function waitForSubmissionStatus(
  store: StudyStore,
  submissionId: string,
  expectedStatus: LearningSubmission['evaluationStatus']
): Promise<LearningSubmission> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const submission = await store.getSubmissionById(submissionId);
    if (submission?.evaluationStatus === expectedStatus) return submission;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const submission = await store.getSubmissionById(submissionId);
  throw new Error(
    `等待提交 ${submissionId} 进入 ${expectedStatus} 超时，当前状态：${submission?.evaluationStatus ?? 'missing'}`
  );
}

async function readRequest(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) {
    // Drain the request before responding so the real OpenAI client completes normally.
  }
}

function removeTempDir(path: string): void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
    }
  }
}
