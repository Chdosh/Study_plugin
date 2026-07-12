import type { Id, QuestionThread, QuestionMessage } from '../../../shared/types';
import type { StudyStore } from '../../services/store';
import type { FactProposal } from '../context/context';

export type BranchKind = 'question' | 'debug' | 'practice';
export type ClosureStrategy = 'close' | 'extract_knowledge' | 'propose_fact' | 'promote_task';

export interface BranchHandle {
  threadId: Id;
  kind: BranchKind;
  anchor: { goalId: Id; taskId: Id; actionId: Id | null };
}

export interface AppendResult {
  threadId: Id;
  messageId: Id;
  resolved: boolean;
}

export class LearningBranchModule {
  constructor(private readonly store: StudyStore) {}

  async open(kind: BranchKind, anchor: { goalId: Id; taskId: Id; actionId: Id | null }, initialContent?: string): Promise<BranchHandle> {
    const defaultTitle: Record<BranchKind, string> = {
      question: '当前步骤问题',
      debug: '排查当前任务问题',
      practice: '当前任务额外练习'
    };
    const thread = await this.store.openQuestion(
      anchor.actionId,
      initialContent?.trim() || defaultTitle[kind],
      {
        goalId: anchor.goalId,
        kind,
        metadata: { kind, anchor }
      }
    );
    return { threadId: thread.id, kind, anchor };
  }

  async append(threadId: Id, role: 'user' | 'assistant', content: string): Promise<AppendResult> {
    const msg = await this.store.addQuestionMessage(threadId, role, content);
    const thread = await this.store.getQuestionThread(threadId);
    return { threadId, messageId: msg.id, resolved: thread?.status === 'resolved' };
  }

  async close(threadId: Id, strategy: ClosureStrategy, options?: { summary?: string; factProposal?: FactProposal; promoteTaskId?: Id }): Promise<void> {
    const thread = await this.store.getQuestionThread(threadId);
    if (!thread) throw new Error('找不到需要关闭的问题分支。');
    const summary = options?.summary?.trim() || thread.resolutionSummary || `已结束：${thread.question}`;

    switch (strategy) {
      case 'close':
        await this.store.resolveQuestion(threadId, summary);
        break;
      case 'extract_knowledge': {
        await this.store.extractKnowledgeFromBranch(summary, threadId, thread.goalId ?? '');
        await this.store.resolveQuestion(threadId, summary);
        break;
      }
      case 'propose_fact': {
        if (options?.factProposal) {
          await this.store.proposeFact(thread.goalId ?? '', {
            scope: 'goal',
            key: options.factProposal.key,
            value: options.factProposal.summary,
            source: 'inferred',
            confidence: 0.6
          });
        }
        await this.store.resolveQuestion(threadId, summary);
        break;
      }
      case 'promote_task': {
        throw new Error('promote_task 需要用户确认，请调用 promote() 方法而非 close()。');
      }
    }
  }

  async resolve(threadId: Id, summary: string): Promise<void> {
    return this.store.resolveQuestion(threadId, summary);
  }

  async promote(threadId: Id, target: { taskId: Id; summary?: string }): Promise<void> {
    const thread = await this.store.getQuestionThread(threadId);
    const summary = target.summary ?? thread?.resolutionSummary ?? thread?.question ?? '';
    if (!thread) throw new Error('找不到需要提升的问题分支。');
    await this.store.createTaskFromBranch(summary, { goalId: thread.goalId ?? '', taskId: target.taskId });
    await this.store.promoteQuestionThread(threadId, { taskId: target.taskId });
    await this.store.resolveQuestion(threadId, summary);
  }

  getThread(threadId: Id): Promise<QuestionThread | null> {
    return this.store.getQuestionThread(threadId);
  }

  getMessages(threadId: Id): Promise<QuestionMessage[]> {
    return this.store.getQuestionMessages(threadId);
  }
}
