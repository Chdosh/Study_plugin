import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { LearningBranchModule } from './branch';
import { StudyStore } from '../../services/store';

let tmpPath: string;
let client: DatabaseClient;
let store: StudyStore;
let branch: LearningBranchModule;

beforeEach(async () => {
  tmpPath = mkdtempSync(join(tmpdir(), 'study-branch-test-'));
  const created = await createDatabase(tmpPath);
  client = created.client;
  store = new StudyStore(created.db);
  await store.seedDefaults();
  branch = new LearningBranchModule(store);
});

afterEach(async () => {
  client.close();
  await removeTempDir(tmpPath);
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

async function createTestGuideWithTask() {
  const goal = await store.createGoal('测试目标', '用于测试 branch 模块');
  const result = await store.saveLayeredPlan({
    goal,
    brief: null,
    date: '2026-07-11',
    windows: [{ start: '10:00', end: '12:00' }],
    roadmap: {
      goalSummary: '测试用目标',
      stages: [{
        title: '测试阶段',
        objective: '完成测试',
        direction: '测试方向',
        successCriteria: '通过测试'
      }]
    },
    shortPlan: {
      weekFocus: '测试周',
      days: [{
        dayIndex: 1,
        title: '测试日',
        focus: '测试',
        tasks: ['测试任务'],
        expectedOutput: '测试产出',
        successCriteria: '测试完成'
      }]
    },
    dailyGuide: {
      date: '2026-07-11',
      todayGoal: '今日测试目标',
      deliverables: ['测试交付'],
      boundaries: [],
      acceptanceCriteria: ['测试验收'],
      tomorrowActions: [],
      tasks: [{
        title: '测试任务',
        objective: '完成测试动作',
        scope: '测试范围',
        estimatedMinutes: { min: 15, target: 30, max: 45 },
        actions: [
          { title: '测试动作1', instruction: '执行测试', checkpoint: '看到结果' }
        ],
        deliverable: '测试产出',
        doneWhen: ['测试完成'],
        evaluationMode: 'local',
        submissionPolicy: 'once_after_task',
        carryoverAllowed: true,
        quickHint: '提示'
      }]
    }
  });
    return result;
}

describe('LearningBranchModule', () => {
  it('opens a branch with kind and anchor', async () => {
    const result = await createTestGuideWithTask();
    const guide = result.guide;
    const taskId = guide.tasks[0].id;
    const actionId = guide.tasks[0].actions[0].id;

    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId,
      actionId
    }, '为什么这里会报错？');

    expect(handle.threadId).toBeTruthy();
    expect(handle.kind).toBe('question');
    expect(handle.anchor.goalId).toBe(result.goal.id);
    expect(handle.anchor.taskId).toBe(taskId);

    const thread = await branch.getThread(handle.threadId);
    expect(thread).not.toBeNull();
    expect(thread?.taskId).toBeNull();
    expect(thread!.status).toBe('open');
    expect(thread!.question).toBe('为什么这里会报错？');
    const messages = await branch.getMessages(handle.threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: '为什么这里会报错？' });
    expect(messages[0].content).not.toContain('Branch:');
  });

  it('uses readable Chinese default content for debug and practice branches', async () => {
    const result = await createTestGuideWithTask();

    const debugHandle = await branch.open('debug', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    });
    const practiceHandle = await branch.open('practice', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    });

    const debugThread = await branch.getThread(debugHandle.threadId);
    const practiceThread = await branch.getThread(practiceHandle.threadId);
    expect(debugThread?.question).toBe('排查当前任务问题');
    expect(practiceThread?.question).toBe('当前任务额外练习');
    expect(debugThread?.question).not.toContain('Branch:');
    expect(practiceThread?.question).not.toContain('Branch:');
  });

  it('appends messages to a branch thread', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: result.guide.tasks[0].actions[0].id
    });

    const appendResult = await branch.append(handle.threadId, 'user', '如何测试？');
    expect(appendResult.threadId).toBe(handle.threadId);
    expect(appendResult.messageId).toBeTruthy();
    expect(appendResult.resolved).toBe(false);

    const messages = await branch.getMessages(handle.threadId);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('closes a branch with close strategy', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: result.guide.tasks[0].actions[0].id
    });

    await branch.close(handle.threadId, 'close', { summary: '已解决' });

    const thread = await branch.getThread(handle.threadId);
    expect(thread!.status).toBe('resolved');
    expect(thread!.resolutionSummary).toBe('已解决');
  });

  it('uses a readable Chinese summary when closing without explicit text', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('debug', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    }, 'Windows 下命令无法执行');

    await branch.close(handle.threadId, 'close');

    const thread = await branch.getThread(handle.threadId);
    expect(thread?.resolutionSummary).toBe('已结束：Windows 下命令无法执行');
    expect(thread?.resolutionSummary).not.toContain('Closed');
  });

  it('stores a branch fact as an inferred candidate that still requires user confirmation', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('debug', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    }, '当前模型提供商是 DeepSeek');

    await branch.close(handle.threadId, 'propose_fact', {
      summary: 'DeepSeek',
      factProposal: { sourceType: 'insight', key: '模型提供商', summary: 'DeepSeek' }
    });

    const facts = await store.listFactsForGoal(result.goal.id);
    expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ key: '模型提供商', value: 'DeepSeek', source: 'inferred' })]));
  });

  it('does not create a fact proposal without explicit key and summary', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('debug', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    }, '当前模型提供商是 DeepSeek');

    await expect(
      branch.close(handle.threadId, 'propose_fact', {
        summary: 'DeepSeek',
        factProposal: { sourceType: 'insight', key: '', summary: 'DeepSeek' }
      })
    ).rejects.toThrow('提议长期偏好需要填写偏好项目和总结内容');

    expect(await store.listFactsForGoal(result.goal.id)).toHaveLength(0);
    expect((await branch.getThread(handle.threadId))?.status).toBe('open');
  });

  it('extracts knowledge when closing with extract_knowledge strategy', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: result.guide.tasks[0].actions[0].id
    });

    await branch.close(handle.threadId, 'extract_knowledge', { summary: '这是一个重要的知识点' });

    const thread = await branch.getThread(handle.threadId);
    expect(thread!.status).toBe('resolved');

    const knowledge = await store.getKnowledgeItemsForGoal({ goalId: result.goal.id });
    expect(knowledge.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves a branch directly', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('debug', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: null
    });

    await branch.resolve(handle.threadId, '调试完成');

    const thread = await branch.getThread(handle.threadId);
    expect(thread!.status).toBe('resolved');
    expect(thread!.resolutionSummary).toBe('调试完成');
  });

  it('promote creates a task from branch and resolves thread', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: result.guide.tasks[0].actions[0].id
    });

    await branch.promote(handle.threadId, { taskId: result.guide.tasks[0].id, summary: '提升为分支任务' });

    const thread = await branch.getThread(handle.threadId);
    expect(thread!.status).toBe('resolved');
    expect(thread!.resolutionSummary).toBe('提升为分支任务');
    expect(thread!.resolutionSummary).not.toContain('Promoted');

    const guide = await store.getDailyGuideById(result.guide.id);
    expect(guide!.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('close with promote_task throws to enforce user confirmation', async () => {
    const result = await createTestGuideWithTask();
    const handle = await branch.open('question', {
      goalId: result.goal.id,
      taskId: result.guide.tasks[0].id,
      actionId: result.guide.tasks[0].actions[0].id
    });

    await expect(
      branch.close(handle.threadId, 'promote_task', { promoteTaskId: result.guide.tasks[0].id })
    ).rejects.toThrow('需要用户确认');
  });

  it('returns a Chinese error when the branch does not exist', async () => {
    await expect(branch.close('missing-thread', 'close')).rejects.toThrow('找不到需要关闭的问题分支');
    await expect(branch.promote('missing-thread', { taskId: 'task-1' })).rejects.toThrow('找不到需要提升的问题分支');
  });
});
