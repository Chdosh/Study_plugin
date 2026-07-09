import { describe, expect, it } from 'vitest';
import { normalizeDailyPlanOutput } from './normalize-plan';
import type { TaskItem } from '../../shared/types';

const tasks: TaskItem[] = [
  {
    id: 'task_1',
    goalId: null,
    sourceImportId: null,
    title: '学习 TypeScript 泛型',
    description: '阅读泛型约束并写例子',
    status: 'backlog',
    priority: 3,
    difficulty: 'foundation',
    estimateMinutes: 40,
    acceptanceCriteria: '能解释 extends 约束并写出一个函数示例',
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z'
  },
  {
    id: 'task_2',
    goalId: null,
    sourceImportId: null,
    title: '练习 React 状态管理',
    description: '完成一个 useState/useMemo 小练习',
    status: 'backlog',
    priority: 3,
    difficulty: 'standard',
    estimateMinutes: 30,
    acceptanceCriteria: '能运行一个小组件并说明状态更新流程',
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z'
  }
];

describe('normalizeDailyPlanOutput', () => {
  it('fills missing time, duration, and difficulty fields from local context', () => {
    const output = normalizeDailyPlanOutput({
      raw: {
        blocks: [
          {
            taskTitle: '学习 TypeScript 泛型',
            objective: '理解泛型约束',
            action: '阅读材料并写一个最小示例',
            expectedOutput: '一段泛型函数代码',
            material: 'TypeScript 文档',
            successCheck: '能解释 T extends object',
            fallback: '只整理 3 条概念笔记'
          },
          {
            任务标题: '练习 React 状态管理',
            目标: '完成状态管理练习',
            动作: '写一个计数器组件'
          }
        ]
      },
      windows: [{ start: '20:00', end: '21:00' }],
      tasks,
      blockMinutes: 20
    });

    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[0]).toMatchObject({
      taskTitle: '学习 TypeScript 泛型',
      startTime: '20:00',
      endTime: '20:20',
      durationMinutes: 20,
      difficulty: 'foundation'
    });
    expect(output.blocks[1]).toMatchObject({
      taskTitle: '练习 React 状态管理',
      startTime: '20:20',
      endTime: '20:40',
      durationMinutes: 20,
      expectedOutput: '能运行一个小组件并说明状态更新流程',
      difficulty: 'standard'
    });
  });

  it('keeps valid explicit timing when the model provides it', () => {
    const output = normalizeDailyPlanOutput({
      raw: {
        blocks: [
          {
            taskTitle: '学习 TypeScript 泛型',
            startTime: '20:10',
            endTime: '20:25',
            durationMinutes: 15,
            objective: '复习泛型',
            action: '写代码',
            expectedOutput: '代码片段',
            difficulty: 'foundation',
            material: '本地笔记',
            successCheck: '能解释',
            fallback: '读示例'
          }
        ]
      },
      windows: [{ start: '20:00', end: '21:00' }],
      tasks,
      blockMinutes: 20
    });

    expect(output.blocks[0]).toMatchObject({
      startTime: '20:10',
      endTime: '20:25',
      durationMinutes: 15
    });
  });

  it('binds the only available task when the model rewrites the task title', () => {
    const output = normalizeDailyPlanOutput({
      raw: {
        blocks: [
          {
            taskTitle: '继续练习响应头配置',
            objective: '选择合适缓存响应头',
            action: '写出 HTML 和带 hash 静态资源的缓存策略'
          }
        ]
      },
      windows: [{ start: '20:00', end: '20:30' }],
      tasks: [tasks[0]],
      blockMinutes: 10
    });

    expect(output.blocks[0]).toMatchObject({
      taskTitle: '学习 TypeScript 泛型',
      expectedOutput: '能解释 extends 约束并写出一个函数示例',
      difficulty: 'foundation'
    });
  });

  it('falls back to local task slices when the model omits blocks', () => {
    const output = normalizeDailyPlanOutput({
      raw: {
        blocks: []
      },
      windows: [{ start: '20:00', end: '21:00' }],
      tasks,
      blockMinutes: 10
    });

    expect(output.blocks).toHaveLength(2);
    expect(output.blocks[0]).toMatchObject({
      taskTitle: '学习 TypeScript 泛型',
      startTime: '20:00',
      endTime: '20:10',
      durationMinutes: 10
    });
    expect(output.blocks[1]).toMatchObject({
      taskTitle: '练习 React 状态管理',
      startTime: '20:10',
      endTime: '20:20',
      durationMinutes: 10
    });
  });
});
