import { describe, expect, it } from 'vitest';
import { getLatestQuestionAnswer } from './RecordsPage';

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
