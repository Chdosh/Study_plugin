import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type {
  DailyPlanBlock,
  DailyGuide,
  DailyGuideAction,
  DailyGuideBlock,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  HistoryIntakeSummary,
  LearningEvaluation,
  LearningGoal,
  KnowledgeItem,
  KnowledgeItemSourceType,
  KnowledgeItemStatus,
  LearningRuntimeSnapshot,
  LearningRuntimeState,
  LearningStep,
  LearningSubmission,
  LearningSummary,
  PlanAdjustmentProposal,
  PlanStage,
  PreviousLearningDayResult,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  ReviewResult,
  RoadmapStage,
  ShortPlanDay,
  StoredNextStepDecision,
  StudySession,
  StudyWindow,
  TaskItem
} from '../../shared/types';
import type {
  AnswerStepQuestionAgentOutput,
  DailyGuideAgentOutput,
  GoalIntakeAgentOutput,
  NextStepDecisionAgentOutput,
  RoadmapAgentOutput,
  ReviewAgentOutput,
  ShortPlanAgentOutput,
  SubmissionEvaluationAgentOutput,
  TeachStepAgentOutput
} from '../../shared/schemas';
import { applyEvaluationResult, completeAction, isPassingEvaluation, skipAction, skipTask, type ExecutionState } from '../domain/execution-state-machine';
import { defaultPromptProfiles } from '../db/default-prompts';
import type { Database } from '../db/client';
import type { AiCallMetrics } from '../ai/ai-client';
import {
  aiReviews,
  appSettings,
  dailyGuideActions,
  generationLocks,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  focusEvents,
  goalIntakeMessages,
  goalIntakes,
  goals,
  knowledgeItems,
  knowledgeItemEvidence,
  learningEvaluations,
  learningRuntimeStates,
  learningSteps,
  learningSubmissions,
  learningSummaries,
  nextStepDecisions,
  planAdjustmentProposals,
  planVersions,
  planStages,
  promptProfiles,
  promptVersions,
  questionMessages,
  questionThreads,
  roadmapStages,
  skipLogs,
  shortPlanDays,
  studySessions,
  taskItems
} from '../db/schema';
import { createId, nowIso } from './id';
import { localDateIso } from '../../shared/date';

export class StudyStore {
  private cachedActiveStepId: string | null = null;
  private cachedActiveIntakeId: string | null = null;

  constructor(public readonly db: Database) {}

  getActiveStepId(): string | null {
    return this.cachedActiveStepId;
  }

  getActiveIntakeId(): string | null {
    return this.cachedActiveIntakeId;
  }

  async seedDefaults(): Promise<void> {
    const now = nowIso();
    for (const prompt of defaultPromptProfiles) {
      const existing = await this.db
        .select()
        .from(promptProfiles)
        .where(eq(promptProfiles.key, prompt.key))
        .limit(1);
      if (existing.length > 0) {
        const profile = existing[0];
        await this.db
          .update(promptProfiles)
          .set({
            name: prompt.name,
            description: prompt.description,
            updatedAt: now
          })
          .where(eq(promptProfiles.id, profile.id));

        const latestVersions = await this.db
          .select()
          .from(promptVersions)
          .where(eq(promptVersions.profileId, profile.id))
          .orderBy(desc(promptVersions.version))
          .limit(1);
        const latest = latestVersions[0];
        if (!latest || latest.content.startsWith('Act as ')) {
          const versionId = createId('prompt_version');
          await this.db.insert(promptVersions).values({
            id: versionId,
            profileId: profile.id,
            version: (latest?.version ?? 0) + 1,
            content: prompt.content,
            createdAt: now
          });
          await this.db
            .update(promptProfiles)
            .set({ activeVersionId: versionId, updatedAt: now })
            .where(eq(promptProfiles.id, profile.id));
        }
        continue;
      }

      const profileId = createId('prompt_profile');
      const versionId = createId('prompt_version');
      await this.db.insert(promptProfiles).values({
        id: profileId,
        key: prompt.key,
        name: prompt.name,
        description: prompt.description,
        activeVersionId: versionId,
        createdAt: now,
        updatedAt: now
      });
      await this.db.insert(promptVersions).values({
        id: versionId,
        profileId,
        version: 1,
        content: prompt.content,
        createdAt: now
      });
    }

    await this.putSettingIfMissing('deepseekBaseUrl', 'https://api.deepseek.com');
    await this.putSettingIfMissing('deepseekModel', 'deepseek-chat');
    await this.putSettingIfMissing('autoLaunch', 'false');
    await this.putSettingIfMissing('defaultBlockMinutes', '10');
    await this.putSettingIfMissing(
      'dailyStudyWindows',
      JSON.stringify([
        {
          start: '20:00',
          end: '22:00'
        }
      ])
    );
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return rows[0]?.value ?? null;
  }

