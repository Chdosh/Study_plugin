import { describe, expect, it } from 'vitest';
import {
  canDecideEvaluationRecommendation,
  canRetrySubmissionEvaluation,
  canRetryEvaluationRecommendation,
  getLatestQuestionAnswer
} from './RecordsPage';
import type { TimelineEvent } from './RecordsPage';

describe('RecordsPage question history', () => {
  it('shows the latest persisted assistant answer even when the thread has no resolution summary', () => {
    const exportData = {
      questionMessages: [
        { threadId: 'thread-1', role: 'user', content: 'try-except 是什么？', createdAt: '2026-07-16T23:49:00.000Z' },
        { threadId: 'thread-1', role: 'assistant', content: 'try-except 用于捕获并处理异常。', createdAt: '2026-07-16T23:49:01.000Z' },
        { threadId: 'thread-1', role: 'assistant', content: '在当前步骤中用它处理网络和参数错误。', createdAt: '2026-07-16T23:49:02.000Z' }
      ]
    };

    expect(getLatestQuestionAnswer(exportData, 'thread-1')).toBe('在当前步骤中用它处理网络和参数错误。');
  });
});

describe('RecordsPage submission evaluation recovery', () => {
  const submission: TimelineEvent = {
    id: 'submission-1',
    at: '2026-07-31T09:00:00.000Z',
    kind: '提交',
    title: 'Git 练习 · 第 1 次尝试',
    summary: '成果原文已保存',
    submissionId: 'submission-1'
  };

  it('offers retry only for a failed persisted submission', () => {
    expect(canRetrySubmissionEvaluation({ ...submission, evaluationStatus: 'failed' })).toBe(true);
    expect(canRetrySubmissionEvaluation({ ...submission, evaluationStatus: 'evaluating' })).toBe(false);
    expect(canRetrySubmissionEvaluation({ ...submission, evaluationStatus: 'completed' })).toBe(false);
  });
});

describe('RecordsPage recommendation decision visibility', () => {
  const baseEvent: TimelineEvent = {
    id: 'evaluation-e1',
    at: '2026-07-28T08:00:00.000Z',
    kind: '评价',
    title: '任务 · 第 1 次尝试',
    summary: '反馈',
    evaluationId: 'e1',
    recommendedAction: 'complete_task'
  };

  it('shows decision buttons while the recommendation is undecided', () => {
    expect(canDecideEvaluationRecommendation(baseEvent)).toBe(true);
    expect(canRetryEvaluationRecommendation(baseEvent)).toBe(false);
  });

  it('keeps decision buttons available after the user defers, so the decision can be finished later', () => {
    expect(canDecideEvaluationRecommendation({ ...baseEvent, recommendationDecision: 'deferred' })).toBe(true);
  });

  it('hides decision buttons once the recommendation is declined or applied', () => {
    expect(canDecideEvaluationRecommendation({ ...baseEvent, recommendationDecision: 'declined' })).toBe(false);
    expect(canDecideEvaluationRecommendation({
      ...baseEvent,
      recommendationDecision: 'accepted',
      applicationStatus: 'applied'
    })).toBe(false);
  });

  it('offers a retry only when an accepted recommendation failed to apply', () => {
    expect(canRetryEvaluationRecommendation({
      ...baseEvent,
      recommendationDecision: 'accepted',
      applicationStatus: 'failed'
    })).toBe(true);
    expect(canRetryEvaluationRecommendation({
      ...baseEvent,
      recommendationDecision: 'accepted',
      applicationStatus: 'applied'
    })).toBe(false);
    expect(canRetryEvaluationRecommendation({
      ...baseEvent,
      recommendationDecision: 'deferred'
    })).toBe(false);
  });

  it('never offers decisions for user corrections or non-evaluation events', () => {
    expect(canDecideEvaluationRecommendation({ ...baseEvent, kind: '评价纠正' })).toBe(false);
    expect(canDecideEvaluationRecommendation({ ...baseEvent, evaluationId: undefined })).toBe(false);
    expect(canRetryEvaluationRecommendation({ ...baseEvent, kind: '评价纠正' })).toBe(false);
  });
});
