import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningGoal
} from '../../../shared/types';
import type { GoalIntakeAgentOutput } from '../../../shared/schemas';
import { localDateIso } from '../../../shared/date';
import type { Database } from '../../db/client';
import {
  dailyGuides,
  dailyPlans,
  goalIntakeMessages,
  goalIntakes,
  goals
} from '../../db/schema';
import { createId, nowIso } from '../id';
import type { RuntimePersistence } from './runtime-persistence';
import {
  mapGoal,
  mapGoalIntake,
  mapGoalIntakeMessage,
  mergeGoalBrief,
  parseGoalBrief
} from './serialization';

const DEFAULT_GREETING = '我们先把目标说清楚。你可以直接告诉我想学什么、想达到什么结果；如果赶时间，也可以说"直接开始"。';
const RESTART_GREETING = '上一版今日计划已经归档。我们重新开始：你想开启什么新学习计划？也可以直接说"直接开始"。';

export class GoalIntakePersistence {
  private cachedActiveIntakeId: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly runtime: RuntimePersistence
  ) {}

  async listGoalIntakes(): Promise<HistoryIntakeSummary[]> {
    const rows = await this.db.select().from(goalIntakes).orderBy(desc(goalIntakes.createdAt));
    const goalIds = [...new Set(rows.map((r) => r.goalId).filter(Boolean))] as string[];
    const goalRows = goalIds.length ? await this.db.select().from(goals).where(inArray(goals.id, goalIds)) : [];
    const goalMap = new Map(goalRows.map((g) => [g.id, g.title]));
    const counts = await Promise.all(
      rows.map((row) =>
        this.db.select({ count: sql<number>`count(*)` }).from(goalIntakeMessages)
          .where(eq(goalIntakeMessages.intakeId, row.id))
          .then((r) => Number(r[0]?.count ?? 0))
      )
    );
    return rows.map((row, i) => ({
      intake: mapGoalIntake(row),
      goalTitle: row.goalId ? (goalMap.get(row.goalId) ?? '') : '',
      messageCount: counts[i]
    }));
  }

  getGoalIntakeById(intakeId: string): Promise<GoalIntakeState> {
    return this.getGoalIntakeState(intakeId);
  }

  async getCurrentGoalIntake(): Promise<GoalIntakeState> {
    const existing = await this.db.select().from(goalIntakes).orderBy(desc(goalIntakes.createdAt));
    let intake = existing.find((item) => item.status !== 'confirmed') ?? null;

    if (intake && !intake.goalId) {
      const messages = await this.db.select().from(goalIntakeMessages)
        .where(eq(goalIntakeMessages.intakeId, intake.id));
      const isEffectivelyEmpty = messages.length <= 1;
      if (isEffectivelyEmpty) {
        const confirmedWithGoal = existing.find((item): item is typeof item & { goalId: string } => item.status === 'confirmed' && !!item.goalId);
        const confirmedIsNewerThanEmptyIntake = confirmedWithGoal
          ? confirmedWithGoal.updatedAt >= intake.createdAt
          : false;
        if (confirmedWithGoal && confirmedIsNewerThanEmptyIntake) {
          const hasGuide = await this.hasNonArchivedGuideForToday(confirmedWithGoal.goalId);
          if (!hasGuide) {
            intake = confirmedWithGoal;
          }
        }
      }
    }

    if (!intake) {
      const latest = existing[0];
      if (latest && latest.status === 'confirmed' && latest.goalId) {
        const hasGuide = await this.hasNonArchivedGuideForToday(latest.goalId);
        if (!hasGuide) {
          intake = latest;
        }
      }
    }

    if (!intake) {
      intake = await this.createCollectingIntake(DEFAULT_GREETING);
    }
    return this.getGoalIntakeState(intake.id);
  }

  async addGoalIntakeMessage(intakeId: string, role: GoalIntakeMessage['role'], content: string): Promise<GoalIntakeMessage> {
    this.cachedActiveIntakeId = intakeId;
    const row = {
      id: createId('goal_intake_message'),
      intakeId,
      role,
      content,
      createdAt: nowIso()
    };
    await this.db.insert(goalIntakeMessages).values(row);
    return row;
  }

  async saveGoalIntakeAgentOutput(intakeId: string, output: GoalIntakeAgentOutput): Promise<GoalIntakeState> {
    await this.addGoalIntakeMessage(intakeId, 'assistant', output.reply);
    await this.db
      .update(goalIntakes)
      .set({
        status: output.status === 'ready' || output.shouldForceStart ? 'ready' : 'collecting',
        briefJson: output.brief ? JSON.stringify(output.brief) : undefined,
        updatedAt: nowIso()
      })
      .where(eq(goalIntakes.id, intakeId));
    return this.getGoalIntakeState(intakeId);
  }

  async confirmGoalIntake(briefPatch: Partial<GoalBrief> = {}): Promise<{ goal: LearningGoal; intake: GoalIntake }> {
    const current = await this.getCurrentGoalIntake();
    const brief = mergeGoalBrief(current.intake.brief, briefPatch);
    if (!brief.title.trim()) {
      throw new Error('目标理解缺少标题，无法确认。');
    }
    const description = this.describeBrief(brief);

    let goal: LearningGoal;
    if (current.intake.goalId) {
      const existingGoal = await this.getGoal(current.intake.goalId);
      if (existingGoal) {
        const now = nowIso();
        await this.db.update(goals).set({
          title: brief.title,
          description: description || null,
          updatedAt: now
        }).where(eq(goals.id, existingGoal.id));
        goal = { ...existingGoal, title: brief.title, description: description || null, updatedAt: now };
      } else {
        goal = await this.createGoal(brief.title, description);
      }
    } else {
      goal = await this.createGoal(brief.title, description);
    }

    const now = nowIso();
    await this.db
      .update(goalIntakes)
      .set({
        status: 'confirmed',
        goalId: goal.id,
        briefJson: JSON.stringify(brief),
        updatedAt: now,
        confirmedAt: now
      })
      .where(eq(goalIntakes.id, current.intake.id));
    const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.id, current.intake.id)).limit(1);
    return { goal, intake: mapGoalIntake(rows[0]) };
  }

  async getGoalBriefForGoal(goalId: string): Promise<GoalBrief | null> {
    const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.goalId, goalId)).orderBy(desc(goalIntakes.updatedAt)).limit(1);
    return rows[0]?.briefJson ? parseGoalBrief(rows[0].briefJson) : null;
  }

  async archiveTodayGuides(date: string): Promise<GoalIntakeState> {
    const now = nowIso();
    const activeGoalRows = await this.db
      .select()
      .from(goals)
      .where(eq(goals.status, 'active'));
    const activeGoalIds = activeGoalRows.map((goal) => goal.id);

    const guideRows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.date, date));
    for (const guide of guideRows) {
      await this.db.update(dailyGuides).set({ status: 'archived' }).where(eq(dailyGuides.id, guide.id));
      await this.db.update(dailyPlans).set({ status: 'archived' }).where(eq(dailyPlans.id, guide.planId));
    }
    await this.db.update(dailyPlans).set({ status: 'archived' }).where(eq(dailyPlans.date, date));
    if (activeGoalIds.length > 0) {
      await this.db
        .update(dailyGuides)
        .set({ status: 'archived' })
        .where(inArray(dailyGuides.goalId, activeGoalIds));
      await this.db
        .update(goals)
        .set({ status: 'archived', updatedAt: now })
        .where(inArray(goals.id, activeGoalIds));
      await this.runtime.updateState({
        activeGoalId: null,
        activeStageId: null,
        activeDailyTaskId: null,
        activeStepId: null,
        activeQuestionThreadId: null,
        sessionStatus: 'idle'
      });
    }

    const intake = await this.createCollectingIntake(RESTART_GREETING);
    return this.getGoalIntakeState(intake.id);
  }

  private async getGoalIntakeState(intakeId: string): Promise<GoalIntakeState> {
    const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.id, intakeId)).limit(1);
    if (!rows[0]) throw new Error(`Goal intake not found: ${intakeId}`);
    const messages = await this.db
      .select()
      .from(goalIntakeMessages)
      .where(eq(goalIntakeMessages.intakeId, intakeId))
      .orderBy(asc(goalIntakeMessages.createdAt));
    const intake = mapGoalIntake(rows[0]);
    const activeGoal = intake.goalId ? await this.getGoal(intake.goalId) : (await this.listGoals()).find((item) => item.status === 'active') ?? null;
    return {
      intake,
      messages: messages.map(mapGoalIntakeMessage),
      activeGoal
    };
  }

  private async createCollectingIntake(greeting: string): Promise<typeof goalIntakes.$inferSelect> {
    const now = nowIso();
    const intakeId = createId('goal_intake');
    this.cachedActiveIntakeId = intakeId;
    await this.db.insert(goalIntakes).values({
      id: intakeId,
      status: 'collecting',
      goalId: null,
      briefJson: null,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null
    });
    await this.db.insert(goalIntakeMessages).values({
      id: createId('goal_intake_message'),
      intakeId,
      role: 'assistant',
      content: greeting,
      createdAt: now
    });
    const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.id, intakeId)).limit(1);
    return rows[0];
  }

  private async hasNonArchivedGuideForToday(goalId: string): Promise<boolean> {
    const guideRows = await this.db.select().from(dailyGuides)
      .where(and(eq(dailyGuides.goalId, goalId), eq(dailyGuides.date, localDateIso())))
      .limit(1);
    return guideRows.length > 0 && guideRows[0].status !== 'archived';
  }

  private async createGoal(title: string, description?: string): Promise<LearningGoal> {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('学习目标标题不能为空。');
    const now = nowIso();
    const row = {
      id: createId('goal'),
      sourceImportId: null,
      title: cleanTitle,
      description: description?.trim() || null,
      status: 'active' as const,
      priority: 3,
      dueDate: null,
      createdAt: now,
      updatedAt: now
    };
    await this.db.insert(goals).values(row);
    await this.runtime.updateState({
      activeGoalId: row.id,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle'
    });
    return row;
  }

  private async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

  private async listGoals(): Promise<LearningGoal[]> {
    const rows = await this.db.select().from(goals).orderBy(desc(goals.createdAt));
    return rows.map(mapGoal);
  }

  private describeBrief(brief: GoalBrief): string {
    return [
      `目标结果：${brief.targetOutcome}`,
      `当前基础：${brief.currentLevel}`,
      `可用时间：${brief.availableTime}`,
      `截止时间：${brief.deadline}`,
      brief.constraints.length ? `现实限制：${brief.constraints.join('；')}` : '',
      brief.successCriteria.length ? `成功标准：${brief.successCriteria.join('；')}` : ''
    ].filter(Boolean).join('\n');
  }
}