  async putSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value,
          updatedAt: nowIso()
        }
      });
  }

  private async putSettingIfMissing(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing === null) {
      await this.putSetting(key, value);
    }
  }

  async createGoal(title: string, description?: string): Promise<LearningGoal> {
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
    await this.upsertRuntimeState({
      activeGoalId: row.id,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle'
    });
    return row;
  }

  async listGoals(): Promise<LearningGoal[]> {
    const rows = await this.db.select().from(goals).orderBy(desc(goals.createdAt));
    return rows.map(mapGoal);
  }

  async getGoal(goalId: string): Promise<LearningGoal | null> {
    const rows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    return rows[0] ? mapGoal(rows[0]) : null;
  }

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

  async getGoalIntakeById(intakeId: string): Promise<GoalIntakeState> {
    return this.getGoalIntakeState(intakeId);
  }

  async getCurrentGoalIntake(): Promise<GoalIntakeState> {
    const existing = await this.db.select().from(goalIntakes).orderBy(desc(goalIntakes.createdAt));
    let intake = existing.find((item) => item.status !== 'confirmed') ?? null;

    // If latest non-confirmed intake is empty (only greeting) and a confirmed
    // intake with a goal exists that has no guide for today, prefer the
    // confirmed one to preserve session history.
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
          const guideRows = await this.db.select().from(dailyGuides)
            .where(and(eq(dailyGuides.goalId, confirmedWithGoal.goalId), eq(dailyGuides.date, localDateIso())))
            .limit(1);
          const hasGuide = guideRows.length > 0 && guideRows[0].status !== 'archived';
          if (!hasGuide) {
            intake = confirmedWithGoal;
          }
        }
      }
    }

    if (!intake) {
      const latest = existing[0];
      if (latest && latest.status === 'confirmed' && latest.goalId) {
        const guideRows = await this.db.select().from(dailyGuides)
          .where(and(eq(dailyGuides.goalId, latest.goalId), eq(dailyGuides.date, localDateIso())))
          .limit(1);
        const hasGuide = guideRows.length > 0 && guideRows[0].status !== 'archived';
        if (!hasGuide) {
          intake = latest;
        }
      }
    }
    if (!intake) {
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
        content: '我们先把目标说清楚。你可以直接告诉我想学什么、想达到什么结果；如果赶时间，也可以说"直接开始"。',
        createdAt: now
      });
      const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.id, intakeId)).limit(1);
      intake = rows[0];
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
    const description = [
      `目标结果：${brief.targetOutcome}`,
      `当前基础：${brief.currentLevel}`,
      `可用时间：${brief.availableTime}`,
      `截止时间：${brief.deadline}`,
      brief.constraints.length ? `现实限制：${brief.constraints.join('；')}` : '',
      brief.successCriteria.length ? `成功标准：${brief.successCriteria.join('；')}` : ''
    ].filter(Boolean).join('\n');

    // Reuse existing goal on retry to avoid orphaned goals
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

  async saveLayeredPlan(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    date: string;
    windows: StudyWindow[];
    roadmap: RoadmapAgentOutput;
    shortPlan: ShortPlanAgentOutput;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    const now = nowIso();
    const roadmapRows: RoadmapStage[] = [];
    let position = 0;
    for (const stage of params.roadmap.stages) {
      const row = {
        id: createId('roadmap_stage'),
        goalId: params.goal.id,
        title: stage.title,
        objective: stage.objective,
        direction: stage.direction,
        successCriteria: stage.successCriteria,
        position: position++,
        createdAt: now,
        updatedAt: now
      };
      await this.db.insert(roadmapStages).values(row);
      roadmapRows.push({ ...row, status: 'pending' as const });
    }

    if (roadmapRows[0]) {
      await this.db
        .update(roadmapStages)
        .set({ status: 'active' })
        .where(eq(roadmapStages.id, roadmapRows[0].id));
      roadmapRows[0].status = 'active';
    }

    const shortRows: ShortPlanDay[] = [];
    let day1ShortPlanDayId: string | null = null;
    for (const day of params.shortPlan.days) {
      const row = {
        id: createId('short_plan_day'),
        goalId: params.goal.id,
        roadmapStageId: roadmapRows[0]?.id ?? null,
        dayIndex: day.dayIndex,
        date: day.dayIndex === 1 ? params.date : null,
        sessionStatus: 'pending' as const,
        title: day.title,
        focus: day.focus,
        tasksJson: JSON.stringify(day.tasks),
        expectedOutput: day.expectedOutput,
        successCriteria: day.successCriteria,
        locked: false,
        createdAt: now
      };
      await this.db.insert(shortPlanDays).values(row);
      if (day.dayIndex === 1) {
        day1ShortPlanDayId = row.id;
      }
      shortRows.push(mapShortPlanDay(row));
    }

    const planId = createId('plan');
    await this.db.insert(dailyPlans).values({
      id: planId,
      date: params.date,
      status: 'draft',
      availableWindowsJson: JSON.stringify(params.windows),
      shortPlanDayId: day1ShortPlanDayId,
      createdAt: now,
      confirmedAt: null,
      sourceReviewId: null,
      version: 1
    });

    const guideId = createId('daily_guide');
    await this.db.insert(dailyGuides).values({
      id: guideId,
      goalId: params.goal.id,
      planId,
      shortPlanDayId: day1ShortPlanDayId,
      date: params.date,
      status: 'draft',
      weekFocus: params.shortPlan.weekFocus,
      todayGoal: params.dailyGuide.todayGoal,
      deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
      boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
      acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
      tomorrowActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
      createdAt: now,
      confirmedAt: null
    });

    let blockPosition = 0;
    let cursorTime = params.windows[0]?.start ?? '20:00';
    for (const task of params.dailyGuide.tasks) {
      const planBlockId = createId('block');
      const startTime = cursorTime;
      const endTime = addMinutesToClock(startTime, task.estimatedMinutes.target);
      cursorTime = endTime;
      await this.db.insert(dailyPlanBlocks).values({
        id: planBlockId,
        planId,
        taskId: null,
        startTime,
        endTime,
        durationMinutes: task.estimatedMinutes.target,
        objective: task.objective,
        action: task.actions.map((action) => `${action.title}：${action.instruction}`).join('\n'),
        expectedOutput: task.deliverable,
        difficulty: 'foundation',
        material: '今日主任务',
        successCheck: task.doneWhen.join('；') || task.deliverable,
        fallback: task.quickHint,
        status: 'planned',
        position: blockPosition
      });
      const guideTaskId = createId('daily_guide_task');
      const nowForTask = nowIso();
      await this.db.insert(dailyGuideTasks).values({
        id: guideTaskId,
        guideId,
        roadmapStageId: roadmapRows[0]?.id ?? null,
        legacyPlanBlockId: planBlockId,
        title: task.title,
        objective: task.objective,
        scope: task.scope,
        estimatedMinMinutes: task.estimatedMinutes.min,
        estimatedTargetMinutes: task.estimatedMinutes.target,
        estimatedMaxMinutes: task.estimatedMinutes.max,
        deliverable: task.deliverable,
        doneWhenJson: JSON.stringify(task.doneWhen),
        quickHint: task.quickHint,
        evaluationMode: task.evaluationMode,
        submissionPolicy: task.submissionPolicy,
        carryoverAllowed: task.carryoverAllowed,
        status: 'planned',
        progressPercent: 0,
        currentActionId: null,
        nextStartPoint: task.actions[0]?.title ?? null,
        totalElapsedMinutes: 0,
        position: blockPosition,
        createdAt: nowForTask,
        updatedAt: nowForTask
      });
      let actionPosition = 0;
      for (const action of task.actions) {
        await this.db.insert(dailyGuideActions).values({
          id: createId('daily_guide_action'),
          taskId: guideTaskId,
          title: action.title,
          instruction: action.instruction,
          checkpoint: action.checkpoint,
          status: 'planned',
          progressNote: null,
          completedAt: null,
          position: actionPosition++
        });
      }
      await this.db.insert(dailyGuideBlocks).values({
        id: createId('daily_guide_block'),
        guideId,
        planBlockId,
        title: task.title,
        position: blockPosition
      });
      blockPosition += 1;
    }

    await this.db.insert(planVersions).values({
      id: createId('plan_version'),
      planId,
      version: 1,
      changeSummary: 'Initial layered guide draft.',
      snapshotJson: JSON.stringify({
        brief: params.brief,
        roadmap: params.roadmap,
        shortPlan: params.shortPlan,
        dailyGuide: params.dailyGuide
      }),
      createdAt: now
    });

    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Daily guide not found after save: ${guideId}`);
    return { goal: params.goal, roadmap: roadmapRows, shortPlan: shortRows, guide };
  }

  async findActiveOrActivateStage(goalId: string): Promise<RoadmapStage | 'goal_completed' | null> {
    const activeRows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position));

    if (activeRows.length > 1) {
      const now = nowIso();
      const [keep, ...dupes] = activeRows;
      for (const dup of dupes) {
        await this.db
          .update(roadmapStages)
          .set({ status: 'completed', updatedAt: now })
          .where(eq(roadmapStages.id, dup.id));
      }
      return mapRoadmapStage(keep);
    }

    if (activeRows.length === 1) return mapRoadmapStage(activeRows[0]);

    const pendingRows = await this.db
      .select()
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, goalId), eq(roadmapStages.status, 'pending')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    if (pendingRows[0]) {
      const now = nowIso();
      await this.db
        .update(roadmapStages)
        .set({ status: 'active', updatedAt: now })
        .where(eq(roadmapStages.id, pendingRows[0].id));
      return mapRoadmapStage({ ...pendingRows[0], status: 'active', updatedAt: now });
    }

    const allRows = await this.db
      .select({ status: roadmapStages.status })
      .from(roadmapStages)
      .where(eq(roadmapStages.goalId, goalId));
    if (allRows.length > 0 && allRows.every((r) => r.status === 'completed')) {
      return 'goal_completed';
    }
    return null;
  }

  async saveRollingPlanDays(params: {
    goalId: string;
    roadmapStageId: string;
    items: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      tasks: string[];
      expectedOutput: string;
      successCriteria: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    const now = nowIso();
    const existingMaxRows = await this.db
      .select({ maxDay: shortPlanDays.dayIndex })
      .from(shortPlanDays)
      .where(eq(shortPlanDays.goalId, params.goalId))
      .orderBy(desc(shortPlanDays.dayIndex))
      .limit(1);
    const baseIndex = existingMaxRows[0]?.maxDay ?? 0;
    const result: ShortPlanDay[] = [];
    for (const item of params.items) {
      const id = createId('short_plan_day');
      const dayIndex = baseIndex + item.dayIndex;
      await this.db.insert(shortPlanDays).values({
        id,
        goalId: params.goalId,
        roadmapStageId: params.roadmapStageId,
        dayIndex,
        date: null,
        sessionStatus: 'pending',
        title: item.title,
        focus: item.focus,
        tasksJson: JSON.stringify(item.tasks),
        expectedOutput: item.expectedOutput,
        successCriteria: item.successCriteria,
        locked: false,
        createdAt: now
      });
      result.push({ id, goalId: params.goalId, roadmapStageId: params.roadmapStageId, dayIndex, date: null, sessionStatus: 'pending', title: item.title, focus: item.focus, tasks: item.tasks, expectedOutput: item.expectedOutput, successCriteria: item.successCriteria, locked: false, createdAt: now });
    }
    return result;
  }

  async applyReviewPlanAdjustments(params: {
    goalId: string;
    adjustments: Array<{
      dayIndex: number;
      title: string;
      focus: string;
      expectedOutput: string;
      successCriteria: string;
      reason: string;
    }>;
  }): Promise<ShortPlanDay[]> {
    if (params.adjustments.length === 0) return [];
    const activeStageRows = await this.db
      .select({ id: roadmapStages.id })
      .from(roadmapStages)
      .where(and(eq(roadmapStages.goalId, params.goalId), eq(roadmapStages.status, 'active')))
      .orderBy(asc(roadmapStages.position))
      .limit(1);
    const activeStageId = activeStageRows[0]?.id ?? null;
    const allDays = await this.db
      .select()
      .from(shortPlanDays)
      .where(and(
        eq(shortPlanDays.goalId, params.goalId),
        eq(shortPlanDays.sessionStatus, 'pending'),
        ...(activeStageId ? [eq(shortPlanDays.roadmapStageId, activeStageId)] : [])
      ))
      .orderBy(asc(shortPlanDays.dayIndex));
    const updated: ShortPlanDay[] = [];
    for (const adj of params.adjustments) {
      const target = allDays.find((d) => d.dayIndex === adj.dayIndex);
      if (!target || target.locked) continue;
      await this.db
        .update(shortPlanDays)
        .set({
          title: adj.title,
          focus: adj.focus,
          expectedOutput: adj.expectedOutput,
          successCriteria: adj.successCriteria
        })
        .where(eq(shortPlanDays.id, target.id));
      const mapped = mapShortPlanDay({ ...target, title: adj.title, focus: adj.focus, expectedOutput: adj.expectedOutput, successCriteria: adj.successCriteria });
      updated.push(mapped);
    }
    return updated;
  }

  async recordKnowledgeItems(params: {
    goalId: string;
    items: Array<{
      key: string;
      summary: string;
      detail?: string;
      sourceType: KnowledgeItemSourceType;
      sourceId?: string;
      evidence?: {
        submissionId?: string;
        evaluationId?: string;
        taskId?: string;
      };
    }>;
  }): Promise<KnowledgeItem[]> {
    if (params.items.length === 0) return [];
    const now = nowIso();
    const result: KnowledgeItem[] = [];
    for (const item of params.items) {
      const canonicalKey = normalizeKnowledgeKey(item.key || item.summary);
      const existingRows = await this.db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.goalId, params.goalId));
      const existing = existingRows.find((row) =>
        normalizeKnowledgeKey(row.key) === canonicalKey ||
        normalizeKnowledgeKey(row.summary) === canonicalKey
      );
      let knowledgeItemId: string;
      if (existing) {
        knowledgeItemId = existing.id;
        await this.db
          .update(knowledgeItems)
          .set({
            key: canonicalKey,
            occurrenceCount: existing.occurrenceCount + 1,
            lastSeenAt: now,
            updatedAt: now
          })
          .where(eq(knowledgeItems.id, existing.id));
        result.push({
          ...mapKnowledgeItem(existing),
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          updatedAt: now
        });
      } else {
        const id = createId('knowledge_item');
        knowledgeItemId = id;
        await this.db.insert(knowledgeItems).values({
          id,
          goalId: params.goalId,
          key: canonicalKey,
          summary: item.summary,
          detail: item.detail ?? null,
          sourceType: item.sourceType,
          sourceId: item.sourceId ?? null,
          occurrenceCount: 1,
          lastSeenAt: now,
          status: 'active',
          createdAt: now,
          updatedAt: now
        });
        result.push({ id, goalId: params.goalId, key: canonicalKey, summary: item.summary, detail: item.detail ?? null, sourceType: item.sourceType, sourceId: item.sourceId ?? null, occurrenceCount: 1, lastSeenAt: now, status: 'active', createdAt: now, updatedAt: now });
      }

      if (item.sourceId || item.evidence) {
        await this.db.insert(knowledgeItemEvidence).values({
          id: createId('knowledge_evidence'),
          knowledgeItemId,
          sourceType: item.sourceType,
          sourceId: item.sourceId ?? null,
          submissionId: item.evidence?.submissionId ?? null,
          evaluationId: item.evidence?.evaluationId ?? null,
          taskId: item.evidence?.taskId ?? null,
          createdAt: now
        }).onConflictDoNothing();
      }
    }
    return result;
  }

  async getKnowledgeItemsForGoal(params: {
    goalId: string;
    status?: KnowledgeItemStatus;
    goalKey?: string;
    limit?: number;
  }): Promise<KnowledgeItem[]> {
    const conditions = [eq(knowledgeItems.goalId, params.goalId)];
    if (params.status) conditions.push(eq(knowledgeItems.status, params.status));
    if (params.goalKey) conditions.push(sql`${knowledgeItems.key} LIKE ${'%' + params.goalKey + '%'}`);
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(...conditions))
      .orderBy(desc(knowledgeItems.occurrenceCount))
      .limit(params.limit ?? 20);
    return rows.map(mapKnowledgeItem);
  }

  async auditRuntimeConsistency(): Promise<{
    consistent: boolean;
    fixed: string[];
    conflicts: Array<{ field: string; expected: string; actual: string }>;
  }> {
    const fixed: string[] = [];
    const conflicts: Array<{ field: string; expected: string; actual: string }> = [];
    const stateRows = await this.db.select().from(learningRuntimeStates).limit(1);
    if (stateRows.length === 0) return { consistent: true, fixed, conflicts };
    const state = stateRows[0];
    const now = nowIso();

    if (state.activeGoalId) {
      const goalRows = await this.db.select({ id: goals.id, status: goals.status }).from(goals).where(eq(goals.id, state.activeGoalId)).limit(1);
      if (goalRows.length === 0 || goalRows[0].status !== 'active') {
        const activeGoalRows = await this.db.select({ id: goals.id }).from(goals).where(eq(goals.status, 'active')).limit(1);
        if (activeGoalRows.length === 1) {
          await this.db.update(learningRuntimeStates).set({ activeGoalId: activeGoalRows[0].id, updatedAt: now });
          fixed.push(`activeGoalId → ${activeGoalRows[0].id}`);
        } else {
          conflicts.push({ field: 'activeGoalId', expected: 'an active goal', actual: state.activeGoalId });
        }
      }
    }

    if (state.activeStageId && state.activeGoalId) {
      const stageRows = await this.db.select({ id: roadmapStages.id, goalId: roadmapStages.goalId, status: roadmapStages.status })
        .from(roadmapStages).where(eq(roadmapStages.id, state.activeStageId)).limit(1);
      if (stageRows.length === 0 || stageRows[0].goalId !== state.activeGoalId || stageRows[0].status !== 'active') {
        const activeStageRows = await this.db.select({ id: roadmapStages.id })
          .from(roadmapStages).where(and(eq(roadmapStages.goalId, state.activeGoalId), eq(roadmapStages.status, 'active'))).limit(1);
        if (activeStageRows.length === 1) {
          await this.db.update(learningRuntimeStates).set({ activeStageId: activeStageRows[0].id, updatedAt: now });
          fixed.push(`activeStageId → ${activeStageRows[0].id}`);
        } else {
          conflicts.push({ field: 'activeStageId', expected: 'active stage for goal', actual: state.activeStageId });
        }
      }
    }

    if (state.activeDailyTaskId) {
      const taskRows = await this.db.select({ id: dailyGuideTasks.id }).from(dailyGuideTasks).where(eq(dailyGuideTasks.id, state.activeDailyTaskId)).limit(1);
      if (taskRows.length === 0) {
        await this.db.update(learningRuntimeStates).set({ activeDailyTaskId: null, updatedAt: now });
        fixed.push('activeDailyTaskId → null');
      }
    }

    if (state.activeStepId) {
      const actionRows = await this.db.select({ id: dailyGuideActions.id, taskId: dailyGuideActions.taskId })
        .from(dailyGuideActions).where(eq(dailyGuideActions.id, state.activeStepId)).limit(1);
      if (actionRows.length === 0) {
        await this.db.update(learningRuntimeStates).set({ activeStepId: null, updatedAt: now });
        fixed.push('activeStepId → null');
      } else if (state.activeDailyTaskId && actionRows[0].taskId !== state.activeDailyTaskId) {
        await this.db.update(learningRuntimeStates).set({ activeStepId: null, updatedAt: now });
        fixed.push('activeStepId → null (task mismatch)');
      }
    }

    return { consistent: conflicts.length === 0, fixed, conflicts };
  }

  async getReviewWorthyKnowledgeItems(goalId: string, minOccurrences = 2): Promise<KnowledgeItem[]> {
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(
        eq(knowledgeItems.goalId, goalId),
        eq(knowledgeItems.status, 'active'),
        sql`${knowledgeItems.occurrenceCount} >= ${minOccurrences}`
      ))
      .orderBy(desc(knowledgeItems.occurrenceCount))
      .limit(5);
    return rows.map(mapKnowledgeItem);
  }

  async getKnowledgeContextForGoal(goalId: string): Promise<{ knowledgeItems: KnowledgeItem[]; reviewKnowledgeItems: KnowledgeItem[] }> {
    const [knowledgeItems, reviewKnowledgeItems] = await Promise.all([
      this.getKnowledgeItemsForGoal({ goalId, status: 'active', limit: 3 }),
      this.getReviewWorthyKnowledgeItems(goalId)
    ]);
    return { knowledgeItems, reviewKnowledgeItems };
  }

  async resolveKnowledgeItems(goalId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const now = nowIso();
    const activeItems = await this.db
      .select()
      .from(knowledgeItems)
      .where(and(
        eq(knowledgeItems.goalId, goalId),
        eq(knowledgeItems.status, 'active')
      ));
    for (const item of activeItems) {
      const matches = keys.some((k) => {
        const normalizedCandidate = normalizeKnowledgeKey(k);
        const normalizedItem = normalizeKnowledgeKey(item.key || item.summary);
        return normalizedCandidate === normalizedItem;
      });
      if (matches) {
        await this.db
          .update(knowledgeItems)
          .set({ status: 'resolved', updatedAt: now })
          .where(eq(knowledgeItems.id, item.id));
      }
    }
  }

  async confirmDailyGuide(guideId: string): Promise<DailyGuide> {
    const guide = await this.getDailyGuideById(guideId);
    if (!guide) throw new Error(`Daily guide not found: ${guideId}`);
    const confirmedAt = nowIso();
    await this.db
      .update(dailyPlans)
      .set({
        status: 'confirmed',
        confirmedAt
      })
      .where(eq(dailyPlans.id, guide.planId));
    await this.db
      .update(dailyGuides)
      .set({
        status: 'confirmed',
        confirmedAt
      })
      .where(eq(dailyGuides.id, guideId));
    if (guide.shortPlanDayId) {
      await this.db
        .update(shortPlanDays)
        .set({ locked: true })
        .where(eq(shortPlanDays.id, guide.shortPlanDayId));
    }
    const updated = await this.getDailyGuideById(guideId);
    if (!updated) throw new Error(`Daily guide not found after confirm: ${guideId}`);
    return updated;
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
      await this.upsertRuntimeState({
        activeGoalId: null,
        activeStageId: null,
        activeDailyTaskId: null,
        activeStepId: null,
        activeQuestionThreadId: null,
        sessionStatus: 'idle'
      });
    }

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
      content: '上一版今日计划已经归档。我们重新开始：你想开启什么新学习计划？也可以直接说"直接开始"。',
      createdAt: now
    });
    return this.getGoalIntakeState(intakeId);
  }

  async getUsedShortPlanDayIds(goalId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ shortPlanDayId: dailyGuides.shortPlanDayId })
      .from(dailyGuides)
      .where(eq(dailyGuides.goalId, goalId));
    return new Set(rows.map((row) => row.shortPlanDayId).filter((id): id is string => Boolean(id)));
  }

  async listAvailableShortPlanDaysForStage(goalId: string, roadmapStageId: string): Promise<ShortPlanDay[]> {
    const usedShortPlanDayIds = await this.getUsedShortPlanDayIds(goalId);
    const rows = await this.db
      .select()
      .from(shortPlanDays)
      .where(and(
        eq(shortPlanDays.goalId, goalId),
        eq(shortPlanDays.roadmapStageId, roadmapStageId),
        eq(shortPlanDays.sessionStatus, 'pending'),
        isNull(shortPlanDays.date)
      ))
      .orderBy(asc(shortPlanDays.dayIndex));
    return rows
      .map(mapShortPlanDay)
      .filter((day) => !usedShortPlanDayIds.has(day.id));
  }

  async getPreviousCompletedLearningDayContext(
    goalId: string
  ): Promise<PreviousLearningDayResult | null> {
    const guideRows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(
        eq(dailyGuides.goalId, goalId),
        eq(dailyGuides.sessionStatus, 'closed')
      ))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    if (guideRows.length === 0) return null;

    const guide = guideRows[0];
    const tasks = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guide.id))
      .orderBy(asc(dailyGuideTasks.position));

    const completedTasks = tasks.filter((t) => t.status === 'done').map((t) => t.title);
    if (completedTasks.length === 0) return null;

    const submissionResults = await this.getLastSubmissionEvaluationForGuide(guide);
    const evaluationSummary = submissionResults ?? '已完成';

    let reviewSummary: string | undefined;
    const reviewRows = await this.db
      .select()
      .from(aiReviews)
      .where(and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.date, guide.date)))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    if (reviewRows.length > 0 && reviewRows[0].status === 'success') {
      try {
        const output = JSON.parse(reviewRows[0].outputJson);
        reviewSummary = output.summary ?? undefined;
      } catch { /* ignore parse errors */ }
    }

    return { completedTasks, evaluationSummary, reviewSummary };
  }

  async getRollingPlanContext(goalId: string): Promise<{ summary: string; reviewSummary?: string } | null> {
    const guideRows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(
        eq(dailyGuides.goalId, goalId),
        eq(dailyGuides.sessionStatus, 'closed')
      ))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    if (guideRows.length === 0) return null;

    const guide = guideRows[0];
    const taskRows = await this.db
      .select({ title: dailyGuideTasks.title, status: dailyGuideTasks.status })
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guide.id));

    const doneTasks = taskRows.filter((t) => t.status === 'done').map((t) => t.title);
    const allTasks = taskRows.map((t) => t.title);
    const summary = doneTasks.length > 0
      ? `已完成任务：${doneTasks.join('、')}。全部任务：${allTasks.join('、')}。`
      : '暂无已完成任务。';

    let reviewSummary: string | undefined;
    const reviewRows = await this.db
      .select()
      .from(aiReviews)
      .where(and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success')))
      .orderBy(desc(aiReviews.createdAt))
      .limit(1);
    if (reviewRows.length > 0) {
      try {
        const output = JSON.parse(reviewRows[0].outputJson);
        reviewSummary = output.summary ?? undefined;
      } catch { /* ignore parse errors */ }
    }
    return { summary, reviewSummary };
  }

  async getLastSubmissionEvaluationForGuide(guide: typeof dailyGuides.$inferSelect): Promise<string | null> {
    const blockRows = await this.db
      .select()
      .from(dailyGuideBlocks)
      .where(eq(dailyGuideBlocks.guideId, guide.id));
    if (blockRows.length === 0) return null;

    const blockIds = blockRows.map((b) => b.planBlockId);
    const stepRows = await this.db
      .select()
      .from(learningSteps)
      .where(inArray(learningSteps.blockId, blockIds))
      .orderBy(desc(learningSteps.updatedAt))
      .limit(1);
    if (stepRows.length === 0) return null;

    const evalRows = await this.db
      .select()
      .from(learningEvaluations)
      .where(eq(learningEvaluations.stepId, stepRows[0].id))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    if (evalRows.length > 0) {
      return evalRows[0].feedback;
    }
    return null;
  }

  async saveDailyGuideWithTransaction(params: {
    goal: LearningGoal;
    date: string;
    windows: StudyWindow[];
    shortPlanDayId: string;
    dailyGuide: DailyGuideAgentOutput;
  }): Promise<{ goal: LearningGoal; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide }> {
    const now = nowIso();

    return await this.db.transaction(async (tx) => {
      const activeStageRows = await tx
        .select()
        .from(roadmapStages)
        .where(and(eq(roadmapStages.goalId, params.goal.id), eq(roadmapStages.status, 'active')))
        .orderBy(asc(roadmapStages.position))
        .limit(1);
      const activeStageId = activeStageRows[0]?.id ?? null;

      const planId = createId('plan');
      await tx.insert(dailyPlans).values({
        id: planId,
        date: params.date,
        status: 'draft',
        availableWindowsJson: JSON.stringify(params.windows),
        shortPlanDayId: params.shortPlanDayId,
        createdAt: now,
        confirmedAt: null,
        sourceReviewId: null,
        version: 1
      });

      const guideId = createId('daily_guide');
      await tx.insert(dailyGuides).values({
        id: guideId,
        goalId: params.goal.id,
        planId,
        shortPlanDayId: params.shortPlanDayId,
        date: params.date,
        status: 'draft',
        weekFocus: '',
        todayGoal: params.dailyGuide.todayGoal,
        deliverablesJson: JSON.stringify(params.dailyGuide.deliverables),
        boundariesJson: JSON.stringify(params.dailyGuide.boundaries),
        acceptanceCriteriaJson: JSON.stringify(params.dailyGuide.acceptanceCriteria),
        tomorrowActionsJson: JSON.stringify(params.dailyGuide.tomorrowActions),
        createdAt: now,
        confirmedAt: null
      });

      let blockPosition = 0;
      let cursorTime = params.windows[0]?.start ?? '20:00';
      for (const task of params.dailyGuide.tasks) {
        const planBlockId = createId('block');
        const startTime = cursorTime;
        const endTime = addMinutesToClock(startTime, task.estimatedMinutes.target);
        cursorTime = endTime;

        await tx.insert(dailyPlanBlocks).values({
          id: planBlockId, planId, taskId: null,
          startTime, endTime, durationMinutes: task.estimatedMinutes.target,
          objective: task.objective,
          action: task.actions.map((a) => `${a.title}：${a.instruction}`).join('\n'),
          expectedOutput: task.deliverable, difficulty: 'foundation',
          material: '今日主任务',
          successCheck: task.doneWhen.join('；') || task.deliverable,
          fallback: task.quickHint, status: 'planned', position: blockPosition
        });

        const guideTaskId = createId('daily_guide_task');
        await tx.insert(dailyGuideTasks).values({
          id: guideTaskId, guideId, roadmapStageId: activeStageId, legacyPlanBlockId: planBlockId,
          title: task.title, objective: task.objective, scope: task.scope,
          estimatedMinMinutes: task.estimatedMinutes.min,
          estimatedTargetMinutes: task.estimatedMinutes.target,
          estimatedMaxMinutes: task.estimatedMinutes.max,
          deliverable: task.deliverable,
          doneWhenJson: JSON.stringify(task.doneWhen),
          quickHint: task.quickHint,
          evaluationMode: task.evaluationMode,
          submissionPolicy: task.submissionPolicy,
          carryoverAllowed: task.carryoverAllowed,
          status: 'planned', progressPercent: 0, currentActionId: null,
          nextStartPoint: task.actions[0]?.title ?? null,
          totalElapsedMinutes: 0, position: blockPosition,
          createdAt: now, updatedAt: now
        });

        let actionPosition = 0;
        for (const action of task.actions) {
          await tx.insert(dailyGuideActions).values({
            id: createId('daily_guide_action'), taskId: guideTaskId,
            title: action.title, instruction: action.instruction,
            checkpoint: action.checkpoint, status: 'planned',
            progressNote: null, completedAt: null, position: actionPosition++
          });
        }

        await tx.insert(dailyGuideBlocks).values({
          id: createId('daily_guide_block'), guideId, planBlockId,
          title: task.title, position: blockPosition
        });
        blockPosition += 1;
      }

      await tx.insert(planVersions).values({
        id: createId('plan_version'), planId, version: 1,
        changeSummary: `Daily guide for short plan day`,
        snapshotJson: JSON.stringify({ guide: params.dailyGuide }),
        createdAt: now
      });

      const roadmap = await this.listRoadmap(params.goal.id);
      const shortPlan = await this.listShortPlan(params.goal.id);
      const guide = await this.getDailyGuideInTx(tx, guideId);
      if (!guide) throw new Error('Daily guide not found after save');
      return { goal: params.goal, roadmap, shortPlan, guide };
    });
  }

  private async getDailyGuideInTx(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    guideId: string
  ): Promise<DailyGuide | null> {
    const guideRows = await tx.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    if (guideRows.length === 0) return null;
    const guideRow = guideRows[0];

    const guideBlockRows = await tx.select().from(dailyGuideBlocks).where(eq(dailyGuideBlocks.guideId, guideId)).orderBy(asc(dailyGuideBlocks.position));
    const blocks: DailyGuideBlock[] = [];
    for (const guideBlock of guideBlockRows) {
      const planBlockRows = await tx.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, guideBlock.planBlockId)).limit(1);
      if (planBlockRows.length > 0) {
        blocks.push(mapDailyGuideBlock(guideBlock, mapPlanBlock(planBlockRows[0])));
      }
    }

    const taskRows = await tx.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.guideId, guideId)).orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const taskRow of taskRows) {
      const actionRows = await tx.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, taskRow.id)).orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(taskRow, actionRows.map(mapDailyGuideAction)));
    }
    return mapDailyGuide(guideRow, blocks, tasks);
  }

  async completeLearningDay(guideId: string): Promise<void> {
    const guideRows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    if (guideRows.length === 0) throw new Error('Guide not found');
    const guide = guideRows[0];
    await this.db.update(dailyGuides).set({ status: 'completed', sessionStatus: 'closed' }).where(eq(dailyGuides.id, guideId));
    await this.db.update(dailyPlans).set({ status: 'completed' }).where(eq(dailyPlans.id, guide.planId));
  }

  async getActiveGuide(activeOnly: boolean = false): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide | null }> {
    const rows = await this.db
      .select()
      .from(dailyGuides)
      .where(inArray(dailyGuides.status, ['draft', 'confirmed', 'completed']))
      .orderBy(desc(dailyGuides.createdAt));
    const active = activeOnly
      ? rows.find((r) => r.sessionStatus === 'active') ?? null
      : rows.find((r) => r.sessionStatus === 'active') ?? rows[0] ?? null;
    const guide = active ? await this.getDailyGuideById(active.id) : null;
    const goal = guide
      ? await this.getGoal(guide.goalId)
      : (await this.listGoals()).find((item) => item.status === 'active') ?? null;
    const roadmap = goal ? await this.listRoadmap(goal.id) : [];
    const shortPlan = goal ? await this.listShortPlan(goal.id) : [];
    return { goal, roadmap, shortPlan, guide };
  }

  async getGuideByDate(date: string): Promise<DailyGuide | null> {
    const rows = await this.db
      .select()
      .from(dailyGuides)
      .where(and(eq(dailyGuides.date, date), inArray(dailyGuides.status, ['draft', 'confirmed', 'completed'])))
      .orderBy(desc(dailyGuides.createdAt))
      .limit(1);
    return rows[0] ? this.getDailyGuideById(rows[0].id) : null;
  }

  async activateShortPlanDay(shortPlanDayId: string): Promise<boolean> {
    const rows = await this.db
      .update(shortPlanDays)
      .set({ sessionStatus: 'active', date: localDateIso() })
      .where(and(eq(shortPlanDays.id, shortPlanDayId), eq(shortPlanDays.sessionStatus, 'pending')))
      .returning({ id: shortPlanDays.id });
    return rows.length > 0;
  }

  async closeCurrentSession(guideId: string): Promise<void> {
    await this.db
      .update(dailyGuides)
      .set({ sessionStatus: 'closed', status: 'completed' })
      .where(eq(dailyGuides.id, guideId));
    const guideRows = await this.db
      .select()
      .from(dailyGuides)
      .where(eq(dailyGuides.id, guideId))
      .limit(1);
    if (guideRows[0]?.shortPlanDayId) {
      await this.db
        .update(shortPlanDays)
        .set({ sessionStatus: 'completed' })
        .where(eq(shortPlanDays.id, guideRows[0].shortPlanDayId));
    }
  }

  async getDailyGuideTaskByBlockId(blockId: string): Promise<DailyGuideTask | null> {
    const tasks = await this.getDailyGuideTasksByBlockId(blockId);
    return tasks.find((task) => task.legacyPlanBlockId === blockId || task.id === blockId) ?? null;
  }

  async listStages(goalId?: string): Promise<PlanStage[]> {
    const rows = goalId
      ? await this.db.select().from(planStages).where(eq(planStages.goalId, goalId)).orderBy(asc(planStages.position))
      : await this.db.select().from(planStages).orderBy(asc(planStages.position));
    return rows.map(mapStage);
  }

  async startSession(taskId: string): Promise<StudySession> {
    const guideTask = await this.getDailyGuideTaskById(taskId);
    if (!guideTask) throw new Error(`找不到主任务：${taskId}`);
    if (guideTask.status === 'done') {
      throw new Error('当前主任务已完成，不能重新开始学习。');
    }

    const existingSessions = await this.db.select().from(studySessions).where(eq(studySessions.taskId, taskId));
    const existingActive = existingSessions.find((session) => session.status === 'active');
    if (existingActive) {
      return mapSession(existingActive);
    }
    const existingPaused = existingSessions
      .filter((session) => session.status === 'paused')
      .sort((a, b) => new Date(b.endedAt ?? b.startedAt).getTime() - new Date(a.endedAt ?? a.startedAt).getTime())[0];
    if (existingPaused) {
      const resumedAt = nowIso();
      await this.db
        .update(studySessions)
        .set({
          startedAt: resumedAt,
          endedAt: null,
          status: 'active'
        })
        .where(eq(studySessions.id, existingPaused.id));
      const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, existingPaused.id)).limit(1);
      return mapSession(rows[0]);
    }
    const row = {
      id: createId('session'),
      taskId,
      taskItemsId: null,
      startedAt: nowIso(),
      endedAt: null,
      durationMinutes: null,
      status: 'active' as const,
      focusScore: null,
      notes: null
    };
    await this.db.insert(studySessions).values(row);
    await this.initializeLearningForTask(taskId);
    return row;
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'paused');
    if (session.taskId) {
      await this.updateDailyGuideTaskElapsed(session.taskId);
    }
    return session;
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'completed', notes);
    if (session.taskId) {
      await this.updateDailyGuideTaskElapsed(session.taskId);
      const runtime = await this.getOrCreateRuntimeState();
      if (runtime.activeDailyTaskId === session.taskId) {
        await this.upsertRuntimeState({ sessionStatus: 'completed' });
      }
    }
    return session;
  }

  async skipBlock(blockId: string, reason: string): Promise<void> {
    const blocks = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    if (!blocks[0]) throw new Error(`Block not found: ${blockId}`);
    await this.db.update(dailyPlanBlocks).set({ status: 'skipped' }).where(eq(dailyPlanBlocks.id, blockId));
    await this.db.insert(skipLogs).values({
      id: createId('skip'),
      blockId,
      taskId: blocks[0].taskId,
      reason,
      createdAt: nowIso()
    });
  }

  async recordFocusEvent(params: {
    sessionId: string | null;
    appName: string;
    windowTitle: string | null;
    eventType: 'foreground' | 'away' | 'return' | 'unknown';
    durationSeconds?: number;
  }): Promise<void> {
    await this.db.insert(focusEvents).values({
      id: createId('focus'),
      sessionId: params.sessionId,
      appName: params.appName,
      windowTitle: params.windowTitle,
      eventType: params.eventType,
      startedAt: nowIso(),
      endedAt: null,
      durationSeconds: params.durationSeconds
    });
  }

  private async finishSession(
    sessionId: string,
    status: 'paused' | 'completed',
    notes?: string
  ): Promise<StudySession> {
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const endedAt = nowIso();
    const previousSeconds = Math.round((existing.durationMinutes ?? 0) * 60);
    const currentSeconds =
      existing.status === 'active'
        ? Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(existing.startedAt).getTime()) / 1000))
        : 0;
    const durationMinutes = (previousSeconds + currentSeconds) / 60;
    await this.db
      .update(studySessions)
      .set({
        endedAt,
        durationMinutes,
        status,
        notes: notes ?? existing.notes
      })
      .where(eq(studySessions.id, sessionId));
    const updated = await this.db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
    return mapSession(updated[0]);
  }

  async listSessions(): Promise<StudySession[]> {
    const rows = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    return rows.map(mapSession);
  }

  async getAccumulatedSeconds(blockId: string, excludeSessionId?: string): Promise<number> {
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.taskId, blockId));
    let total = 0;
    for (const row of rows) {
      if (excludeSessionId && row.id === excludeSessionId) continue;
      if (row.status === 'completed' || row.status === 'paused') {
        total += Math.round((row.durationMinutes ?? 0) * 60);
      }
    }
    return total;
  }

  async getBlock(blockId: string): Promise<DailyPlanBlock | null> {
    const rows = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    return rows[0] ? mapPlanBlock(rows[0]) : null;
  }

  private async initializeLearningForTask(taskId: string, sessionStatus?: LearningRuntimeState['sessionStatus']): Promise<LearningRuntimeSnapshot> {
    const guideTask = await this.getDailyGuideTaskById(taskId);
    const goal = guideTask
      ? (await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideTask.guideId)).limit(1))[0]
      : null;

    const roadmapRows = goal
      ? await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.goalId)).orderBy(asc(roadmapStages.position)).limit(1)
      : [];
    const stageId = roadmapRows[0]?.id ?? null;

    const currentActionId = guideTask?.currentAction?.id
      ?? guideTask?.actions.find((action) => action.status !== 'done' && action.status !== 'skipped')?.id
      ?? null;

    await this.upsertRuntimeState({
      activeGoalId: goal?.goalId ?? null,
      activeStageId: stageId,
      activeDailyTaskId: guideTask?.id ?? null,
      activeStepId: currentActionId,
      activeQuestionThreadId: null,
      sessionStatus
    });

    return this.getLearningRuntimeSnapshot();
  }

  async getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    const state = await this.getOrCreateRuntimeState();
    const [goal, questionThread] = await Promise.all([
      state.activeGoalId ? this.getGoal(state.activeGoalId) : Promise.resolve(null),
      state.activeQuestionThreadId ? this.getQuestionThread(state.activeQuestionThreadId) : Promise.resolve(null)
    ]);

    let dailyGuide: DailyGuide | null = null;
    let dailyGuideTask: DailyGuideTask | null = null;
    let dailyGuideAction: DailyGuideAction | null = null;
    let roadmapStage: RoadmapStage | null = null;

    if (state.activeDailyTaskId) {
      dailyGuideTask = await this.getDailyGuideTaskById(state.activeDailyTaskId);
      if (dailyGuideTask) {
        dailyGuide = await this.getDailyGuideById(dailyGuideTask.guideId);
        if (state.activeStepId) {
          dailyGuideAction = dailyGuideTask.actions.find((a) => a.id === state.activeStepId) ?? null;
        }
      }
    }

    if (state.activeStageId) {
      const rsRows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.id, state.activeStageId)).limit(1);
      roadmapStage = rsRows[0] ? mapRoadmapStage(rsRows[0]) : null;
    } else if (goal) {
      const rsRows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goal.id)).orderBy(asc(roadmapStages.position)).limit(1);
      roadmapStage = rsRows[0] ? mapRoadmapStage(rsRows[0]) : null;
    }

    const questionThreadId = questionThread?.id ?? null;
    const [questionMessageRows, latestSubmission, latestEvaluation, latestDecision] = await Promise.all([
      questionThreadId ? this.listQuestionMessages(questionThreadId) : Promise.resolve([]),
      state.activeStepId ? this.getLatestSubmissionByActionId(state.activeStepId) : Promise.resolve(null),
      state.activeStepId ? this.getLatestEvaluationByActionId(state.activeStepId) : Promise.resolve(null),
      state.activeStepId ? this.getLatestDecisionByActionId(state.activeStepId) : Promise.resolve(null)
    ]);
    const pendingAdjustment = await this.getPendingAdjustment({
      goalId: goal?.id ?? null,
      stageId: null,
      taskId: null
    });

    return {
      state,
      goal,
      dailyGuide,
      dailyGuideTask,
      dailyGuideAction,
      roadmapStage,
      questionThread,
      questionMessages: questionMessageRows,
      latestSubmission,
      latestEvaluation,
      latestDecision,
      pendingAdjustment
    };
  }

  async updateCurrentStepFromTeaching(stepId: string, output: TeachStepAgentOutput): Promise<LearningStep> {
    await this.db
      .update(learningSteps)
      .set({
        title: output.title,
        objective: output.objective,
        instruction: output.instruction,
        expectedOutput: output.expectedOutput,
        successCriteria: output.successCriteria,
        status: output.requiresSubmission ? 'waiting_for_submission' : 'active',
        updatedAt: nowIso()
      })
      .where(eq(learningSteps.id, stepId));
    const step = await this.getLearningStep(stepId);
    if (!step) throw new Error(`Step not found after teaching update: ${stepId}`);
    return step;
  }

  async completeCurrentAction(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getLearningRuntimeSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId) {
      throw new Error('当前没有可完成的主任务步骤。请先开始学习。');
    }

    const task = snapshot.dailyGuideTask;
    const tasks = task ? [task] : [];
    if (!task) {
      throw new Error('当前主任务没有可记录的行动步骤。');
    }
    if (task.actions.length === 0) {
      throw new Error('当前主任务没有行动步骤。');
    }

    const currentAction = task.currentAction ?? task.actions.find((action) => action.status !== 'done') ?? null;
    if (!currentAction) {
      return snapshot;
    }

    const now = nowIso();
    const result = completeAction({
      tasks,
      activeDailyTaskId: taskId,
      activeStepId: currentAction.id
    }, currentAction.id);
    if (!result.ok) {
      throw new Error(result.conflict.message);
    }
    await this.persistExecutionState(result.state, now);

    let activeStepId = snapshot.dailyGuideAction?.id ?? null;

    const updatedTask = result.state.tasks.find((item) => item.id === task.id) ?? task;
    const nextAction = updatedTask.currentAction;
    if (nextAction) {
      activeStepId = nextAction.id;
    } else {
      activeStepId = null;
    }

    await this.upsertRuntimeState({
      activeDailyTaskId: taskId,
      activeStepId,
      activeQuestionThreadId: null,
      sessionStatus: snapshot.state.sessionStatus === 'idle' ? 'active' : snapshot.state.sessionStatus
    });

    return this.getLearningRuntimeSnapshot();
  }

  async skipCurrentAction(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getLearningRuntimeSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId || !snapshot.dailyGuideTask) return snapshot;

    const tasks = [snapshot.dailyGuideTask];
    const currentAction = snapshot.dailyGuideTask.currentAction
      ?? snapshot.dailyGuideTask.actions.find((a) => a.status !== 'done')
      ?? null;
    if (!currentAction) return snapshot;

    const result = skipAction({
      tasks,
      activeDailyTaskId: taskId,
      activeStepId: currentAction.id
    });
    if (!result.ok) throw new Error(result.conflict.message);

    await this.persistExecutionState(result.state, nowIso());
    const updatedTask = result.state.tasks.find((t) => t.id === taskId);
    const nextAction = updatedTask?.currentAction ?? null;
    await this.upsertRuntimeState({
      activeDailyTaskId: taskId,
      activeStepId: nextAction?.id ?? null,
      activeQuestionThreadId: null,
      sessionStatus: snapshot.state.sessionStatus === 'idle' ? 'active' : snapshot.state.sessionStatus
    });
    return this.getLearningRuntimeSnapshot();
  }

  async skipCurrentTask(): Promise<LearningRuntimeSnapshot> {
    const snapshot = await this.getLearningRuntimeSnapshot();
    const taskId = snapshot.state.activeDailyTaskId;
    if (!taskId || !snapshot.dailyGuideTask) return snapshot;

    const tasks = [snapshot.dailyGuideTask];
    const result = skipTask({ tasks, activeDailyTaskId: taskId, activeStepId: null });
    if (!result.ok) throw new Error(result.conflict.message);

    await this.persistExecutionState(result.state, nowIso());
    const updatedTask = result.state.tasks.find((t) => t.id === taskId);
    const nextTask = result.state.tasks.find((t) => t.status === 'active');

    await this.upsertRuntimeState({
      activeDailyTaskId: nextTask?.id ?? null,
      activeStepId: nextTask?.currentAction?.id ?? null,
      activeQuestionThreadId: null,
      sessionStatus: snapshot.state.sessionStatus === 'idle' ? 'active' : snapshot.state.sessionStatus
    });

    if (!nextTask && snapshot.dailyGuide?.id) {
      await this.closeCurrentSession(snapshot.dailyGuide.id);
    }

    return this.getLearningRuntimeSnapshot();
  }

  async terminateLearning(): Promise<LearningRuntimeSnapshot> {
    await this.upsertRuntimeState({ sessionStatus: 'completed' });
    return this.getLearningRuntimeSnapshot();
  }

  async openQuestion(actionId: string, question: string): Promise<QuestionThread> {
    const now = nowIso();
    const threadId = createId('question');
    await this.db.insert(questionThreads).values({
      id: threadId,
      goalId: null,
      stageId: null,
      taskId: null,
      stepId: null,
      dailyGuideActionId: actionId,
      status: 'open',
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
    await this.upsertRuntimeState({ activeQuestionThreadId: threadId });
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error('Question thread was not saved.');
    return thread;
  }

  private async __old_openQuestion_placeholder(stepId: string, question: string): Promise<QuestionThread> {
    // Placeholder to consume the old method body that follows
    const now = nowIso();
    const threadId = createId('question');
    await this.db.insert(questionThreads).values({
      id: threadId,
      goalId: null,
      stageId: null,
      taskId: null,
      stepId,
      status: 'open',
      question,
      resolutionSummary: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null
    });
    await this.db.insert(questionMessages).values({
      id: createId('question_message'),
      threadId,
      role: 'user',
      content: question,
      createdAt: now
    });
    await this.upsertRuntimeState({ activeQuestionThreadId: threadId });
    const thread = await this.getQuestionThread(threadId);
    if (!thread) throw new Error(`Question thread not found after create: ${threadId}`);
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
    const state = await this.getOrCreateRuntimeState();
    if (state.activeQuestionThreadId === threadId) {
      await this.upsertRuntimeState({ activeQuestionThreadId: null });
    }
  }

  async createSubmission(
    actionId: string,
    sessionId: string | null,
    content: string
  ): Promise<LearningSubmission> {
    const row: LearningSubmission = {
      id: createId('submission'),
      stepId: null,
      dailyGuideActionId: actionId,
      sessionId,
      content,
      evaluationStatus: 'waiting',
      createdAt: nowIso()
    };
    await this.db.insert(learningSubmissions).values(row);
    return row;
  }

  async getSubmissionById(submissionId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(eq(learningSubmissions.id, submissionId))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  async markSubmissionEvaluation(
    submissionId: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    await this.db
      .update(learningSubmissions)
      .set({ evaluationStatus: status })
      .where(eq(learningSubmissions.id, submissionId));
  }

  async acquireGenerationLock(lockKey: string, ttlMs: number = 120_000): Promise<boolean> {
    const now = Date.now();
    const staleThreshold = new Date(now - ttlMs).toISOString();
    await this.db
      .delete(generationLocks)
      .where(lt(generationLocks.lockedAt, staleThreshold));
    const existing = await this.db
      .select()
      .from(generationLocks)
      .where(eq(generationLocks.lockKey, lockKey))
      .limit(1);
    if (existing.length > 0) return false;
    try {
      await this.db.insert(generationLocks).values({
        lockKey,
        lockedAt: nowIso()
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseGenerationLock(lockKey: string): Promise<void> {
    await this.db
      .delete(generationLocks)
      .where(eq(generationLocks.lockKey, lockKey));
  }

  async saveEvaluationAndDecision(params: {
    submission: LearningSubmission;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{ evaluation: LearningEvaluation; decision: StoredNextStepDecision; nextAction: DailyGuideAction | null }> {
    const now = nowIso();
    const evaluationId = createId('evaluation');
    await this.db.insert(learningEvaluations).values({
      id: evaluationId,
      submissionId: params.submission.id,
      stepId: null,
      dailyGuideActionId: params.submission.dailyGuideActionId ?? null,
      result: params.evaluationOutput.result,
      mastery: params.evaluationOutput.mastery,
      evidenceJson: JSON.stringify(params.evaluationOutput.evidence),
      correctPartsJson: JSON.stringify(params.evaluationOutput.correctParts),
      misconceptionsJson: JSON.stringify(params.evaluationOutput.misconceptions),
      missingRequirementsJson: JSON.stringify(params.evaluationOutput.missingRequirements),
      feedback: params.evaluationOutput.feedback,
      recommendedAction: params.evaluationOutput.recommendedAction,
      decision: params.evaluationOutput.decision,
      aiReviewId: params.evaluationAiReviewId ?? null,
      createdAt: now
    });

    const decisionId = createId('decision');
    await this.db.insert(nextStepDecisions).values({
      id: decisionId,
      evaluationId,
      stepId: null,
      decision: params.decisionOutput.decision,
      reason: params.decisionOutput.reason,
      taskCompleted: params.decisionOutput.taskCompleted,
      nextStepJson: params.decisionOutput.nextStep ? JSON.stringify(params.decisionOutput.nextStep) : null,
      remediationJson: params.decisionOutput.remediation ? JSON.stringify(params.decisionOutput.remediation) : null,
      carryForward: params.decisionOutput.carryForward || null,
      aiReviewId: params.decisionAiReviewId ?? null,
      createdAt: now
    });

    // Get current state from runtime snapshot
    const snapshot = await this.getLearningRuntimeSnapshot();
    const task = snapshot.dailyGuideTask;
    const action = snapshot.dailyGuideAction;
    if (!task) throw new Error('当前没有进行中的主任务。');
    if (!action) throw new Error('当前没有进行中的学习步骤。');

    // Mark submission evaluation completed (covers both pass and fail paths)
    await this.markSubmissionEvaluation(params.submission.id, 'completed');

    const passed = isPassingEvaluation(params.evaluationOutput);

    // ── NOT passed: keep current state, allow retry ──
    if (!passed) {
      const evaluation = await this.getEvaluation(evaluationId);
      const decision = await this.getDecision(decisionId);
      if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
      return { evaluation, decision, nextAction: null };
    }

    // ── PASSED: mark current action done ──
    await this.db
      .update(dailyGuideActions)
      .set({ status: 'done', completedAt: now })
      .where(eq(dailyGuideActions.id, action.id));

    // Load all actions for this task to find the next one
    const allActions = await this.db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, task.id))
      .orderBy(asc(dailyGuideActions.position));
    const nextAction = allActions.find(
      (a) => a.id !== action.id && a.status !== 'done' && a.status !== 'skipped'
    ) ?? null;

    // ── Same task, next action exists ──
    if (nextAction) {
      const nextActionMapped = mapDailyGuideAction(nextAction);
      await this.db
        .update(dailyGuideTasks)
        .set({ currentActionId: nextAction.id, updatedAt: now })
        .where(eq(dailyGuideTasks.id, task.id));
      await this.upsertRuntimeState({
        activeStepId: nextAction.id,
        activeDailyTaskId: task.id,
        activeQuestionThreadId: null,
        sessionStatus: 'active'
      });
      const evaluation = await this.getEvaluation(evaluationId);
      const decision = await this.getDecision(decisionId);
      if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
      return { evaluation, decision, nextAction: nextActionMapped };
    }

    // ── Task done: mark task complete, find next task ──
    const completedCount = allActions.filter((a) => a.status === 'done').length;
    const progressPercent = allActions.length > 0
      ? Math.round((completedCount / allActions.length) * 100)
      : 100;
    await this.db
      .update(dailyGuideTasks)
      .set({
        status: 'done',
        progressPercent,
        currentActionId: null,
        nextStartPoint: null,
        updatedAt: now
      })
      .where(eq(dailyGuideTasks.id, task.id));

    // Load all tasks for this guide
    const allTasks = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, task.guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const nextTaskRow = allTasks.find(
      (t) => t.id !== task.id && t.status !== 'done' && t.status !== 'skipped' && t.status !== 'deferred'
    ) ?? null;

    // ── Next task exists ──
    if (nextTaskRow) {
      const nextTaskActions = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, nextTaskRow.id))
        .orderBy(asc(dailyGuideActions.position));
      const firstAction = nextTaskActions.find(
        (a) => a.status !== 'done' && a.status !== 'skipped'
      ) ?? null;
      const firstActionId = firstAction?.id ?? null;

      await this.db
        .update(dailyGuideTasks)
        .set({
          status: 'active',
          currentActionId: firstActionId,
          updatedAt: now
        })
        .where(eq(dailyGuideTasks.id, nextTaskRow.id));

      await this.upsertRuntimeState({
        activeDailyTaskId: nextTaskRow.id,
        activeStepId: firstActionId,
        activeQuestionThreadId: null,
        sessionStatus: 'active'
      });

      const nextTask = mapDailyGuideTask(nextTaskRow,
        nextTaskActions.map(mapDailyGuideAction));
      const evaluation = await this.getEvaluation(evaluationId);
      const decision = await this.getDecision(decisionId);
      if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
      return {
        evaluation,
        decision,
        nextAction: nextTask.currentAction ?? nextTask.actions[0] ?? null
      };
    }

    // ── Guide complete ──
    await this.completeLearningDay(task.guideId);
    await this.upsertRuntimeState({
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'completed'
    });

    const evaluation = await this.getEvaluation(evaluationId);
    const decision = await this.getDecision(decisionId);
    if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');

    const guide = await this.getDailyGuideById(task.guideId);
    if (guide) {
      const goalRows = await this.db.select().from(goals).where(eq(goals.id, guide.goalId)).limit(1);
      if (goalRows[0]) {
        await this.applyEvaluationDecisionToRoadmap({
          goalId: goalRows[0].id,
          taskId: task.id,
          decision: params.evaluationOutput.decision,
          taskCompleted: params.decisionOutput.taskCompleted
        });
      }
    }

    return { evaluation, decision, nextAction: null };
  }

  async applyEvaluationDecisionToRoadmap(params: {
    goalId: string;
    taskId: string;
    decision: 'advance' | 'stay' | 'remediate' | 'replan';
    taskCompleted: boolean;
  }): Promise<void> {
    if (!params.goalId) return;

    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.id, params.taskId))
      .limit(1);
    const task = taskRows[0];
    if (!task) return;

    const stageId = task.roadmapStageId;
    if (!stageId) return;

    const now = nowIso();

    // Idempotency: if this stage is already completed, don't re-apply
    const stageRows = await this.db
      .select({ status: roadmapStages.status })
      .from(roadmapStages)
      .where(eq(roadmapStages.id, stageId))
      .limit(1);
    const currentStageStatus = stageRows[0]?.status;

    if (params.decision === 'advance' && params.taskCompleted) {
      if (currentStageStatus === 'completed') return;
      await this.db
        .update(roadmapStages)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(roadmapStages.id, stageId));

      const currentStageRows = await this.db
        .select({ position: roadmapStages.position })
        .from(roadmapStages)
        .where(eq(roadmapStages.id, stageId))
        .limit(1);
      if (currentStageRows[0]) {
        const nextStageRows = await this.db
          .select()
          .from(roadmapStages)
          .where(and(eq(roadmapStages.goalId, params.goalId), gt(roadmapStages.position, currentStageRows[0].position)))
          .orderBy(asc(roadmapStages.position))
          .limit(1);
        if (nextStageRows[0]) {
          await this.db
            .update(roadmapStages)
            .set({ status: 'active', updatedAt: now })
            .where(eq(roadmapStages.id, nextStageRows[0].id));
        }
      }
    } else if (params.decision === 'stay' || params.decision === 'remediate') {
      await this.db
        .update(roadmapStages)
        .set({ status: 'active', updatedAt: now })
        .where(eq(roadmapStages.id, stageId));
    } else if (params.decision === 'replan') {
      await this.db
        .update(roadmapStages)
        .set({ status: 'adjusted', updatedAt: now })
        .where(eq(roadmapStages.id, stageId));
    }
  }

  async syncRoadmapProgressBeforeRollingPlan(goalId: string): Promise<void> {
    const latestEvalRows = await this.db
      .select()
      .from(learningEvaluations)
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    if (latestEvalRows.length === 0) return;

    const latestEval = latestEvalRows[0];
    if (!latestEval.decision || latestEval.decision === 'stay') return;

    const submissionRows = await this.db
      .select()
      .from(learningSubmissions)
      .where(eq(learningSubmissions.id, latestEval.submissionId))
      .limit(1);
    if (submissionRows.length === 0) return;

    const actionId = submissionRows[0].dailyGuideActionId;
    if (!actionId) return;

    const actionRows = await this.db
      .select({ taskId: dailyGuideActions.taskId })
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.id, actionId))
      .limit(1);
    if (actionRows.length === 0 || !actionRows[0].taskId) return;

    await this.applyEvaluationDecisionToRoadmap({
      goalId,
      taskId: actionRows[0].taskId,
      decision: latestEval.decision as 'advance' | 'stay' | 'remediate' | 'replan',
      taskCompleted: true
    });
  }

  async listPlanAdjustmentProposals(status?: PlanAdjustmentProposal['status']): Promise<PlanAdjustmentProposal[]> {
    const rows = status
      ? await this.db
          .select()
          .from(planAdjustmentProposals)
          .where(eq(planAdjustmentProposals.status, status))
          .orderBy(desc(planAdjustmentProposals.createdAt))
      : await this.db.select().from(planAdjustmentProposals).orderBy(desc(planAdjustmentProposals.createdAt));
    return rows.map(mapPlanAdjustmentProposal);
  }

  async decidePlanAdjustment(proposalId: string, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> {
    const existingRows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!existingRows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);

    const existing = mapPlanAdjustmentProposal(existingRows[0]);
    const now = nowIso();
    let appliedTaskId = existing.appliedTaskId;
    let appliedAt = existing.appliedAt;

    if (status === 'accepted' && !appliedTaskId) {
      appliedTaskId = await this.createFollowUpTaskFromAdjustment(existing);
      appliedAt = appliedTaskId ? now : null;
    }

    await this.db
      .update(planAdjustmentProposals)
      .set({
        status,
        decidedAt: now,
        appliedTaskId,
        appliedAt
      })
      .where(eq(planAdjustmentProposals.id, proposalId));
    const rows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.id, proposalId))
      .limit(1);
    if (!rows[0]) throw new Error(`Plan adjustment proposal not found: ${proposalId}`);
    return mapPlanAdjustmentProposal(rows[0]);
  }

  private async createFollowUpTaskFromAdjustment(proposal: PlanAdjustmentProposal): Promise<string | null> {
    const sourceTask = proposal.taskId ? await this.getTask(proposal.taskId) : null;
    const proposed = readProposedChanges(proposal.proposedChanges);
    const nextFocus = proposed.nextFocus || proposed.carryForward || proposal.reason;
    const cleanFocus = nextFocus.trim();
    if (!cleanFocus) return null;

    const now = nowIso();
    const id = createId('task');
    const missing = proposed.missingRequirements.length > 0
      ? proposed.missingRequirements.join('；')
      : cleanFocus;
    const misconceptions = proposed.misconceptions.length > 0
      ? `\n需要纠正：${proposed.misconceptions.join('；')}`
      : '';

    await this.db.insert(taskItems).values({
      id,
      goalId: proposal.goalId ?? sourceTask?.goalId ?? null,
      sourceImportId: null,
      title: `跟进：${truncateText(cleanFocus, 42)}`,
      description: `由学习评估生成的后续计划调整。\n原因：${proposal.reason}${misconceptions}`,
      status: 'backlog',
      priority: sourceTask?.priority ?? 3,
      difficulty: sourceTask?.difficulty ?? difficultyFromRecommendedAction(proposed.recommendedAction),
      estimateMinutes: Math.max(10, Math.min(sourceTask?.estimateMinutes ?? 10, 60)),
      acceptanceCriteria: missing,
      createdAt: now,
      updatedAt: now
    });

    return id;
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

  private async listRoadmap(goalId: string): Promise<RoadmapStage[]> {
    const rows = await this.db.select().from(roadmapStages).where(eq(roadmapStages.goalId, goalId)).orderBy(asc(roadmapStages.position));
    return rows.map(mapRoadmapStage);
  }

  private async listShortPlan(goalId: string): Promise<ShortPlanDay[]> {
    const rows = await this.db.select().from(shortPlanDays).where(eq(shortPlanDays.goalId, goalId)).orderBy(asc(shortPlanDays.dayIndex));
    return rows.map(mapShortPlanDay);
  }

  async getPlanVersionsForGoal(goalId: string): Promise<Array<{ version: number; changeSummary: string; createdAt: string; snapshot: unknown }>> {
    const rows = await this.db
      .select({ version: planVersions.version, changeSummary: planVersions.changeSummary, createdAt: planVersions.createdAt, snapshotJson: planVersions.snapshotJson })
      .from(planVersions)
      .innerJoin(dailyPlans, eq(planVersions.planId, dailyPlans.id))
      .innerJoin(dailyGuides, eq(dailyGuides.planId, dailyPlans.id))
      .where(eq(dailyGuides.goalId, goalId))
      .orderBy(desc(planVersions.createdAt))
      .limit(10);
    return rows.map((r) => ({
      version: r.version,
      changeSummary: r.changeSummary ?? '',
      createdAt: r.createdAt,
      snapshot: r.snapshotJson ? JSON.parse(r.snapshotJson) : null
    }));
  }

  async getDailyGuideById(guideId: string): Promise<DailyGuide | null> {
    const rows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.id, guideId)).limit(1);
    const guide = rows[0];
    if (!guide) return null;
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of taskRows) {
      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, task.id))
        .orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    const guideBlockRows = await this.db
      .select()
      .from(dailyGuideBlocks)
      .where(eq(dailyGuideBlocks.guideId, guideId))
      .orderBy(asc(dailyGuideBlocks.position));
    const blocks: DailyGuideBlock[] = [];
    for (const guideBlock of guideBlockRows) {
      const planBlock = await this.getBlock(guideBlock.planBlockId);
      if (planBlock) {
        blocks.push(mapDailyGuideBlock(guideBlock, planBlock));
      }
    }
    return mapDailyGuide(guide, blocks, tasks);
  }

  private async updateDailyGuideTaskElapsed(blockId: string): Promise<void> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.legacyPlanBlockId, blockId))
      .limit(1);
    const task = taskRows[0];
    if (!task) return;
    const sessions = await this.db.select().from(studySessions).where(eq(studySessions.taskId, blockId));
    const totalElapsedMinutes = Math.round(sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0));
    await this.db
      .update(dailyGuideTasks)
      .set({
        totalElapsedMinutes,
        updatedAt: nowIso()
      })
      .where(eq(dailyGuideTasks.id, task.id));
  }

  private async getDailyGuideTasksByBlockId(blockId: string): Promise<DailyGuideTask[]> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.legacyPlanBlockId, blockId))
      .limit(1);
    const currentTask = taskRows[0];
    if (!currentTask) return [];

    const guideTaskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.guideId, currentTask.guideId))
      .orderBy(asc(dailyGuideTasks.position));
    const tasks: DailyGuideTask[] = [];
    for (const task of guideTaskRows) {
      const actionRows = await this.db
        .select()
        .from(dailyGuideActions)
        .where(eq(dailyGuideActions.taskId, task.id))
        .orderBy(asc(dailyGuideActions.position));
      tasks.push(mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction)));
    }
    return tasks;
  }

  private async persistExecutionState(state: Pick<ExecutionState, 'tasks'>, timestamp: string): Promise<void> {
    for (const task of state.tasks) {
      await this.db
        .update(dailyGuideTasks)
        .set({
          status: task.status,
          progressPercent: task.progressPercent,
          currentActionId: task.status === 'active' ? task.currentAction?.id ?? null : null,
          nextStartPoint: task.nextStartPoint,
          updatedAt: timestamp
        })
        .where(eq(dailyGuideTasks.id, task.id));
      for (const action of task.actions) {
        await this.db
          .update(dailyGuideActions)
          .set({
            status: action.status,
            completedAt: action.status === 'done' ? (action.completedAt ?? timestamp) : action.completedAt
          })
          .where(eq(dailyGuideActions.id, action.id));
      }
      if (task.legacyPlanBlockId && task.status === 'done') {
        await this.db
          .update(dailyPlanBlocks)
          .set({ status: 'done' })
          .where(eq(dailyPlanBlocks.id, task.legacyPlanBlockId));
      }
    }
  }

  private async createStepForActiveExecutionTask(
    state: ExecutionState,
    currentStep: LearningStep
  ): Promise<LearningStep | null> {
    const activeTask = state.activeDailyTaskId
      ? state.tasks.find((task) => task.id === state.activeDailyTaskId || task.legacyPlanBlockId === state.activeDailyTaskId) ?? null
      : null;
    const nextAction = activeTask?.currentAction ?? null;
    if (!activeTask?.legacyPlanBlockId || !nextAction) {
      await this.upsertRuntimeState({
        activeDailyTaskId: null,
        activeStepId: null,
        activeQuestionThreadId: null,
        sessionStatus: 'completed'
      });
      return null;
    }

    const nextBlockRows = await this.db
      .select()
      .from(dailyPlanBlocks)
      .where(eq(dailyPlanBlocks.id, activeTask.legacyPlanBlockId))
      .limit(1);
    const nextBlock = nextBlockRows[0] ?? null;

    await this.db
      .update(dailyPlanBlocks)
      .set({ status: 'active' })
      .where(eq(dailyPlanBlocks.id, activeTask.legacyPlanBlockId));

    const nextStep = await this.createLearningStep({
      goalId: currentStep.goalId,
      stageId: currentStep.stageId,
      taskId: nextBlock?.taskId ?? null,
      blockId: activeTask.legacyPlanBlockId,
      title: nextAction.title,
      objective: activeTask.objective,
      instruction: nextAction.instruction,
      expectedOutput: activeTask.deliverable,
      successCriteria: nextAction.checkpoint,
      status: 'active',
      attempt: 1,
      position: nextAction.position
    });

    await this.upsertRuntimeState({
      activeDailyTaskId: activeTask.legacyPlanBlockId,
      activeStepId: nextStep.id,
      activeQuestionThreadId: null,
      sessionStatus: 'idle'
    });

    return nextStep;
  }

  private async getTask(taskId: string): Promise<TaskItem | null> {
    const rows = await this.db.select().from(taskItems).where(eq(taskItems.id, taskId)).limit(1);
    return rows[0] ? mapTask(rows[0]) : null;
  }

  private async getStage(stageId: string): Promise<PlanStage | null> {
    const rows = await this.db.select().from(planStages).where(eq(planStages.id, stageId)).limit(1);
    return rows[0] ? mapStage(rows[0]) : null;
  }

  private async getDailyGuideTaskById(taskId: string): Promise<DailyGuideTask | null> {
    const taskRows = await this.db.select().from(dailyGuideTasks).where(eq(dailyGuideTasks.id, taskId)).limit(1);
    if (!taskRows[0]) return null;
    const actionRows = await this.db.select().from(dailyGuideActions).where(eq(dailyGuideActions.taskId, taskId)).orderBy(asc(dailyGuideActions.position));
    return mapDailyGuideTask(taskRows[0], actionRows.map(mapDailyGuideAction));
  }

  private async getLatestSubmissionByActionId(actionId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(or(
        eq(learningSubmissions.dailyGuideActionId, actionId),
        eq(learningSubmissions.stepId, actionId)
      ))
      .orderBy(desc(learningSubmissions.createdAt))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  private async getLatestEvaluationByActionId(actionId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db
      .select()
      .from(learningEvaluations)
      .where(or(
        eq(learningEvaluations.dailyGuideActionId, actionId),
        eq(learningEvaluations.stepId, actionId)
      ))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }

  private async getLatestDecisionByActionId(actionId: string): Promise<StoredNextStepDecision | null> {
    const evaluationRows = await this.db
      .select({ id: learningEvaluations.id })
      .from(learningEvaluations)
      .where(or(
        eq(learningEvaluations.dailyGuideActionId, actionId),
        eq(learningEvaluations.stepId, actionId)
      ))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    if (!evaluationRows[0]) return null;
    const rows = await this.db
      .select()
      .from(nextStepDecisions)
      .where(eq(nextStepDecisions.evaluationId, evaluationRows[0].id))
      .orderBy(desc(nextStepDecisions.createdAt))
      .limit(1);
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  private async getLearningStep(stepId: string): Promise<LearningStep | null> {
    const rows = await this.db.select().from(learningSteps).where(eq(learningSteps.id, stepId)).limit(1);
    return rows[0] ? mapLearningStep(rows[0]) : null;
  }

  private async getOrCreateRuntimeState(): Promise<LearningRuntimeState> {
    const rows = await this.db
      .select()
      .from(learningRuntimeStates)
      .where(eq(learningRuntimeStates.id, 'default'))
      .limit(1);
    if (rows[0]) return mapRuntimeState(rows[0]);

    const row = {
      id: 'default' as const,
      activeGoalId: null,
      activeStageId: null,
      activeDailyTaskId: null,
      activeStepId: null,
      activeQuestionThreadId: null,
      sessionStatus: 'idle' as const,
      updatedAt: nowIso()
    };
    await this.db.insert(learningRuntimeStates).values(row);
    return row;
  }

  private async upsertRuntimeState(patch: Partial<Omit<LearningRuntimeState, 'id' | 'updatedAt'>>): Promise<LearningRuntimeState> {
    const current = await this.getOrCreateRuntimeState();
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    await this.db
      .insert(learningRuntimeStates)
      .values(next)
      .onConflictDoUpdate({
        target: learningRuntimeStates.id,
        set: {
          activeGoalId: next.activeGoalId,
          activeStageId: next.activeStageId,
          activeDailyTaskId: next.activeDailyTaskId,
          activeStepId: next.activeStepId,
          activeQuestionThreadId: next.activeQuestionThreadId,
          sessionStatus: next.sessionStatus,
          updatedAt: next.updatedAt
        }
      });
    if (next.activeStepId) this.cachedActiveStepId = next.activeStepId;
    return next;
  }

  private async getOrCreateActiveStepForAction(params: {
    blockId: string;
    taskId: string | null;
    guideTask: DailyGuideTask;
    action: DailyGuideAction;
    goal: LearningGoal | null;
    stage: PlanStage | null;
  }): Promise<LearningStep> {
    const rows = await this.db
      .select()
      .from(learningSteps)
      .where(eq(learningSteps.blockId, params.blockId))
      .orderBy(asc(learningSteps.position));
    const active = rows
      .map(mapLearningStep)
      .find((step) => ['active', 'waiting_for_submission', 'needs_revision'].includes(step.status));
    if (active) return active;
    return this.createLearningStep({
      goalId: params.goal?.id ?? null,
      stageId: params.stage?.id ?? null,
      taskId: params.taskId,
      blockId: params.blockId,
      title: params.action.title,
      objective: params.guideTask.objective,
      instruction: params.action.instruction,
      expectedOutput: params.guideTask.deliverable,
      successCriteria: params.action.checkpoint,
      status: 'active',
      attempt: 1,
      position: params.action.position
    });
  }

  private async createLearningStep(params: {
    goalId: string | null;
    stageId: string | null;
    taskId: string | null;
    blockId: string | null;
    title: string;
    objective: string;
    instruction: string;
    expectedOutput: string;
    successCriteria: string;
    status: LearningStep['status'];
    attempt: number;
    position: number;
  }): Promise<LearningStep> {
    const now = nowIso();
    const row = {
      id: createId('step'),
      goalId: params.goalId,
      stageId: params.stageId,
      taskId: params.taskId,
      blockId: params.blockId,
      title: params.title,
      objective: params.objective,
      instruction: params.instruction,
      expectedOutput: params.expectedOutput,
      successCriteria: params.successCriteria,
      status: params.status,
      attempt: params.attempt,
      position: params.position,
      summary: null,
      createdAt: now,
      updatedAt: now
    };
    await this.db.insert(learningSteps).values(row);
    return row;
  }

  private async getQuestionThread(threadId: string): Promise<QuestionThread | null> {
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

  private async listRecentStepSummaries(blockId: string, activeStepId: string): Promise<LearningSummary[]> {
    const steps = await this.db
      .select()
      .from(learningSteps)
      .where(eq(learningSteps.blockId, blockId))
      .orderBy(desc(learningSteps.position));
    const summaries: LearningSummary[] = [];
    for (const step of steps) {
      if (step.id === activeStepId) continue;
      const rows = await this.db
        .select()
        .from(learningSummaries)
        .where(eq(learningSummaries.refId, step.id))
        .orderBy(desc(learningSummaries.createdAt))
        .limit(1);
      if (rows[0]) summaries.push(mapLearningSummary(rows[0]));
      if (summaries.length >= 3) break;
    }
    return summaries;
  }

  private async getLatestSubmission(stepId: string): Promise<LearningSubmission | null> {
    const rows = await this.db
      .select()
      .from(learningSubmissions)
      .where(eq(learningSubmissions.stepId, stepId))
      .orderBy(desc(learningSubmissions.createdAt))
      .limit(1);
    return rows[0] ? mapSubmission(rows[0]) : null;
  }

  private async getLatestEvaluation(stepId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db
      .select()
      .from(learningEvaluations)
      .where(eq(learningEvaluations.stepId, stepId))
      .orderBy(desc(learningEvaluations.createdAt))
      .limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }

  private async getLatestDecision(stepId: string): Promise<StoredNextStepDecision | null> {
    const rows = await this.db
      .select()
      .from(nextStepDecisions)
      .where(eq(nextStepDecisions.stepId, stepId))
      .orderBy(desc(nextStepDecisions.createdAt))
      .limit(1);
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  private async getPendingAdjustment(params: {
    goalId: string | null;
    stageId: string | null;
    taskId: string | null;
  }): Promise<PlanAdjustmentProposal | null> {
    const rows = await this.db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.status, 'pending'))
      .orderBy(desc(planAdjustmentProposals.createdAt));
    const mapped = rows.map(mapPlanAdjustmentProposal);
    return (
      mapped.find((item) => params.taskId && item.taskId === params.taskId) ??
      mapped.find((item) => params.stageId && item.stageId === params.stageId) ??
      mapped.find((item) => params.goalId && item.goalId === params.goalId) ??
      null
    );
  }

  private async getEvaluation(evaluationId: string): Promise<LearningEvaluation | null> {
    const rows = await this.db.select().from(learningEvaluations).where(eq(learningEvaluations.id, evaluationId)).limit(1);
    return rows[0] ? mapEvaluation(rows[0]) : null;
  }

  private async getDecision(decisionId: string): Promise<StoredNextStepDecision | null> {
    const rows = await this.db.select().from(nextStepDecisions).where(eq(nextStepDecisions.id, decisionId)).limit(1);
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  private async markStepCompleted(stepId: string, carryForward?: string): Promise<void> {
    await this.db
      .update(learningSteps)
      .set({
        status: 'completed',
        summary: carryForward || null,
        updatedAt: nowIso()
      })
      .where(eq(learningSteps.id, stepId));
  }

  private async saveStepSummary(stepId: string, summary: unknown): Promise<void> {
    await this.db.insert(learningSummaries).values({
      id: createId('summary'),
      kind: 'step',
      refId: stepId,
      status: 'ready',
      summaryJson: JSON.stringify(summary),
      createdAt: nowIso()
    });
  }

  private async saveTaskSummaryAndAdjustment(params: {
    step: LearningStep;
    decisionId: string;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    decisionOutput: NextStepDecisionAgentOutput;
  }): Promise<void> {
    const now = nowIso();
    const summary = {
      stepId: params.step.id,
      taskId: params.step.taskId,
      result: params.evaluationOutput.result,
      mastery: params.evaluationOutput.mastery,
      feedback: params.evaluationOutput.feedback,
      carryForward: params.decisionOutput.carryForward,
      completedAt: now
    };
    if (params.step.taskId) {
      await this.db.insert(learningSummaries).values({
        id: createId('summary'),
        kind: 'task',
        refId: params.step.taskId,
        status: 'ready',
        summaryJson: JSON.stringify(summary),
        createdAt: now
      });
    }

    // 仅在需要调整时创建 pending adjustment（非纯 complete_task 或有缺失/误解）
    const hasAdjustmentReasons =
      params.decisionOutput.decision !== 'complete_task' ||
      (params.evaluationOutput.missingRequirements && params.evaluationOutput.missingRequirements.length > 0) ||
      (params.evaluationOutput.misconceptions && params.evaluationOutput.misconceptions.length > 0);
    if (hasAdjustmentReasons) {
      await this.db.insert(planAdjustmentProposals).values({
        id: createId('plan_adjustment'),
        goalId: params.step.goalId,
        stageId: params.step.stageId,
        taskId: params.step.taskId,
        sourceDecisionId: params.decisionId,
        status: 'pending',
        reason: params.decisionOutput.reason,
        proposedChangesJson: JSON.stringify({
          carryForward: params.decisionOutput.carryForward,
          recommendedAction: params.evaluationOutput.recommendedAction,
          missingRequirements: params.evaluationOutput.missingRequirements,
          misconceptions: params.evaluationOutput.misconceptions,
          nextFocus:
            params.decisionOutput.carryForward ||
            (params.evaluationOutput.missingRequirements && params.evaluationOutput.missingRequirements[0]) ||
            '根据本次完成情况调整下一次学习重点。'
        }),
        createdAt: now,
        decidedAt: null
      });
    }
  }

  async listPromptProfiles(): Promise<PromptProfile[]> {
    const profiles = await this.db.select().from(promptProfiles).orderBy(asc(promptProfiles.name));
    const results: PromptProfile[] = [];
    for (const profile of profiles) {
      const versions = await this.db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.profileId, profile.id))
        .orderBy(desc(promptVersions.version))
        .limit(1);
      const active = versions[0];
      results.push({
        id: profile.id,
        key: profile.key,
        name: profile.name,
        description: profile.description,
        activeVersionId: profile.activeVersionId,
        version: active?.version ?? 0,
        content: active?.content ?? ''
      });
    }
    return results;
  }

  async getPromptProfile(profileId?: string): Promise<PromptProfile> {
    const profiles = await this.listPromptProfiles();
    const selected = profileId
      ? profiles.find((profile) => profile.id === profileId)
      : profiles.find((profile) => profile.key === 'foundation') ?? profiles[0];
    if (!selected) throw new Error('No prompt profiles exist.');
    return selected;
  }

  async updatePrompt(profileId: string, content: string): Promise<PromptProfile> {
    const versions = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.profileId, profileId))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const versionId = createId('prompt_version');
    const now = nowIso();
    await this.db.insert(promptVersions).values({
      id: versionId,
      profileId,
      version: nextVersion,
      content,
      createdAt: now
    });
    await this.db
      .update(promptProfiles)
      .set({ activeVersionId: versionId, updatedAt: now })
      .where(eq(promptProfiles.id, profileId));
    return this.getPromptProfile(profileId);
  }

  async saveAiReview(params: {
    kind:
      | 'import'
      | 'plan'
      | 'goal_intake'
      | 'roadmap'
      | 'short_plan'
      | 'daily_guide'
      | 'stage_outline'
      | 'teach_step'
      | 'question'
      | 'submission_evaluation'
      | 'next_step'
      | 'evaluation'
      | 'replan'
      | 'reflection'
      | 'rolling_plan';
    date?: string;
    provider: string;
    model: string;
    promptProfileId?: string;
    promptVersionId?: string | null;
    inputSnapshot: unknown;
    output: unknown;
    outputSchemaVersion: string;
    status: 'success' | 'failed';
    errorMessage?: string;
    metrics?: AiCallMetrics;
  }): Promise<string> {
    const id = createId('ai_review');
    const metrics = params.metrics;
    await this.db.insert(aiReviews).values({
      id,
      kind: params.kind,
      date: params.date,
      provider: params.provider,
      model: params.model,
      promptProfileId: params.promptProfileId,
      promptVersionId: params.promptVersionId,
      inputSnapshotJson: JSON.stringify(params.inputSnapshot),
      outputJson: JSON.stringify(params.output),
      outputSchemaVersion: params.outputSchemaVersion,
      status: params.status,
      errorMessage: params.errorMessage,
      inputTokens: metrics?.inputTokens ?? null,
      outputTokens: metrics?.outputTokens ?? null,
      latencyMs: metrics?.latencyMs ?? null,
      errorCategory: metrics?.errorCategory ?? null,
      traceId: metrics?.traceId ?? null,
      createdAt: nowIso()
    });
    return id;
  }

  async getLatestReview(date?: string): Promise<ReviewResult | null> {
    const filters = date
      ? and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success'), eq(aiReviews.date, date))
      : and(eq(aiReviews.kind, 'reflection'), eq(aiReviews.status, 'success'));
    const rows = await this.db
      .select()
      .from(aiReviews)
      .where(filters)
      .orderBy(desc(aiReviews.createdAt));

    for (const row of rows) {
      if (!row.date) continue;
      try {
        const output = JSON.parse(row.outputJson) as ReviewAgentOutput;
        return {
          reviewId: row.id,
          date: row.date,
          completionScore: output.completionScore,
          focusScore: output.focusScore,
          summary: output.summary,
          nextActions: output.nextActions,
          planAdjustments: output.planAdjustments ?? []
        };
      } catch {
        // Ignore malformed historical review payloads and continue to older records.
      }
    }

    return null;
  }

  async getDaySnapshot(date: string) {
    const sessions = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    const guide = await this.getGuideByDate(date);
    const guideTasks = [];
    for (const guideTask of guide?.tasks ?? []) {
      const taskSessions = sessions
        .filter((session) => session.taskId && session.taskId === guideTask.id)
        .map(mapSession);
      const steps = guideTask.legacyPlanBlockId
        ? await this.db
            .select()
            .from(learningSteps)
            .where(eq(learningSteps.blockId, guideTask.legacyPlanBlockId))
            .orderBy(asc(learningSteps.position))
        : [];
      const latestStep = steps.length > 0 ? mapLearningStep(steps[steps.length - 1]) : null;
      const latestSubmission = latestStep ? await this.getLatestSubmission(latestStep.id) : null;
      const latestEvaluation = latestStep ? await this.getLatestEvaluation(latestStep.id) : null;
      const questionRows = steps.length > 0
        ? await this.db.select().from(questionThreads).where(eq(questionThreads.stepId, steps[steps.length - 1].id))
        : [];
      guideTasks.push({
        id: guideTask.id,
        title: guideTask.title,
        status: guideTask.status,
        progressPercent: guideTask.progressPercent,
        estimatedMinutes: guideTask.estimatedMinutes,
        totalElapsedMinutes: guideTask.totalElapsedMinutes,
        focusSessions: taskSessions.map((session) => ({
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          elapsedMinutes: session.durationMinutes,
          pauseReason: session.notes,
          progressNote: session.notes
        })),
        finalSubmission: latestSubmission,
        evaluation: latestEvaluation,
        incompleteActions: guideTask.actions.filter((action) => action.status !== 'done').map((action) => ({
          title: action.title,
          checkpoint: action.checkpoint,
          progressNote: action.progressNote
        })),
        questionTopics: questionRows.map((question) => question.question),
        nextStartPoint: guideTask.nextStartPoint
      });
    }
    return {
      date,
      sessions: sessions.map(mapSession),
      guideTasks
    };
  }
}

function mapTask(row: typeof taskItems.$inferSelect): TaskItem {
  return {
    id: row.id,
    goalId: row.goalId,
    sourceImportId: row.sourceImportId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    difficulty: row.difficulty,
    estimateMinutes: row.estimateMinutes,
    acceptanceCriteria: row.acceptanceCriteria,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapGoal(row: typeof goals.$inferSelect): LearningGoal {
  return {
    id: row.id,
    sourceImportId: row.sourceImportId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapGoalIntake(row: typeof goalIntakes.$inferSelect): GoalIntake {
  return {
    id: row.id,
    status: row.status,
    goalId: row.goalId,
    brief: row.briefJson ? parseGoalBrief(row.briefJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt
  };
}

function mapGoalIntakeMessage(row: typeof goalIntakeMessages.$inferSelect): GoalIntakeMessage {
  return {
    id: row.id,
    intakeId: row.intakeId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt
  };
}

function mapRoadmapStage(row: typeof roadmapStages.$inferSelect): RoadmapStage {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    objective: row.objective,
    direction: row.direction,
    successCriteria: row.successCriteria,
    status: (row.status ?? 'pending') as RoadmapStage['status'],
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapShortPlanDay(row: typeof shortPlanDays.$inferSelect): ShortPlanDay {
  return {
    id: row.id,
    goalId: row.goalId,
    roadmapStageId: row.roadmapStageId ?? null,
    dayIndex: row.dayIndex,
    date: row.date,
    sessionStatus: (row.sessionStatus ?? 'pending') as ShortPlanDay['sessionStatus'],
    title: row.title,
    focus: row.focus,
    tasks: parseStringArray(row.tasksJson),
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    locked: row.locked ?? false,
    createdAt: row.createdAt
  };
}

function mapKnowledgeItem(row: typeof knowledgeItems.$inferSelect): KnowledgeItem {
  return {
    id: row.id,
    goalId: row.goalId,
    key: row.key,
    summary: row.summary,
    detail: row.detail,
    sourceType: row.sourceType as KnowledgeItemSourceType,
    sourceId: row.sourceId,
    occurrenceCount: row.occurrenceCount,
    lastSeenAt: row.lastSeenAt,
    status: (row.status ?? 'active') as KnowledgeItemStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeKnowledgeKey(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase();
  const technicalTokens = [...new Set(normalized.match(/[a-z][a-z0-9.+#_-]*/gu) ?? [])];
  if (technicalTokens.length > 0) {
    return technicalTokens.slice(0, 3).join(':').slice(0, 50);
  }

  const withoutDiagnosisWords = normalized
    .replace(/仍有|存在|概念|理解|混淆|错误|薄弱|缺失|不足|未能|没有|需要|掌握|不清楚|对于|关于|的|对/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return (withoutDiagnosisWords || normalized.replace(/\s+/gu, '')).slice(0, 50);
}

function mapStage(row: typeof planStages.$inferSelect): PlanStage {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    objective: row.objective,
    prerequisites: row.prerequisites,
    successCriteria: row.successCriteria,
    status: row.status,
    position: row.position,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapDailyGuide(row: typeof dailyGuides.$inferSelect, blocks: DailyGuideBlock[], tasks: DailyGuideTask[] = []): DailyGuide {
  return {
    id: row.id,
    goalId: row.goalId,
    planId: row.planId,
    shortPlanDayId: row.shortPlanDayId ?? null,
    date: row.date,
    status: row.status,
    sessionStatus: (row.sessionStatus ?? 'active') as DailyGuide['sessionStatus'],
    weekFocus: row.weekFocus,
    todayGoal: row.todayGoal,
    deliverables: parseStringArray(row.deliverablesJson),
    boundaries: parseStringArray(row.boundariesJson),
    acceptanceCriteria: parseStringArray(row.acceptanceCriteriaJson),
    tomorrowActions: parseStringArray(row.tomorrowActionsJson),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    tasks,
    blocks
  };
}

function mapDailyGuideTask(row: typeof dailyGuideTasks.$inferSelect, actions: DailyGuideAction[]): DailyGuideTask {
  const completedActions = actions.filter((action) => action.status === 'done').map((action) => action.id);
  const remainingActions = actions.filter((action) => action.status !== 'done').map((action) => action.id);
  const currentAction = actions.find((action) => action.id === row.currentActionId) ?? actions.find((action) => action.status !== 'done') ?? null;
  return {
    id: row.id,
    guideId: row.guideId,
    roadmapStageId: row.roadmapStageId ?? null,
    legacyPlanBlockId: row.legacyPlanBlockId,
    title: row.title,
    objective: row.objective,
    scope: row.scope,
    estimatedMinutes: {
      min: row.estimatedMinMinutes,
      target: row.estimatedTargetMinutes,
      max: row.estimatedMaxMinutes
    },
    actions,
    deliverable: row.deliverable,
    doneWhen: parseStringArray(row.doneWhenJson),
    quickHint: row.quickHint,
    evaluationMode: row.evaluationMode,
    submissionPolicy: row.submissionPolicy,
    carryoverAllowed: row.carryoverAllowed,
    status: row.status,
    progressPercent: row.progressPercent,
    completedActions,
    remainingActions,
    currentAction,
    nextStartPoint: row.nextStartPoint,
    totalElapsedMinutes: row.totalElapsedMinutes,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapDailyGuideAction(row: typeof dailyGuideActions.$inferSelect): DailyGuideAction {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    instruction: row.instruction,
    checkpoint: row.checkpoint,
    status: row.status,
    progressNote: row.progressNote,
    completedAt: row.completedAt,
    position: row.position
  };
}

function mapDailyGuideBlock(row: typeof dailyGuideBlocks.$inferSelect, planBlock: DailyPlanBlock): DailyGuideBlock {
  return {
    id: row.id,
    guideId: row.guideId,
    planBlockId: row.planBlockId,
    title: row.title,
    startTime: planBlock.startTime,
    endTime: planBlock.endTime,
    durationMinutes: planBlock.durationMinutes,
    objective: planBlock.objective,
    action: planBlock.action,
    expectedOutput: planBlock.expectedOutput,
    successCriteria: planBlock.successCheck,
    fallback: planBlock.fallback,
    status: planBlock.status,
    position: row.position
  };
}

function mapPlanBlock(row: typeof dailyPlanBlocks.$inferSelect): DailyPlanBlock {
  return {
    id: row.id,
    planId: row.planId,
    taskId: row.taskId,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    objective: row.objective,
    action: row.action,
    expectedOutput: row.expectedOutput,
    difficulty: row.difficulty,
    material: row.material,
    successCheck: row.successCheck,
    fallback: row.fallback,
    status: row.status,
    position: row.position
  };
}

function mapSession(row: typeof studySessions.$inferSelect): StudySession {
  return {
    id: row.id,
    taskId: row.taskId,
    taskItemsId: row.taskItemsId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    focusScore: row.focusScore,
    notes: row.notes
  };
}

function mapLearningStep(row: typeof learningSteps.$inferSelect): LearningStep {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    blockId: row.blockId,
    title: row.title,
    objective: row.objective,
    instruction: row.instruction,
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    status: row.status,
    attempt: row.attempt,
    position: row.position,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapRuntimeState(row: typeof learningRuntimeStates.$inferSelect): LearningRuntimeState {
  return {
    id: 'default',
    activeGoalId: row.activeGoalId,
    activeStageId: row.activeStageId,
    activeDailyTaskId: row.activeDailyTaskId,
    activeStepId: row.activeStepId,
    activeQuestionThreadId: row.activeQuestionThreadId,
    sessionStatus: row.sessionStatus,
    updatedAt: row.updatedAt
  };
}

function mapQuestionThread(row: typeof questionThreads.$inferSelect): QuestionThread {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    stepId: row.stepId,
    status: row.status,
    question: row.question,
    resolutionSummary: row.resolutionSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt
  };
}

function mapQuestionMessage(row: typeof questionMessages.$inferSelect): QuestionMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt
  };
}

function mapSubmission(row: { id: string; stepId: string | null; dailyGuideActionId?: string | null; sessionId: string | null; content: string; createdAt: string; evaluationStatus?: string | null }): LearningSubmission {
  return {
    id: row.id,
    stepId: row.stepId,
    dailyGuideActionId: row.dailyGuideActionId ?? null,
    sessionId: row.sessionId,
    content: row.content,
    evaluationStatus: (row.evaluationStatus ?? 'completed') as LearningSubmission['evaluationStatus'],
    createdAt: row.createdAt
  };
}

function mapSubmissionOld(row: typeof learningSubmissions.$inferSelect): LearningSubmission {
  return {
    id: row.id,
    stepId: row.stepId,
    dailyGuideActionId: row.dailyGuideActionId ?? null,
    sessionId: row.sessionId,
    content: row.content,
    evaluationStatus: (row.evaluationStatus ?? 'completed') as LearningSubmission['evaluationStatus'],
    createdAt: row.createdAt
  };
}

function mapEvaluation(row: typeof learningEvaluations.$inferSelect): LearningEvaluation {
  return {
    id: row.id,
    submissionId: row.submissionId,
    stepId: row.stepId ?? null,
    result: row.result,
    mastery: row.mastery,
    evidence: parseStringArray(row.evidenceJson),
    correctParts: parseStringArray(row.correctPartsJson),
    misconceptions: parseStringArray(row.misconceptionsJson),
    missingRequirements: parseStringArray(row.missingRequirementsJson),
    feedback: row.feedback,
    recommendedAction: row.recommendedAction,
    decision: (row.decision ?? 'stay') as LearningEvaluation['decision'],
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

function mapDecision(row: typeof nextStepDecisions.$inferSelect): StoredNextStepDecision {
  return {
    id: row.id,
    evaluationId: row.evaluationId,
    stepId: row.stepId ?? null,
    decision: row.decision,
    reason: row.reason,
    taskCompleted: row.taskCompleted,
    nextStep: row.nextStepJson ? JSON.parse(row.nextStepJson) : null,
    remediation: row.remediationJson ? JSON.parse(row.remediationJson) : null,
    carryForward: row.carryForward,
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

function mapLearningSummary(row: typeof learningSummaries.$inferSelect): LearningSummary {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    status: row.status,
    summary: JSON.parse(row.summaryJson),
    createdAt: row.createdAt
  };
}

function mapPlanAdjustmentProposal(row: typeof planAdjustmentProposals.$inferSelect): PlanAdjustmentProposal {
  return {
    id: row.id,
    goalId: row.goalId,
    stageId: row.stageId,
    taskId: row.taskId,
    sourceDecisionId: row.sourceDecisionId,
    status: row.status,
    reason: row.reason,
    proposedChanges: JSON.parse(row.proposedChangesJson),
    appliedTaskId: row.appliedTaskId,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt
  };
}

function mergeGoalBrief(current: GoalBrief | null, patch: Partial<GoalBrief>): GoalBrief {
  return {
    title: patch.title ?? current?.title ?? '',
    targetOutcome: patch.targetOutcome ?? current?.targetOutcome ?? '先完成一个可执行的学习目标',
    currentLevel: patch.currentLevel ?? current?.currentLevel ?? '未明确',
    availableTime: patch.availableTime ?? current?.availableTime ?? '未明确',
    deadline: patch.deadline ?? current?.deadline ?? '未明确',
    constraints: patch.constraints ?? current?.constraints ?? [],
    successCriteria: patch.successCriteria ?? current?.successCriteria ?? []
  };
}

function parseGoalBrief(raw: string): GoalBrief {
  try {
    const record = JSON.parse(raw) as Partial<GoalBrief>;
    return mergeGoalBrief(null, {
      title: typeof record.title === 'string' ? record.title : '',
      targetOutcome: typeof record.targetOutcome === 'string' ? record.targetOutcome : undefined,
      currentLevel: typeof record.currentLevel === 'string' ? record.currentLevel : undefined,
      availableTime: typeof record.availableTime === 'string' ? record.availableTime : undefined,
      deadline: typeof record.deadline === 'string' ? record.deadline : undefined,
      constraints: Array.isArray(record.constraints) ? record.constraints.map(String) : [],
      successCriteria: Array.isArray(record.successCriteria) ? record.successCriteria.map(String) : []
    });
  } catch {
    return mergeGoalBrief(null, {});
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function addMinutesToClock(clock: string, minutes: number): string {
  const [rawHour, rawMinute] = clock.split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return clock;
  }
  const total = hour * 60 + minute + minutes;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHour = Math.floor(normalized / 60);
  const nextMinute = normalized % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

function readProposedChanges(value: unknown): {
  carryForward: string;
  recommendedAction: string;
  missingRequirements: string[];
  misconceptions: string[];
  nextFocus: string;
} {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    carryForward: typeof record.carryForward === 'string' ? record.carryForward : '',
    recommendedAction: typeof record.recommendedAction === 'string' ? record.recommendedAction : '',
    missingRequirements: Array.isArray(record.missingRequirements) ? record.missingRequirements.map(String) : [],
    misconceptions: Array.isArray(record.misconceptions) ? record.misconceptions.map(String) : [],
    nextFocus: typeof record.nextFocus === 'string' ? record.nextFocus : ''
  };
}

function difficultyFromRecommendedAction(action: string): TaskItem['difficulty'] {
  if (action === 'exam') return 'exam';
  if (action === 'simplify' || action === 'remediate') return 'foundation';
  if (action === 'practice') return 'standard';
  return 'foundation';
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
