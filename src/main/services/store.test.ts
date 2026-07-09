import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseClient } from '../db/client';
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

  it('saves parsed imports as tasks', async () => {
    const rawImport = await store.createRawImport('Learn SQLite and Electron', 'manual');

    const tasks = await store.saveParsedImport(rawImport.id, {
      goals: [
        {
          title: 'Build app',
          description: 'Main goal',
          priority: 3,
          dueDate: null
        }
      ],
      tasks: [
        {
          title: 'Create schema',
          description: 'Define local tables',
          goalTitle: 'Build app',
          priority: 2,
          difficulty: 'foundation',
          estimateMinutes: 40,
          acceptanceCriteria: 'Schema can initialize',
          dependsOnTitles: []
        }
      ]
    });

    expect(tasks).toHaveLength(1);
    expect((await store.listTasks())[0].title).toBe('Create schema');
  });

  it('creates draft plans from validated agent output', async () => {
    const plan = await store.createPlanFromAgentOutput({
      date: '2026-06-19',
      availableWindowsJson: JSON.stringify([{ start: '20:00', end: '21:00' }]),
      output: {
        blocks: [
          {
            taskTitle: null,
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: 'Open materials',
            action: 'Prepare study context',
            expectedOutput: 'Workspace ready',
            difficulty: 'foundation',
            material: 'Local plan',
            successCheck: 'Ready to study',
            fallback: 'Reduce setup to one file'
          }
        ]
      }
    });

    expect(plan.status).toBe('draft');
    expect(plan.blocks).toHaveLength(1);
  });

  it('creates manual goals and confirms stage outline proposals', async () => {
    const goal = await store.createGoal('掌握线性代数', '用于机器学习基础');

    expect(goal.title).toBe('掌握线性代数');
    expect((await store.getLearningRuntimeSnapshot()).state.activeGoalId).toBe(goal.id);

    const proposed = await store.saveStageOutline(goal.id, {
      goalSummary: '先建立概念，再做矩阵应用。',
      stages: [
        {
          title: '向量与矩阵基础',
          objective: '理解向量、矩阵和线性变换',
          prerequisites: '高中代数',
          successCriteria: '能手算基础矩阵乘法'
        }
      ]
    });

    expect(proposed[0].status).toBe('proposed');

    const confirmed = await store.confirmStages(goal.id);

    expect(confirmed[0].status).toBe('active');
    expect((await store.getLearningRuntimeSnapshot()).state.activeStageId).toBe(confirmed[0].id);
  });

  it('creates one initial backlog task from a confirmed stage for manual goals without tasks', async () => {
    const goal = await store.createGoal('掌握线性代数', '用于机器学习基础');
    await store.saveStageOutline(goal.id, {
      goalSummary: '先建立概念，再做矩阵应用。',
      stages: [
        {
          title: '向量与矩阵基础',
          objective: '理解向量、矩阵和线性变换',
          prerequisites: '高中代数',
          successCriteria: '能手算基础矩阵乘法'
        }
      ]
    });
    await store.confirmStages(goal.id);

    const created = await store.ensureInitialTaskForCurrentStage(goal.id);
    const duplicate = await store.ensureInitialTaskForCurrentStage(goal.id);
    const tasks = await store.listTasks();

    expect(created?.title).toBe('阶段起步：向量与矩阵基础');
    expect(created?.goalId).toBe(goal.id);
    expect(created?.status).toBe('backlog');
    expect(created?.acceptanceCriteria).toBe('能手算基础矩阵乘法');
    expect(duplicate).toBeNull();
    expect(tasks.filter((task) => task.goalId === goal.id)).toHaveLength(1);
  });


  it('resumes a paused session for the same block without losing accumulated time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T10:00:00.000Z'));
    const plan = await createSingleBlockPlan('2026-06-21');
    const blockId = plan.blocks[0].id;

    const started = await store.startSession(blockId);
    vi.setSystemTime(new Date('2026-06-21T10:01:00.000Z'));
    const paused = await store.pauseSession(started.id);

    expect(paused.durationMinutes).toBeCloseTo(1);

    const resumed = await store.startSession(blockId);

    expect(resumed.id).toBe(started.id);
    expect(resumed.status).toBe('active');
    expect(resumed.durationMinutes).toBeCloseTo(1);
    expect((await store.listSessions()).filter((session) => session.status === 'active')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-06-21T10:01:10.000Z'));
    const pausedAgain = await store.pauseSession(started.id);

    expect(pausedAgain.durationMinutes).toBeCloseTo(70 / 60);
    expect(await store.getAccumulatedSeconds(blockId)).toBe(70);
  });

  it('persists progressive learning state, question branches, and next-step decisions', async () => {
    const rawImport = await store.createRawImport('我要系统学习 TypeScript 泛型。', 'manual');
    await store.saveParsedImport(rawImport.id, {
      goals: [
        {
          title: '掌握 TypeScript 泛型',
          description: '能在项目中使用泛型建模',
          priority: 2,
          dueDate: null
        }
      ],
      tasks: [
        {
          title: '理解泛型函数',
          description: '学习泛型函数的定义和调用',
          goalTitle: '掌握 TypeScript 泛型',
          priority: 2,
          difficulty: 'foundation',
          estimateMinutes: 20,
          acceptanceCriteria: '能写出一个泛型 identity 函数',
          dependsOnTitles: []
        }
      ]
    });
    const goal = (await store.listGoals())[0];
    await store.saveStageOutline(goal.id, {
      goalSummary: '从泛型函数到项目建模逐步学习。',
      stages: [
        {
          title: '泛型基础',
          objective: '理解类型参数',
          prerequisites: 'TypeScript 基础类型',
          successCriteria: '能解释并编写泛型函数'
        }
      ]
    });
    const plan = await store.createPlanFromAgentOutput({
      date: '2026-07-02',
      availableWindowsJson: JSON.stringify([{ start: '20:00', end: '20:30' }]),
      output: {
        blocks: [
          {
            taskTitle: '理解泛型函数',
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: '写出第一个泛型函数',
            action: '阅读示例并写 identity<T>',
            expectedOutput: '一个泛型 identity 函数',
            difficulty: 'foundation',
            material: '本地笔记',
            successCheck: '能解释 T 的含义',
            fallback: '先改写现成示例'
          }
        ]
      }
    });
    const blockId = plan.blocks[0].id;
    const session = await store.startSession(blockId);
    const started = await store.initializeLearningForBlock(blockId, 'active');

    expect(started.step?.objective).toBe('写出第一个泛型函数');
    expect(started.state.activeStepId).toBe(started.step?.id);

    const thread = await store.openQuestion(started.step!.id, 'T 和 any 有什么区别？');
    const withQuestion = await store.getLearningRuntimeSnapshot();

    expect(withQuestion.state.activeStepId).toBe(started.step?.id);
    expect(withQuestion.state.activeQuestionThreadId).toBe(thread.id);

    await store.resolveQuestion(thread.id, 'T 会保留输入输出之间的类型关系，any 会丢失约束。');
    const resolved = await store.getLearningRuntimeSnapshot();

    expect(resolved.state.activeStepId).toBe(started.step?.id);
    expect(resolved.state.activeQuestionThreadId).toBeNull();

    const submission = await store.createSubmission(started.step!.id, session.id, 'function identity<T>(value: T): T { return value }');
    const result = await store.saveEvaluationAndDecision({
      submission,
      evaluationOutput: {
        result: 'passed',
        mastery: 82,
        evidence: ['函数签名正确'],
        correctParts: ['使用 T 连接参数和返回值'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '已经达成本步骤标准。',
        recommendedAction: 'advance'
      },
      decisionOutput: {
        decision: 'advance',
        reason: '当前步骤已通过，可以进入约束泛型。',
        taskCompleted: false,
        nextStep: {
          title: '加入泛型约束',
          objective: '理解 extends 约束',
          instruction: '把 identity 改为读取 length 的泛型函数。',
          expectedOutput: '一个带 extends { length: number } 的函数',
          successCriteria: '能说明约束解决了什么问题'
        },
        remediation: null,
        carryForward: '用户已掌握基础泛型函数。'
      }
    });

    expect(result.evaluation.result).toBe('passed');
    expect(result.nextStep?.objective).toBe('理解 extends 约束');
    expect((await store.getLearningRuntimeSnapshot()).state.activeStepId).toBe(result.nextStep?.id);
  });

  it('stores task summaries and pending adjustment proposals when a task is completed', async () => {
    const goal = await store.createGoal('完成概率论复习', '重点掌握贝叶斯公式');
    await store.saveStageOutline(goal.id, {
      goalSummary: '围绕概率公式和应用题复习。',
      stages: [
        {
          title: '条件概率',
          objective: '掌握条件概率和贝叶斯公式',
          prerequisites: '基础概率',
          successCriteria: '能独立完成一道贝叶斯应用题'
        }
      ]
    });
    await store.confirmStages(goal.id);
    const plan = await store.createPlanFromAgentOutput({
      date: '2026-07-02',
      availableWindowsJson: JSON.stringify([{ start: '21:00', end: '21:30' }]),
      output: {
        blocks: [
          {
            taskTitle: null,
            startTime: '21:00',
            endTime: '21:10',
            durationMinutes: 10,
            objective: '完成贝叶斯例题',
            action: '写出公式并代入一道题',
            expectedOutput: '完整解题过程',
            difficulty: 'foundation',
            material: '本地题目',
            successCheck: '能解释先验和后验',
            fallback: '先只列出已知条件'
          }
        ]
      }
    });
    const session = await store.startSession(plan.blocks[0].id);
    const snapshot = await store.initializeLearningForBlock(plan.blocks[0].id, 'active');
    const submission = await store.createSubmission(snapshot.step!.id, session.id, '我完成了一道贝叶斯公式题。');

    await store.saveEvaluationAndDecision({
      submission,
      evaluationOutput: {
        result: 'passed',
        mastery: 90,
        evidence: ['公式和代入步骤完整'],
        correctParts: ['区分了先验和后验'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '任务已达到完成标准。',
        recommendedAction: 'complete_task'
      },
      decisionOutput: {
        decision: 'complete_task',
        reason: '本任务完成，可以把后续重点转向混合题。',
        taskCompleted: true,
        nextStep: null,
        remediation: null,
        carryForward: '下一次增加一道混合条件概率题。'
      }
    });

    const after = await store.getLearningRuntimeSnapshot();

    expect(after.state.sessionStatus).toBe('completed');
    expect(after.pendingAdjustment?.status).toBe('pending');
    expect(after.pendingAdjustment?.reason).toContain('本任务完成');

    const accepted = await store.decidePlanAdjustment(after.pendingAdjustment!.id, 'accepted');
    const tasks = await store.listTasks();

    expect(accepted.status).toBe('accepted');
    expect(accepted.appliedTaskId).toBeTruthy();
    expect(accepted.appliedAt).toBeTruthy();
    expect(tasks.find((task) => task.id === accepted.appliedTaskId)?.title).toContain('跟进');
    expect(tasks.find((task) => task.id === accepted.appliedTaskId)?.goalId).toBe(goal.id);
  });

  it('restores active learning node and open question branch after database reopen', async () => {
    const goal = await store.createGoal('学习数据库索引', '掌握查询性能基础');
    await store.saveStageOutline(goal.id, {
      goalSummary: '从索引概念到查询计划逐步学习。',
      stages: [
        {
          title: '索引基础',
          objective: '理解 B-tree 索引的用途',
          prerequisites: 'SQL 基础',
          successCriteria: '能说明索引如何减少扫描范围'
        }
      ]
    });
    await store.confirmStages(goal.id);
    const plan = await store.createPlanFromAgentOutput({
      date: '2026-07-02',
      availableWindowsJson: JSON.stringify([{ start: '22:00', end: '22:30' }]),
      output: {
        blocks: [
          {
            taskTitle: null,
            startTime: '22:00',
            endTime: '22:10',
            durationMinutes: 10,
            objective: '解释索引为什么加速查询',
            action: '写出一次全表扫描和索引扫描的区别',
            expectedOutput: '一段对比说明',
            difficulty: 'foundation',
            material: '本地笔记',
            successCheck: '能说清扫描范围变化',
            fallback: '先用通讯录查名字类比'
          }
        ]
      }
    });
    await store.startSession(plan.blocks[0].id);
    const before = await store.initializeLearningForBlock(plan.blocks[0].id, 'active');
    const question = await store.openQuestion(before.step!.id, '索引是不是越多越好？');

    client.close();
    const reopened = await createDatabase(tmpPath);
    client = reopened.client;
    store = new StudyStore(reopened.db);
    await store.seedDefaults();

    const restored = await store.getLearningRuntimeSnapshot();

    expect(restored.state.activeGoalId).toBe(goal.id);
    expect(restored.state.activeStageId).toBe(before.stage?.id);
    expect(restored.state.activeDailyTaskId).toBe(plan.blocks[0].id);
    expect(restored.state.activeStepId).toBe(before.step?.id);
    expect(restored.state.activeQuestionThreadId).toBe(question.id);
    expect(restored.questionThread?.status).toBe('open');
    expect(restored.questionMessages.map((message) => message.content)).toContain('索引是不是越多越好？');
  });

  it('runs two progressive learning cycles with bounded question context and follow-up planning', async () => {
    const rawImport = await store.createRawImport('我要学习 HTTP 缓存，并能解释 Cache-Control。', 'manual');
    await store.saveParsedImport(rawImport.id, {
      goals: [
        {
          title: '掌握 HTTP 缓存',
          description: '能在前端项目中解释和配置缓存策略',
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
    const goal = (await store.listGoals())[0];
    await store.saveStageOutline(goal.id, {
      goalSummary: '先理解浏览器缓存语义，再练习响应头配置。',
      stages: [
        {
          title: '缓存语义基础',
          objective: '理解 Cache-Control 常用指令',
          prerequisites: 'HTTP 请求响应基础',
          successCriteria: '能解释并选择合适缓存指令'
        }
      ]
    });
    await store.confirmStages(goal.id);

    const firstPlan = await store.createPlanFromAgentOutput({
      date: '2026-07-02',
      availableWindowsJson: JSON.stringify([{ start: '20:00', end: '20:30' }]),
      output: {
        blocks: [
          {
            taskTitle: '理解 Cache-Control',
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: '区分 max-age 和 no-cache',
            action: '写出两者在缓存命中后的行为差异',
            expectedOutput: '一段缓存策略说明',
            difficulty: 'foundation',
            material: '本地 HTTP 笔记',
            successCheck: '能说明 no-cache 不是不缓存',
            fallback: '先用浏览器缓存类比'
          }
        ]
      }
    });
    await store.confirmPlan(firstPlan.id);
    const firstSession = await store.startSession(firstPlan.blocks[0].id);
    const firstStart = await store.initializeLearningForBlock(firstPlan.blocks[0].id, 'active');

    const thread = await store.openQuestion(firstStart.step!.id, 'max-age 到期后会发生什么？');
    await store.addQuestionMessage(thread.id, 'assistant', '到期后通常需要重新验证或重新获取。');
    await store.addQuestionMessage(thread.id, 'user', '那 no-cache 是完全不存吗？');
    await store.addQuestionMessage(thread.id, 'assistant', '不是，它可以存，但使用前要重新验证。');
    await store.addQuestionMessage(thread.id, 'user', 'must-revalidate 又是什么？');

    const questionContext = await new ContextBuilder(store).build('answer_step_question', {
      question: 'must-revalidate 又是什么？'
    });
    const threadContext = questionContext.context.currentQuestionThread as { messages: Array<{ content: string }> };

    expect(threadContext.messages).toHaveLength(4);
    expect(threadContext.messages.map((message) => message.content)).not.toContain('max-age 到期后会发生什么？');
    expect(questionContext.contextSourceIds).toContain(firstStart.step!.id);
    expect(questionContext.contextSourceIds).toContain(thread.id);

    await store.saveQuestionAnswer(thread.id, {
      answer: 'must-revalidate 表示缓存过期后必须重新验证，不能在离线等情况下随意使用陈旧缓存。',
      relationToCurrentStep: '用于补全当前步骤里的 Cache-Control 指令区别。',
      example: 'Cache-Control: max-age=60, must-revalidate',
      resolved: true,
      returnToStepInstruction: '回到当前步骤，继续写出三个指令的区别。',
      resolutionSummary: '用户理解了 must-revalidate 与过期缓存验证的关系。'
    });
    const afterQuestion = await store.getLearningRuntimeSnapshot();

    expect(afterQuestion.state.activeStepId).toBe(firstStart.step!.id);
    expect(afterQuestion.state.activeQuestionThreadId).toBeNull();

    const firstSubmission = await store.createSubmission(
      firstStart.step!.id,
      firstSession.id,
      'max-age 控制新鲜期；no-cache 可以存但每次用前要验证。'
    );
    const remediation = await store.saveEvaluationAndDecision({
      submission: firstSubmission,
      evaluationOutput: {
        result: 'partial',
        mastery: 64,
        evidence: ['能解释 max-age 和 no-cache'],
        correctParts: ['no-cache 不是完全不缓存'],
        misconceptions: ['must-revalidate 没有纳入比较'],
        missingRequirements: ['补充 must-revalidate 的作用'],
        feedback: '主要概念对了，但还缺一个关键指令。',
        recommendedAction: 'remediate'
      },
      decisionOutput: {
        decision: 'remediate',
        reason: '需要补齐 must-revalidate 后再完成本任务。',
        taskCompleted: false,
        nextStep: null,
        remediation: {
          title: '补齐 must-revalidate',
          instruction: '用一句话比较 no-cache 和 must-revalidate。',
          expectedOutput: '一段包含两个指令区别的说明',
          successCriteria: '能说明重新验证的强制性'
        },
        carryForward: '用户已掌握 max-age 和 no-cache，下一步补 must-revalidate。'
      }
    });

    expect(remediation.nextStep?.title).toBe('补齐 must-revalidate');

    const nextStepContext = await new ContextBuilder(store).build('teach_step');

    expect(nextStepContext.snapshot.recentStepSummaries).toHaveLength(1);
    expect(nextStepContext.snapshot.recentStepSummaries[0].refId).toBe(firstStart.step!.id);

    const secondSubmission = await store.createSubmission(
      remediation.nextStep!.id,
      firstSession.id,
      'no-cache 每次使用前都要验证；must-revalidate 要求过期后必须验证，不能随便用旧缓存。'
    );
    await store.saveEvaluationAndDecision({
      submission: secondSubmission,
      evaluationOutput: {
        result: 'passed',
        mastery: 88,
        evidence: ['准确比较两个指令'],
        correctParts: ['说明了过期后的强制验证'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '已经达到当前任务标准。',
        recommendedAction: 'complete_task'
      },
      decisionOutput: {
        decision: 'complete_task',
        reason: '当前 Cache-Control 基础任务完成。',
        taskCompleted: true,
        nextStep: null,
        remediation: null,
        carryForward: '下一次练习为静态资源选择缓存响应头。'
      }
    });
    await store.completeSession(firstSession.id, '完成 Cache-Control 基础比较。');
    const completedFirstCycle = await store.getLearningRuntimeSnapshot();

    expect(completedFirstCycle.pendingAdjustment?.status).toBe('pending');

    const accepted = await store.decidePlanAdjustment(completedFirstCycle.pendingAdjustment!.id, 'accepted');
    const followUpTask = (await store.listTasks()).find((task) => task.id === accepted.appliedTaskId);

    expect(followUpTask?.status).toBe('backlog');
    expect(followUpTask?.acceptanceCriteria).toContain('下一次练习');

    const secondPlan = await store.createPlanFromAgentOutput({
      date: '2026-07-03',
      availableWindowsJson: JSON.stringify([{ start: '20:00', end: '20:30' }]),
      output: {
        blocks: [
          {
            taskTitle: followUpTask!.title,
            startTime: '20:00',
            endTime: '20:10',
            durationMinutes: 10,
            objective: '为静态资源选择缓存响应头',
            action: '给 JS bundle 写出一组 Cache-Control 响应头并解释理由',
            expectedOutput: '一组响应头和理由',
            difficulty: 'foundation',
            material: '本地 HTTP 笔记',
            successCheck: '能说明长期缓存和重新验证策略',
            fallback: '先只选择 max-age'
          }
        ]
      }
    });
    await store.confirmPlan(secondPlan.id);
    const secondSession = await store.startSession(secondPlan.blocks[0].id);
    const secondStart = await store.initializeLearningForBlock(secondPlan.blocks[0].id, 'active');

    expect(secondStart.task?.id).toBe(followUpTask!.id);
    expect(secondStart.step?.objective).toBe('为静态资源选择缓存响应头');

    const secondThread = await store.openQuestion(secondStart.step!.id, 'hash 文件名为什么可以长缓存？');
    await store.saveQuestionAnswer(secondThread.id, {
      answer: '因为内容变化会改变文件名，旧缓存不会误用于新内容。',
      relationToCurrentStep: '这是为静态资源选择缓存头的关键依据。',
      example: 'app.abc123.js 可以设置较长 max-age。',
      resolved: true,
      returnToStepInstruction: '回到当前步骤，写出响应头并解释 hash 文件名。',
      resolutionSummary: '用户理解了 hash 文件名支持长缓存的原因。'
    });
    const secondResolved = await store.getLearningRuntimeSnapshot();

    expect(secondResolved.state.activeStepId).toBe(secondStart.step!.id);
    expect(secondResolved.state.activeQuestionThreadId).toBeNull();

    const finalSubmission = await store.createSubmission(
      secondStart.step!.id,
      secondSession.id,
      'Cache-Control: public, max-age=31536000, immutable；文件名带 hash，内容变了 URL 会变。'
    );
    await store.saveEvaluationAndDecision({
      submission: finalSubmission,
      evaluationOutput: {
        result: 'passed',
        mastery: 92,
        evidence: ['响应头和 hash 理由匹配'],
        correctParts: ['使用了长缓存和 immutable'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '能把缓存策略应用到静态资源。',
        recommendedAction: 'complete_task'
      },
      decisionOutput: {
        decision: 'complete_task',
        reason: '跟进练习完成。',
        taskCompleted: true,
        nextStep: null,
        remediation: null,
        carryForward: '后续可学习协商缓存 ETag。'
      }
    });
    await store.completeSession(secondSession.id, '完成静态资源缓存头练习。');
    const finalState = await store.getLearningRuntimeSnapshot();

    expect(finalState.state.sessionStatus).toBe('completed');
    expect(finalState.latestEvaluation?.result).toBe('passed');
    expect(finalState.pendingAdjustment?.status).toBe('pending');
  });
});

async function createSingleBlockPlan(date: string) {
  return store.createPlanFromAgentOutput({
    date,
    availableWindowsJson: JSON.stringify([{ start: '10:00', end: '10:30' }]),
    output: {
      blocks: [
        {
          taskTitle: null,
          startTime: '10:00',
          endTime: '10:10',
          durationMinutes: 10,
          objective: 'Read one section',
          action: 'Study the material and write notes',
          expectedOutput: 'Notes for one section',
          difficulty: 'foundation',
          material: 'Local material',
          successCheck: 'Can explain the section',
          fallback: 'Read a shorter excerpt'
        }
      ]
    }
  });
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
