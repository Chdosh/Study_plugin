import type { Id, QuestionThread, QuestionMessage } from '../../../shared/types';
import type { StudyStore } from '../../services/store';

export interface BranchHandle {
  threadId: Id;
  kind: 'question' | 'debug' | 'practice';
  anchor: { taskId: Id; actionId: Id | null };
}

export interface AppendResult {
  threadId: Id;
  messageId: Id;
  resolved: boolean;
}

export class LearningBranchModule {
  constructor(private readonly store: StudyStore) {}

  async open(kind: 'question' | 'debug' | 'practice', anchor: { taskId: Id; actionId: Id | null }): Promise<BranchHandle> {
    const thread = await this.store.openQuestion(anchor.actionId ?? '', '');
    return { threadId: thread.id, kind, anchor };
  }

  async append(threadId: Id, role: 'user' | 'assistant', content: string): Promise<AppendResult> {
    const msg = await this.store.addQuestionMessage(threadId, role, content);
    const thread = await this.store.getQuestionThread(threadId);
    return { threadId, messageId: msg.id, resolved: thread?.status === 'resolved' };
  }

  resolve(threadId: Id, summary: string): Promise<void> {
    return this.store.resolveQuestion(threadId, summary);
  }

  promote(threadId: Id, target: { taskId: Id }): Promise<void> {
    return this.store.promoteQuestionThread(threadId, target);
  }

  getThread(threadId: Id): Promise<QuestionThread | null> {
    return this.store.getQuestionThread(threadId);
  }

  getMessages(threadId: Id): Promise<QuestionMessage[]> {
    return this.store.getQuestionMessages(threadId);
  }
}
