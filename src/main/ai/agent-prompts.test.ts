import { describe, expect, it } from 'vitest';
import { buildDailyGuidePrompt, buildEvaluateSubmissionPrompt, buildRollingPlanPrompt } from './agent-prompts';
import type { KnowledgeItem } from '../../shared/types';

const makeProfile = () => ({
  id: 'p1',
  key: 'foundation' as const,
  name: '基础档位',
  description: '基础',
  content: '你是一个学习管家。',
  version: 1,
  activeVersionId: 'v1',
  createdAt: '',
  updatedAt: ''
});

const sampleKnowledge: KnowledgeItem = {
  id: 'k1',
  goalId: 'g1',
  key: 'hooks',
  summary: 'React Hooks 概念混淆',
  detail: null,
  sourceType: 'misconception',
  sourceId: null,
  occurrenceCount: 3,
  lastSeenAt: '2026-07-08',
  status: 'active',
  createdAt: '2026-07-07',
  updatedAt: '2026-07-08'
};

describe('agent-prompts', () => {
  it('buildDailyGuidePrompt includes review items text when reviewKnowledgeItems provided', () => {
    const prompt = buildDailyGuidePrompt({
      date: '2026-07-08',
      windows: [{ start: '20:00', end: '22:00' }],
      blockMinutes: 10,
      goal: { title: '学 React' },
      brief: null,
      roadmap: [{ id: 'r1', goalId: 'g1', title: '基础', objective: '掌握基础', direction: '从零开始', successCriteria: '能写组件', status: 'active', position: 0, createdAt: '', updatedAt: '' }],
      targetDay: { id: 'sp1', goalId: 'g1', roadmapStageId: null, dayIndex: 1, date: null, sessionStatus: 'pending', title: '入门', focus: 'JSX', tasks: ['写组件'], expectedOutput: '一个组件', successCriteria: '能渲染', locked: false, createdAt: '' },
      profile: makeProfile(),
      reviewKnowledgeItems: [sampleKnowledge]
    });
    expect(prompt).toContain('多次出错');
    expect(prompt).toContain('hooks');
    expect(prompt).toContain('3 次');
    expect(prompt).toContain('5-10 分钟复习');
  });

  it('buildEvaluateSubmissionPrompt includes review items when provided', () => {
    const prompt = buildEvaluateSubmissionPrompt({
      submission: 'my submission',
      context: {},
      profile: makeProfile(),
      knowledgeItems: [sampleKnowledge],
      reviewKnowledgeItems: [{ ...sampleKnowledge, occurrenceCount: 3 }]
    });
    expect(prompt).toContain('多次出错');
    expect(prompt).toContain('hooks');
    expect(prompt).toContain('3 次');
    expect(prompt).toContain('多次提醒');
  });

  it('buildRollingPlanPrompt includes review queue text when reviewKnowledgeItems provided', () => {
    const prompt = buildRollingPlanPrompt({
      goal: { title: '学 React' },
      brief: null,
      activeStage: { id: 'r1', goalId: 'g1', title: '基础', objective: '掌握基础', direction: '从零开始', successCriteria: '能写组件', status: 'active', position: 0, createdAt: '', updatedAt: '' },
      completedSummary: '已完成任务',
      profile: makeProfile(),
      reviewKnowledgeItems: [sampleKnowledge]
    });
    expect(prompt).toContain('多次出错');
    expect(prompt).toContain('hooks');
    expect(prompt).toContain('复习');
    expect(prompt).toContain('滚动计划中适当安排');
  });

  it('buildDailyGuidePrompt omits review section when no review items', () => {
    const prompt = buildDailyGuidePrompt({
      date: '2026-07-08',
      windows: [{ start: '20:00', end: '22:00' }],
      blockMinutes: 10,
      goal: { title: '学 React' },
      brief: null,
      roadmap: [],
      targetDay: { id: 'sp1', goalId: 'g1', roadmapStageId: null, dayIndex: 1, date: null, sessionStatus: 'pending', title: '入门', focus: 'JSX', tasks: ['写组件'], expectedOutput: '一个组件', successCriteria: '能渲染', locked: false, createdAt: '' },
      profile: makeProfile()
    });
    expect(prompt).not.toContain('5-10 分钟复习');
  });
});
