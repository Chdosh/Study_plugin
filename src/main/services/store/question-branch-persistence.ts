import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { QuestionMessage, QuestionThread } from '../../../shared/types';
import type { AnswerStepQuestionAgentOutput } from '../../../shared/schemas';
import type { Database } from '../../db/client';
import {
  conversationMessages,
  conversationThreads,
  learningActions,
  learningTasks
} from '../../db/schema';
import { createId, nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';
import { mapQuestionMessage, mapQuestionThread } from './serialization';

type RecordBranchKnowledge = (params: {
  goalId: string;
  items: Array<{
    key: string;
    summary: string;
    sourceType: 'insight';
    sourceId: string;
  }>;
}) => Promise<unknown>;

export class QuestionBranchPersistence {
  constructor(
    private readonly db: Database,
    private readonly runtime: RuntimePersistence,
    private readonly recordKnowledgeItems: RecordBranchKnowledge
  ) {}

  async promoteQuestionThread(threadId: string, target: { taskId: string }): Promise<void> {
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Conversation thread not found: ${threadId}`);
    await this.updateQuestionThreadMetadata(threadId, {
      promotedTaskId: target.taskId,
      previousMetadata: await this.readMetadata(threadId)
    });
  }

  async updateQuestionThreadKind(
    threadId: string,
    kind: 'question' | 'debug' | 'practice'
  ): Promise<void> {
    await this.db.update(conversationThreads).set({ kind, updatedAt: nowIso() })
      .where(eq(conversationThreads.id, threadId));
  }

  async updateQuestionThreadMetadata(
    threadId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.db.update(conversationThreads).set({
      metadata: JSON.stringify(metadata),
      updatedAt: nowIso()
    }).where(eq(conversationThreads.id, threadId));
  }

  async createTaskFromBranch(
    branchSummary: string,
    anchor: { goalId: string; taskId: string }
  ): Promise<string> {
    const source = (await this.db.select().from(learningTasks)
      .where(eq(learningTasks.id, anchor.taskId)).limit(1))[0];
    if (!source) throw new Error('找不到用于承接分支的当前 Task。');
    const max = (await this.db.select({ position: learningTasks.position }).from(learningTasks)
      .where(source.guideId ? eq(learningTasks.guideId, source.guideId) : isNull(learningTasks.guideId))
      .orderBy(desc(learningTasks.position)).limit(1))[0]?.position ?? -1;
    const now = nowIso();
    const taskId = createId('task');
    await this.db.transaction(async (tx) => {
      await tx.insert(learningTasks).values({
        id: taskId,
        goalId: anchor.goalId,
        guideId: source.guideId,
        roadmapStageId: source.roadmapStageId,
        title: branchSummary.slice(0, 60),
        objective: branchSummary.slice(0, 200),
        scope: '从对话显式提升',
        estimatedMinMinutes: 15,
        estimatedTargetMinutes: 30,
        estimatedMaxMinutes: 45,
        deliverable: branchSummary.slice(0, 200),
        doneWhenJson: JSON.stringify(['用户显式确认达到分支目标']),
        quickHint: '',
        evaluationMode: 'local',
        difficulty: source.difficulty,
        taskMode: 'learning',
        status: 'planned',
        closureKind: null,
        nextStartPoint: branchSummary.slice(0, 100),
        position: max + 1,
        createdAt: now,
        updatedAt: now
      });
      await tx.insert(learningActions).values({
        id: createId('action'),
        taskId,
        title: '执行提升后的学习任务',
        instruction: branchSummary.slice(0, 300),
        checkpoint: '确认分支问题已转化为可验证结果',
        requirement: 'optional',
        status: 'planned',
        progressNote: null,
        completedAt: null,
        position: 0
      });
    });
    return taskId;
  }

  async createTaskFromTemporary(
    threadId: string,
    goalId: string
  ): Promise<{ taskId: string; guideId: string | null }> {
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Conversation thread not found: ${threadId}`);
    if (thread.taskId || thread.stepId) {
      throw new Error('只有临时学习 Thread 可以转成正式 Task。');
    }
    const snapshot = await this.runtime.getSnapshot();
    const guideId = snapshot.dailyGuide?.goalId === goalId
      && snapshot.dailyGuide.sessionStatus === 'active'
      ? snapshot.dailyGuide.id
      : null;
    const roadmapStageId = guideId ? snapshot.dailyGuideTask?.roadmapStageId ?? null : null;
    const taskRows = await this.db.select({ position: learningTasks.position }).from(learningTasks)
      .where(guideId
        ? eq(learningTasks.guideId, guideId)
        : and(eq(learningTasks.goalId, goalId), isNull(learningTasks.guideId)))
      .orderBy(desc(learningTasks.position))
      .limit(1);
    const messages = await this.getQuestionMessages(threadId);
    const latestAnswer = [...messages].reverse()
      .find((message) => message.role === 'assistant')?.content ?? thread.question;
    const now = nowIso();
    const taskId = createId('task');
    const actionId = createId('action');
    const existingMetadata = await this.readMetadata(threadId);
    await this.db.transaction(async (tx) => {
      await tx.insert(learningTasks).values({
        id: taskId,
        goalId,
        guideId,
        roadmapStageId,
        title: thread.question.slice(0, 60),
        objective: `把临时学习“${thread.question.slice(0, 100)}”转化为可验证成果`,
        scope: '由临时学习显式转入正式路径',
        estimatedMinMinutes: 15,
        estimatedTargetMinutes: 30,
        estimatedMaxMinutes: 60,
        deliverable: latestAnswer.slice(0, 200),
        doneWhenJson: JSON.stringify(['形成可检查的理解说明或练习结果']),
        quickHint: latestAnswer.slice(0, 200),
        evaluationMode: 'ai',
        difficulty: 'standard',
        taskMode: 'learning',
        status: 'planned',
        closureKind: null,
        closureReason: null,
        nextStartPoint: thread.question.slice(0, 100),
        position: (taskRows[0]?.position ?? -1) + 1,
        createdAt: now,
        updatedAt: now
      });
      await tx.insert(learningActions).values({
        id: actionId,
        taskId,
        title: '整理并验证临时学习成果',
        instruction: latestAnswer.slice(0, 300),
        checkpoint: '能够用自己的话说明结论，并给出一个可检查的例子',
        requirement: 'required',
        status: 'planned',
        progressNote: null,
        completedAt: null,
        position: 0
      });
      await tx.insert(conversationMessages).values({
        id: createId('message'),
        threadId,
        role: 'assistant',
        content: guideId
          ? '此临时学习已转成正式 Task，并加入当前 Learning Guide；原始对话保持不变。'
          : '此临时学习已转成未安排的正式 Task；进入对应 Goal 后再安排，原始对话保持不变。',
        linkedGoalId: goalId,
        linkedTaskId: taskId,
        linkedActionId: actionId,
        createdAt: now
      });
      await tx.update(conversationThreads).set({
        status: 'resolved',
        resolutionSummary: '已显式转成正式 Task',
        metadata: JSON.stringify({
          ...(existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {}),
          standalone: true,
          promotedTaskId: taskId
        }),
        updatedAt: now,
        resolvedAt: now
      }).where(eq(conversationThreads.id, threadId));
    });
    return { taskId, guideId };
  }

  async extractKnowledgeFromBranch(summary: string, sourceId: string, goalId: string): Promise<void> {
    await this.recordKnowledgeItems({
      goalId,
      items: [{
        key: `branch_${sourceId.slice(0, 8)}`,
        summary: summary.slice(0, 100),
        sourceType: 'insight',
        sourceId
      }]
    });
  }

  async openQuestion(
    actionId: string | null,
    question: string,
    opts?: {
      goalId?: string;
      kind?: 'question' | 'debug' | 'practice';
      metadata?: Record<string, unknown>;
      standalone?: boolean;
    }
  ): Promise<QuestionThread> {
    const clean = question.trim();
    if (!clean) throw new Error('问题不能为空。');
    const snapshot = await this.runtime.getSnapshot();
    const now = nowIso();
    const threadId = createId('conversation');
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationThreads).values({
        id: threadId,
        status: 'open',
        kind: opts?.kind ?? 'question',
        question: clean,
        resolutionSummary: null,
        metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
        isPartial: false,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null
      });
      await tx.insert(conversationMessages).values({
        id: createId('message'),
        threadId,
        role: 'user',
        content: clean,
        linkedGoalId: opts?.standalone ? null : opts?.goalId ?? snapshot.goal?.id ?? null,
        linkedTaskId: opts?.standalone ? null : snapshot.dailyGuideTask?.id ?? null,
        linkedActionId: opts?.standalone ? null : actionId ?? snapshot.dailyGuideAction?.id ?? null,
        createdAt: now
      });
    });
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error('Conversation 保存失败。');
    return thread;
  }

  async addQuestionMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<QuestionMessage> {
    const anchor = await this.getAnchor(threadId);
    const now = nowIso();
    const row = {
      id: createId('message'),
      threadId,
      role,
      content,
      linkedGoalId: anchor.goalId,
      linkedTaskId: anchor.taskId,
      linkedActionId: anchor.actionId,
      createdAt: now
    };
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values(row);
      await tx.update(conversationThreads).set({ updatedAt: now })
        .where(eq(conversationThreads.id, threadId));
    });
    return mapQuestionMessage(row);
  }

  async getQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    const rows = await this.db.select().from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(asc(conversationMessages.createdAt));
    return rows.map(mapQuestionMessage);
  }

  async saveQuestionAnswer(
    threadId: string,
    output: AnswerStepQuestionAgentOutput
  ): Promise<QuestionThread> {
    await this.addQuestionMessage(threadId, 'assistant', output.answer);
    if (output.resolved) {
      await this.resolveQuestion(threadId, output.resolutionSummary || output.answer);
    }
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Conversation thread not found: ${threadId}`);
    return thread;
  }

  async resolveQuestion(threadId: string, summary?: string): Promise<void> {
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Conversation thread not found: ${threadId}`);
    const now = nowIso();
    await this.db.update(conversationThreads).set({
      status: 'resolved',
      resolutionSummary: summary?.trim() || thread.resolutionSummary || thread.question,
      updatedAt: now,
      resolvedAt: now
    }).where(eq(conversationThreads.id, threadId));
  }

  async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
    const row = (await this.db.select().from(conversationThreads)
      .where(eq(conversationThreads.id, threadId)).limit(1))[0];
    if (!row) return null;
    return mapQuestionThread(row, await this.getAnchor(threadId));
  }

  async getLatestStandaloneQuestionThread(): Promise<QuestionThread | null> {
    const rows = await this.db.select().from(conversationThreads)
      .orderBy(desc(conversationThreads.updatedAt));
    const row = rows.find((item) => {
      if (!item.metadata) return false;
      try {
        return (JSON.parse(item.metadata) as { standalone?: unknown }).standalone === true;
      } catch {
        return false;
      }
    });
    return row ? mapQuestionThread(row, await this.getAnchor(row.id)) : null;
  }

  async linkQuestionThreadToGoal(threadId: string, goalId: string): Promise<QuestionThread> {
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Conversation thread not found: ${threadId}`);
    if (thread.goalId === goalId) return thread;
    const now = nowIso();
    await this.db.transaction(async (tx) => {
      await tx.insert(conversationMessages).values({
        id: createId('message'),
        threadId,
        role: 'assistant',
        content: '此临时学习记录已关联到当前学习目标；原始对话内容保持不变。',
        linkedGoalId: goalId,
        linkedTaskId: null,
        linkedActionId: null,
        createdAt: now
      });
      await tx.update(conversationThreads).set({ updatedAt: now })
        .where(eq(conversationThreads.id, threadId));
    });
    const updated = await this.getQuestionThread(threadId);
    if (!updated) throw new Error(`Conversation thread not found: ${threadId}`);
    return updated;
  }

  private async getAnchor(threadId: string): Promise<{
    goalId: string | null;
    taskId: string | null;
    actionId: string | null;
  }> {
    const rows = await this.db.select({
      goalId: conversationMessages.linkedGoalId,
      taskId: conversationMessages.linkedTaskId,
      actionId: conversationMessages.linkedActionId
    }).from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(desc(conversationMessages.createdAt));
    return rows.find((row) => row.goalId || row.taskId || row.actionId)
      ?? rows.at(-1)
      ?? { goalId: null, taskId: null, actionId: null };
  }

  private async readMetadata(threadId: string): Promise<unknown> {
    const row = (await this.db.select({ metadata: conversationThreads.metadata })
      .from(conversationThreads).where(eq(conversationThreads.id, threadId)).limit(1))[0];
    if (!row?.metadata) return null;
    try {
      return JSON.parse(row.metadata);
    } catch {
      return null;
    }
  }
}
