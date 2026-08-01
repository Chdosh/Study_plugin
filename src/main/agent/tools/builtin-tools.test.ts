import { describe, expect, it, vi } from 'vitest';
import { createBuiltinToolRegistry } from './builtin-tools';

const studyContext = {
  kind: 'study' as const,
  scopeType: 'learning_action',
  scopeId: 'action-1',
  goalId: 'trusted-goal',
  contextVersion: 8,
  runReviewId: 'run-1',
  toolReviewId: 'tool-1',
  toolSequence: 1
};

function createRegistry() {
  return createBuiltinToolRegistry(
    vi.fn().mockResolvedValue([]),
    vi.fn().mockResolvedValue({
      id: 'supplement-1',
      taskId: 'task-1',
      title: '补充示例',
      instruction: '运行示例',
      checkpoint: '说明结果',
      requirement: 'optional',
      status: 'planned',
      progressNote: null,
      completedAt: null,
      origin: 'agent_supplement',
      sourceAiReviewId: 'tool-1',
      position: 0
    })
  );
}

describe('built-in Agent Loop tools', () => {
  it('在 study 上下文挂载完整教学能力，但不挂载规划提案', () => {
    const mounted = createRegistry().listForContext('study');
    expect(mounted).toEqual(expect.arrayContaining([
      'explain',
      'quiz',
      'practice',
      'evaluate',
      'search_kb',
      'ask_user',
      'insert_guide_supplement'
    ]));
    expect(mounted).not.toContain('propose_roadmap');
  });

  it('search_kb 只使用可信上下文中的 Goal ID', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const registry = createBuiltinToolRegistry(search, vi.fn());
    await registry.execute(
      'search_kb',
      { goalId: 'model-injected-goal', query: '闭包', limit: 3 },
      studyContext
    );
    expect(search).toHaveBeenCalledWith({
      goalId: 'trusted-goal',
      query: '闭包',
      limit: 3
    });
  });

  it('为 quiz 和 planning 输出执行独立 schema 校验', async () => {
    const registry = createRegistry();
    expect(registry.get('quiz')?.continuation).toBe('continue');
    await expect(registry.execute('quiz', {
      explanation: '检查理解',
      questions: [],
      userAction: '作答',
      requiresSubmission: false
    }, studyContext)).rejects.toThrow();

    await expect(registry.execute('propose_roadmap', {
      goalSummary: '缺少阶段',
      stages: []
    }, {
      ...studyContext,
      kind: 'planning'
    })).rejects.toThrow();
  });

  it('兼容模型为问题回答和正式评价添加的命名包装层', async () => {
    const registry = createRegistry();
    await expect(registry.execute('explain', {
      questionAnswer: {
        answer: '暂存区用于选择本次提交的改动。'
      }
    }, studyContext)).resolves.toMatchObject({
      output: {
        answer: '暂存区用于选择本次提交的改动。',
        returnToStepInstruction: '回答后请返回当前步骤继续学习。'
      }
    });

    await expect(registry.execute('evaluate', {
      submission: {
        result: 'passed',
        evidence: ['配置和仓库状态均已验证'],
        correctParts: ['完成关键验证'],
        misconceptions: [],
        missingRequirements: [],
        feedback: '达到当前任务标准。',
        recommendedAction: 'complete_task'
      }
    }, {
      ...studyContext,
      kind: 'evaluation'
    })).resolves.toMatchObject({
      output: {
        result: 'passed',
        recommendedAction: 'complete_task'
      }
    });
  });

  it('临时补充写入只接收 Registry 注入的 toolReviewId 和 contextVersion', async () => {
    const insert = vi.fn().mockResolvedValue({
      id: 'supplement-1',
      taskId: 'task-1',
      title: '补充示例',
      instruction: '运行示例',
      checkpoint: '说明结果',
      requirement: 'optional',
      status: 'planned',
      progressNote: null,
      completedAt: null,
      origin: 'agent_supplement',
      sourceAiReviewId: 'tool-1',
      position: 0
    });
    const registry = createBuiltinToolRegistry(vi.fn(), insert);
    await registry.execute('insert_guide_supplement', {
      kind: 'example',
      title: '补充示例',
      instruction: '运行示例',
      checkpoint: '说明结果',
      reason: '当前概念仍然抽象',
      sourceAiReviewId: 'model-injected-review'
    }, studyContext);

    expect(insert).toHaveBeenCalledWith({
      title: '补充示例',
      instruction: '运行示例',
      checkpoint: '说明结果',
      sourceAiReviewId: 'tool-1',
      expectedContextVersion: 8
    });
  });

  it('ask_user 输出必须包含可恢复的结构化意图', async () => {
    const registry = createRegistry();
    await expect(registry.execute('ask_user', {
      question: '你更熟悉哪种语言？',
      reason: '选择示例',
      answerMode: 'free_text',
      canSkip: true
    }, studyContext)).rejects.toThrow();
  });
});
