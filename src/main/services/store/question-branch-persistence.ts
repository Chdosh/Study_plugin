import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  DailyGuideTask,
  LearningSummary,
  QuestionMessage,
  QuestionThread
} from '../../../shared/types';
import type { AnswerStepQuestionAgentOutput } from '../../../shared/schemas';
import type { Database } from '../../db/client';
import {
  dailyGuideActions,
  dailyGuideTasks,
  learningSummaries,
  questionMessages,
  questionThreads
} from '../../db/schema';
import { createId, nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';
import {
  mapDailyGuideAction,
  mapDailyGuideTask,
  mapLearningSummary,
  mapQuestionMessage,
  mapQuestionThread
} from './serialization';

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
    await this.db
      .update(questionThreads)
      .set({ resolutionSummary: `已提升为正式任务：${target.taskId}`, updatedAt: nowIso() })
      .where(eq(questionThreads.id, threadId));
  }

  async updateQuestionThreadKind(threadId: string, kind: 'question' | 'debug' | 'practice'): Promise<void> {
    await this.db
      .update(questionThreads)
      .set({ kind, updatedAt: nowIso() })
      .where(eq(questionThreads.id, threadId));
  }

  async updateQuestionThreadMetadata(threadId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db
      .update(questionThreads)
      .set({ metadata: JSON.stringify(metadata), updatedAt: nowIso() })
      .where(eq(questionThreads.id, threadId));
  }

  async createTaskFromBranch(branchSummary: string, anchor: { goalId: string; taskId: string }): Promise<string> {
    const now = nowIso();
    const guideTask = await this.getDailyGuideTaskById(anchor.taskId);
    if (!guideTask) throw new Error('找不到用于承接分支的当前主任务。');
    const guideId = guideTask.guideId;

    const existingTasks = await this.db
      .select({ position: dailyGuideTasks.position })
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guideId))
      .orderBy(desc(dailyGuideTasks.position))
      .limit(1);
    const nextPosition = (existingTasks[0]?.position ?? 0) + 1;

    const newTaskId = createId('daily_guide_task');
    await this.db.insert(dailyGuideTasks).values({
      id: newTaskId,
      guideId,
      roadmapStageId: guideTask.roadmapStageId,
      legacyPlanBlockId: null,
      title: branchSummary.slice(0, 30),
      objective: `分支提升任务：${branchSummary.slice(0, 60)}`,
      scope: '分支提升',
      estimatedMinMinutes: 15,
      estimatedTargetMinutes: 30,
      estimatedMaxMinutes: 45,
      deliverable: branchSummary.slice(0, 60),
      doneWhenJson: JSON.stringify([`完成：${branchSummary.slice(0, 30)}`]),
      quickHint: '',
      evaluationMode: 'local',
      submissionPolicy: 'once_after_task',
      carryoverAllowed: true,
      status: 'planned',
      progressPercent: 0,
      currentActionId: null,
      nextStartPoint: null,
      totalElapsedMinutes: 0,
      position: nextPosition,
      createdAt: now,
      updatedAt: now
    });

    await this.db.insert(dailyGuideActions).values({
      id: createId('daily_guide_action'),
      taskId: newTaskId,
      title: '执行分支任务',
      instruction: branchSummary.slice(0, 200),
      checkpoint: '完成分支目标',
      status: 'planned',
      progressNote: null,
      completedAt: null,
      position: 0
    });

    return newTaskId;
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
    opts?: { goalId?: string; kind?: 'question' | 'debug' | 'practice'; metadata?: Record<string, unknown> }
  ): Promise<QuestionThread> {
    const now = nowIso();
    const threadId = createId('question');
    await this.db.insert(questionThreads).values({
      id: threadId,
      goalId: opts?.goalId ?? null,
      stageId: null,
      taskId: null,
      stepId: null,
      dailyGuideActionId: actionId,
      status: 'open',
      kind: opts?.kind ?? 'question',
      metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
      question,
      resolutionSummary: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null
    });
    await this.db.insert(questionMessages).values({
      id: createId('question_msg'),
      threadId,
      role: 'user',
      content: question,
      createdAt: now
    });
    await this.runtime.updateState({ activeQuestionThreadId: threadId });
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error('Question thread was not saved.');
    return thread;
  }

  async addQuestionMessage(threadId: string, role: 'user' | 'assistant', content: string): Promise<QuestionMessage> {
    const row = {
      id: createId('question_message'),
      threadId,
      role,
      content,
      createdAt: nowIso()
    };
    await this.db.insert(questionMessages).values(row);
    await this.db.update(questionThreads).set({ updatedAt: nowIso() }).where(eq(questionThreads.id, threadId));
    return row;
  }

  async getQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    return this.listQuestionMessages(threadId);
  }

  async saveQuestionAnswer(threadId: string, output: AnswerStepQuestionAgentOutput): Promise<QuestionThread> {
    const now = nowIso();
    await this.addQuestionMessage(threadId, 'assistant', output.answer);
    if (output.resolved) {
      const summary = output.resolutionSummary || output.answer;
      await this.resolveQuestion(threadId, summary);
    } else {
      await this.db.update(questionThreads).set({ updatedAt: now }).where(eq(questionThreads.id, threadId));
    }
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Question thread not found after answer: ${threadId}`);
    return thread;
  }

  async resolveQuestion(threadId: string, summary?: string): Promise<void> {
    const now = nowIso();
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Question thread not found: ${threadId}`);
    await this.db
      .update(questionThreads)
      .set({
        status: 'resolved',
        resolutionSummary: summary || thread.resolutionSummary || thread.question,
        updatedAt: now,
        resolvedAt: now
      })
      .where(eq(questionThreads.id, threadId));
    await this.db.insert(learningSummaries).values({
      id: createId('summary'),
      kind: 'question',
      refId: threadId,
      status: 'ready',
      summaryJson: JSON.stringify({
        question: thread.question,
        resolutionSummary: summary || thread.resolutionSummary || ''
      }),
      createdAt: now
    });
    const state = await this.runtime.getState();
    if (state.activeQuestionThreadId === threadId) {
      await this.runtime.updateState({ activeQuestionThreadId: null });
    }
  }

  async beginLearningSummary(kind: LearningSummary['kind'], refId: string): Promise<LearningSummary> {
    const existingRows = await this.db
      .select()
      .from(learningSummaries)
      .where(and(eq(learningSummaries.kind, kind), eq(learningSummaries.refId, refId), eq(learningSummaries.status, 'pending')))
      .orderBy(desc(learningSummaries.createdAt))
      .limit(1);
    if (existingRows[0]) return mapLearningSummary(existingRows[0]);

    const row = {
      id: createId('summary'),
      kind,
      refId,
      status: 'pending' as const,
      summaryJson: JSON.stringify({}),
      createdAt: nowIso()
    };
    await this.db.insert(learningSummaries).values(row);
    return mapLearningSummary(row);
  }

  async completeLearningSummary(summaryId: string, summary: unknown): Promise<LearningSummary> {
    await this.db
      .update(learningSummaries)
      .set({ status: 'ready', summaryJson: JSON.stringify(summary) })
      .where(eq(learningSummaries.id, summaryId));
    const rows = await this.db.select().from(learningSummaries).where(eq(learningSummaries.id, summaryId)).limit(1);
    if (!rows[0]) throw new Error(`Learning summary not found: ${summaryId}`);
    return mapLearningSummary(rows[0]);
  }

  async failLearningSummary(summaryId: string, errorCategory: string): Promise<LearningSummary> {
    await this.db
      .update(learningSummaries)
      .set({ status: 'failed', summaryJson: JSON.stringify({ errorCategory }) })
      .where(eq(learningSummaries.id, summaryId));
    const rows = await this.db.select().from(learningSummaries).where(eq(learningSummaries.id, summaryId)).limit(1);
    if (!rows[0]) throw new Error(`Learning summary not found: ${summaryId}`);
    return mapLearningSummary(rows[0]);
  }

  async getLatestLearningSummary(kind: LearningSummary['kind'], refId: string): Promise<LearningSummary | null> {
    const rows = await this.db
      .select()
      .from(learningSummaries)
      .where(and(eq(learningSummaries.kind, kind), eq(learningSummaries.refId, refId)))
      .orderBy(desc(learningSummaries.createdAt))
      .limit(1);
    return rows[0] ? mapLearningSummary(rows[0]) : null;
  }

  async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
    const rows = await this.db.select().from(questionThreads).where(eq(questionThreads.id, threadId)).limit(1);
    return rows[0] ? mapQuestionThread(rows[0]) : null;
  }

  private async listQuestionMessages(threadId: string): Promise<QuestionMessage[]> {
    const rows = await this.db
      .select()
      .from(questionMessages)
      .where(eq(questionMessages.threadId, threadId))
      .orderBy(asc(questionMessages.createdAt));
    return rows.map(mapQuestionMessage);
  }

  private async getDailyGuideTaskById(taskId: string): Promise<DailyGuideTask | null> {
    const taskRows = await this.db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.id, taskId)).limit(1);
    if (!taskRows[0]) return null;
    const actionRows = await this.db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, taskId))
      .orderBy(asc(dailyGuideActions.position));
    return mapDailyGuideTask(taskRows[0], actionRows.map(mapDailyGuideAction));
  }
}
