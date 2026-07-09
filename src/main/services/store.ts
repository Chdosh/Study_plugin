import { asc, desc, eq } from 'drizzle-orm';
import type {
  DailyPlan,
  DailyPlanBlock,
  DailyGuide,
  DailyGuideAction,
  DailyGuideBlock,
  DailyGuideTask,
  GoalBrief,
  GoalIntake,
  GoalIntakeMessage,
  GoalIntakeState,
  LearningEvaluation,
  LearningGoal,
  LearningRuntimeSnapshot,
  LearningRuntimeState,
  LearningStep,
  LearningSubmission,
  LearningSummary,
  PlanAdjustmentProposal,
  PlanStage,
  PromptProfile,
  QuestionMessage,
  QuestionThread,
  RawImport,
  RoadmapStage,
  ShortPlanDay,
  StoredNextStepDecision,
  StudySession,
  StudyWindow,
  TaskItem
} from '../../shared/types';
import type {
  AnswerStepQuestionAgentOutput,
  DailyPlanAgentOutput,
  DailyGuideAgentOutput,
  GoalIntakeAgentOutput,
  ImportAgentOutput,
  NextStepDecisionAgentOutput,
  RoadmapAgentOutput,
  ReviewAgentOutput,
  ShortPlanAgentOutput,
  StageOutlineAgentOutput,
  SubmissionEvaluationAgentOutput,
  TeachStepAgentOutput
} from '../../shared/schemas';
import { defaultPromptProfiles } from '../db/default-prompts';
import type { Database } from '../db/client';
import {
  aiReviews,
  appSettings,
  dailyGuideActions,
  dailyGuideBlocks,
  dailyGuideTasks,
  dailyGuides,
  dailyPlanBlocks,
  dailyPlans,
  focusEvents,
  goalIntakeMessages,
  goalIntakes,
  goals,
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
  rawImports,
  roadmapStages,
  skipLogs,
  shortPlanDays,
  studySessions,
  taskDependencies,
  taskItems
} from '../db/schema';
import { createId, nowIso } from './id';

export class StudyStore {
  constructor(private readonly db: Database) {}

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

  async createRawImport(rawText: string, source: RawImport['source']): Promise<RawImport> {
    const row = {
      id: createId('import'),
      source,
      rawText,
      status: 'created' as const,
      createdAt: nowIso(),
      parsedAt: null
    };
    await this.db.insert(rawImports).values({
      id: row.id,
      source: row.source,
      rawText: row.rawText,
      status: row.status,
      createdAt: row.createdAt,
      parsedAt: row.parsedAt
    });
    return row;
  }

  async getRawImport(importId: string): Promise<RawImport> {
    const rows = await this.db.select().from(rawImports).where(eq(rawImports.id, importId)).limit(1);
    if (!rows[0]) throw new Error(`Import not found: ${importId}`);
    return mapRawImport(rows[0]);
  }

  async saveParsedImport(importId: string, output: ImportAgentOutput): Promise<TaskItem[]> {
    const now = nowIso();
    const goalByTitle = new Map<string, string>();

    for (const goal of output.goals) {
      const id = createId('goal');
      goalByTitle.set(goal.title, id);
      await this.db.insert(goals).values({
        id,
        sourceImportId: importId,
        title: goal.title,
        description: goal.description,
        status: 'active',
        priority: goal.priority,
        dueDate: goal.dueDate,
        createdAt: now,
        updatedAt: now
      });
    }

    const taskByTitle = new Map<string, string>();
    const createdTasks: TaskItem[] = [];
    for (const task of output.tasks) {
      const id = createId('task');
      taskByTitle.set(task.title, id);
      const row = {
        id,
        goalId: task.goalTitle ? (goalByTitle.get(task.goalTitle) ?? null) : null,
        sourceImportId: importId,
        title: task.title,
        description: task.description || null,
        status: 'backlog' as const,
        priority: task.priority,
        difficulty: task.difficulty,
        estimateMinutes: task.estimateMinutes,
        acceptanceCriteria: task.acceptanceCriteria || null,
        createdAt: now,
        updatedAt: now
      };
      await this.db.insert(taskItems).values(row);
      createdTasks.push(mapTask(row));
    }

    for (const task of output.tasks) {
      const taskId = taskByTitle.get(task.title);
      if (!taskId) continue;
      for (const dependencyTitle of task.dependsOnTitles) {
        const dependsOnTaskId = taskByTitle.get(dependencyTitle);
        if (!dependsOnTaskId) continue;
        await this.db
          .insert(taskDependencies)
          .values({
            id: createId('dependency'),
            taskId,
            dependsOnTaskId,
            createdAt: now
          })
          .onConflictDoNothing();
      }
    }

    await this.db
      .update(rawImports)
      .set({ status: 'parsed', parsedAt: now })
      .where(eq(rawImports.id, importId));

    return createdTasks;
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

  async getCurrentGoalIntake(): Promise<GoalIntakeState> {
    const existing = await this.db.select().from(goalIntakes).orderBy(desc(goalIntakes.createdAt));
    let intake = existing.find((item) => item.status !== 'confirmed') ?? null;
    if (!intake) {
      const now = nowIso();
      const intakeId = createId('goal_intake');
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
        content: '我们先把目标说清楚。你可以直接告诉我想学什么、想达到什么结果；如果赶时间，也可以说“直接开始”。',
        createdAt: now
      });
      const rows = await this.db.select().from(goalIntakes).where(eq(goalIntakes.id, intakeId)).limit(1);
      intake = rows[0];
    }
    return this.getGoalIntakeState(intake.id);
  }

  async addGoalIntakeMessage(intakeId: string, role: GoalIntakeMessage['role'], content: string): Promise<GoalIntakeMessage> {
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
    const goal = await this.createGoal(brief.title, description);
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
      roadmapRows.push(row);
    }

    const shortRows: ShortPlanDay[] = [];
    for (const day of params.shortPlan.days) {
      const row = {
        id: createId('short_plan_day'),
        goalId: params.goal.id,
        dayIndex: day.dayIndex,
        date: day.dayIndex === 1 ? params.date : null,
        title: day.title,
        focus: day.focus,
        tasksJson: JSON.stringify(day.tasks),
        expectedOutput: day.expectedOutput,
        successCriteria: day.successCriteria,
        createdAt: now
      };
      await this.db.insert(shortPlanDays).values(row);
      shortRows.push(mapShortPlanDay(row));
    }

    const planId = createId('plan');
    await this.db.insert(dailyPlans).values({
      id: planId,
      date: params.date,
      status: 'draft',
      availableWindowsJson: JSON.stringify(params.windows),
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

    const guide = await this.getDailyGuide(guideId);
    if (!guide) throw new Error(`Daily guide not found after save: ${guideId}`);
    return { goal: params.goal, roadmap: roadmapRows, shortPlan: shortRows, guide };
  }

  async confirmDailyGuide(guideId: string): Promise<DailyGuide> {
    const guide = await this.getDailyGuide(guideId);
    if (!guide) throw new Error(`Daily guide not found: ${guideId}`);
    const confirmed = await this.confirmPlan(guide.planId);
    await this.db
      .update(dailyGuides)
      .set({
        status: confirmed.status,
        confirmedAt: confirmed.confirmedAt
      })
      .where(eq(dailyGuides.id, guideId));
    const updated = await this.getDailyGuide(guideId);
    if (!updated) throw new Error(`Daily guide not found after confirm: ${guideId}`);
    return updated;
  }

  async archiveTodayGuides(date: string): Promise<GoalIntakeState> {
    const now = nowIso();
    const guideRows = await this.db.select().from(dailyGuides).where(eq(dailyGuides.date, date));
    for (const guide of guideRows) {
      await this.db.update(dailyGuides).set({ status: 'archived' }).where(eq(dailyGuides.id, guide.id));
      await this.db.update(dailyPlans).set({ status: 'archived' }).where(eq(dailyPlans.id, guide.planId));
    }
    await this.db.update(dailyPlans).set({ status: 'archived' }).where(eq(dailyPlans.date, date));

    const intakeId = createId('goal_intake');
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
      content: '上一版今日计划已经归档。我们重新开始：你想开启什么新学习计划？也可以直接说“直接开始”。',
      createdAt: now
    });
    return this.getGoalIntakeState(intakeId);
  }

  async listTodayGuide(date: string): Promise<{ goal: LearningGoal | null; roadmap: RoadmapStage[]; shortPlan: ShortPlanDay[]; guide: DailyGuide | null }> {
    const guideRows = (await this.db.select().from(dailyGuides).where(eq(dailyGuides.date, date)).orderBy(desc(dailyGuides.createdAt)))
      .filter((item) => item.status !== 'archived');
    const guide = guideRows[0] ? await this.getDailyGuide(guideRows[0].id) : null;
    const goal = guide ? await this.getGoal(guide.goalId) : (await this.listGoals()).find((item) => item.status === 'active') ?? null;
    const roadmap = goal ? await this.listRoadmap(goal.id) : [];
    const shortPlan = goal ? await this.listShortPlan(goal.id) : [];
    return { goal, roadmap, shortPlan, guide };
  }

  async getDailyGuideTaskByBlockId(blockId: string): Promise<DailyGuideTask | null> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.legacyPlanBlockId, blockId))
      .limit(1);
    const task = taskRows[0];
    if (!task) return null;
    const actionRows = await this.db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, task.id))
      .orderBy(asc(dailyGuideActions.position));
    return mapDailyGuideTask(task, actionRows.map(mapDailyGuideAction));
  }

  async listStages(goalId?: string): Promise<PlanStage[]> {
    const rows = goalId
      ? await this.db.select().from(planStages).where(eq(planStages.goalId, goalId)).orderBy(asc(planStages.position))
      : await this.db.select().from(planStages).orderBy(asc(planStages.position));
    return rows.map(mapStage);
  }

  async saveStageOutline(goalId: string, output: StageOutlineAgentOutput): Promise<PlanStage[]> {
    const goalRows = await this.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goalRows[0]) throw new Error(`Goal not found: ${goalId}`);

    const existing = await this.listStages(goalId);
    if (existing.length > 0) {
      return existing;
    }

    const now = nowIso();
    let position = 0;
    for (const stage of output.stages) {
      await this.db.insert(planStages).values({
        id: createId('stage'),
        goalId,
        title: stage.title,
        objective: stage.objective,
        prerequisites: stage.prerequisites || null,
        successCriteria: stage.successCriteria,
        status: 'proposed',
        position,
        summary: output.goalSummary,
        createdAt: now,
        updatedAt: now
      });
      position++;
    }

    const stages = await this.listStages(goalId);
    await this.upsertRuntimeState({
      activeGoalId: goalId,
      activeStageId: null,
      sessionStatus: 'idle'
    });
    return stages;
  }

  async confirmStages(goalId: string): Promise<PlanStage[]> {
    const stages = await this.listStages(goalId);
    const now = nowIso();
    for (const stage of stages) {
      await this.db
        .update(planStages)
        .set({
          status: stage.position === 0 ? 'active' : stage.status === 'proposed' ? 'confirmed' : stage.status,
          updatedAt: now
        })
        .where(eq(planStages.id, stage.id));
    }
    const updated = await this.listStages(goalId);
    await this.upsertRuntimeState({
      activeGoalId: goalId,
      activeStageId: updated[0]?.id ?? null,
      sessionStatus: 'idle'
    });
    return updated;
  }

  async ensureInitialTaskForCurrentStage(goalId?: string): Promise<TaskItem | null> {
    const state = await this.getOrCreateRuntimeState();
    const targetGoalId = goalId ?? state.activeGoalId;
    if (!targetGoalId) return null;

    const existingGoalTasks = (await this.listTasks()).filter((task) => task.goalId === targetGoalId);
    if (existingGoalTasks.length > 0) {
      return null;
    }

    const goal = await this.getGoal(targetGoalId);
    if (!goal) return null;

    const stages = await this.listStages(targetGoalId);
    const stage =
      stages.find((item) => item.id === state.activeStageId && item.status === 'active') ??
      stages.find((item) => item.status === 'active') ??
      stages.find((item) => item.status === 'confirmed') ??
      null;
    if (!stage) return null;

    const now = nowIso();
    const row = {
      id: createId('task'),
      goalId: goal.id,
      sourceImportId: null,
      title: `阶段起步：${truncateText(stage.title, 36)}`,
      description: `由已确认阶段路线生成的首个可规划任务。\n阶段目标：${stage.objective}`,
      status: 'backlog' as const,
      priority: goal.priority,
      difficulty: 'foundation' as const,
      estimateMinutes: 10,
      acceptanceCriteria: stage.successCriteria,
      createdAt: now,
      updatedAt: now
    };
    await this.db.insert(taskItems).values(row);
    return mapTask(row);
  }

  async listTasks(): Promise<TaskItem[]> {
    const rows = await this.db.select().from(taskItems).orderBy(desc(taskItems.createdAt));
    return rows.map(mapTask);
  }

  async updateTask(taskId: string, patch: Partial<TaskItem>): Promise<TaskItem> {
    await this.db
      .update(taskItems)
      .set({
        title: patch.title,
        description: patch.description,
        status: patch.status,
        priority: patch.priority,
        difficulty: patch.difficulty,
        estimateMinutes: patch.estimateMinutes,
        acceptanceCriteria: patch.acceptanceCriteria,
        updatedAt: nowIso()
      })
      .where(eq(taskItems.id, taskId));
    const rows = await this.db.select().from(taskItems).where(eq(taskItems.id, taskId)).limit(1);
    if (!rows[0]) throw new Error(`Task not found after update: ${taskId}`);
    return mapTask(rows[0]);
  }

  async listPlans(date?: string): Promise<DailyPlan[]> {
    const planRows = date
      ? await this.db.select().from(dailyPlans).where(eq(dailyPlans.date, date)).orderBy(desc(dailyPlans.createdAt))
      : await this.db.select().from(dailyPlans).orderBy(desc(dailyPlans.createdAt));

    const plans: DailyPlan[] = [];
    for (const plan of planRows) {
      const blocks = await this.db
        .select()
        .from(dailyPlanBlocks)
        .where(eq(dailyPlanBlocks.planId, plan.id))
        .orderBy(asc(dailyPlanBlocks.position));
      plans.push({
        id: plan.id,
        date: plan.date,
        status: plan.status,
        availableWindowsJson: plan.availableWindowsJson,
        createdAt: plan.createdAt,
        confirmedAt: plan.confirmedAt,
        version: plan.version,
        blocks: blocks.map(mapPlanBlock)
      });
    }
    return plans;
  }

  async createPlanFromAgentOutput(params: {
    date: string;
    availableWindowsJson: string;
    output: DailyPlanAgentOutput;
  }): Promise<DailyPlan> {
    const now = nowIso();
    const planId = createId('plan');
    const tasks = await this.listTasks();
    const taskByTitle = new Map(tasks.map((task) => [task.title, task.id]));

    await this.db.insert(dailyPlans).values({
      id: planId,
      date: params.date,
      status: 'draft',
      availableWindowsJson: params.availableWindowsJson,
      createdAt: now,
      confirmedAt: null,
      sourceReviewId: null,
      version: 1
    });

    let position = 0;
    for (const block of params.output.blocks) {
      await this.db.insert(dailyPlanBlocks).values({
        id: createId('block'),
        planId,
        taskId: block.taskTitle ? (taskByTitle.get(block.taskTitle) ?? null) : null,
        startTime: block.startTime,
        endTime: block.endTime,
        durationMinutes: block.durationMinutes,
        objective: block.objective,
        action: block.action,
        expectedOutput: block.expectedOutput,
        difficulty: block.difficulty,
        material: block.material,
        successCheck: block.successCheck,
        fallback: block.fallback,
        status: 'planned',
        position: position++
      });
    }

    await this.db.insert(planVersions).values({
      id: createId('plan_version'),
      planId,
      version: 1,
      changeSummary: 'Initial AI-generated draft plan.',
      snapshotJson: JSON.stringify(params.output),
      createdAt: now
    });

    return (await this.listPlans(params.date)).find((plan) => plan.id === planId)!;
  }

  async confirmPlan(planId: string): Promise<DailyPlan> {
    await this.db
      .update(dailyPlans)
      .set({
        status: 'confirmed',
        confirmedAt: nowIso()
      })
      .where(eq(dailyPlans.id, planId));
    const plans = await this.listPlans();
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new Error(`Plan not found after confirm: ${planId}`);
    return plan;
  }

  async startSession(blockId: string): Promise<StudySession> {
    const blocks = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    if (!blocks[0]) throw new Error(`Block not found: ${blockId}`);
    const existingSessions = await this.db.select().from(studySessions).where(eq(studySessions.blockId, blockId));
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
      await this.db.update(dailyPlanBlocks).set({ status: 'active' }).where(eq(dailyPlanBlocks.id, blockId));
      const rows = await this.db.select().from(studySessions).where(eq(studySessions.id, existingPaused.id)).limit(1);
      return mapSession(rows[0]);
    }
    await this.db.update(dailyPlanBlocks).set({ status: 'active' }).where(eq(dailyPlanBlocks.id, blockId));
    const row = {
      id: createId('session'),
      blockId,
      taskId: blocks[0].taskId,
      startedAt: nowIso(),
      endedAt: null,
      durationMinutes: null,
      status: 'active' as const,
      focusScore: null,
      notes: null
    };
    await this.db.insert(studySessions).values(row);
    return row;
  }

  async pauseSession(sessionId: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'paused');
    if (session.blockId) {
      await this.updateDailyGuideTaskElapsed(session.blockId);
    }
    return session;
  }

  async completeSession(sessionId: string, notes?: string): Promise<StudySession> {
    const session = await this.finishSession(sessionId, 'completed', notes);
    if (session.blockId) {
      await this.updateDailyGuideTaskElapsed(session.blockId);
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
    const rows = await this.db.select().from(studySessions).where(eq(studySessions.blockId, blockId));
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

  async initializeLearningForBlock(blockId: string, sessionStatus: LearningRuntimeState['sessionStatus']): Promise<LearningRuntimeSnapshot> {
    const blockRows = await this.db.select().from(dailyPlanBlocks).where(eq(dailyPlanBlocks.id, blockId)).limit(1);
    const block = blockRows[0];
    if (!block) throw new Error(`Block not found: ${blockId}`);

    const task = block.taskId ? await this.getTask(block.taskId) : null;
    const goal = task?.goalId ? await this.getGoal(task.goalId) : (await this.listGoals())[0] ?? null;
    const stages = goal ? await this.listStages(goal.id) : [];
    const stage = stages.find((item) => item.status === 'active') ?? stages[0] ?? null;

    if (sessionStatus === 'completed') {
      const existingSteps = await this.db
        .select()
        .from(learningSteps)
        .where(eq(learningSteps.blockId, blockId))
        .orderBy(asc(learningSteps.position));
      const latestStep = existingSteps.length > 0 ? mapLearningStep(existingSteps[existingSteps.length - 1]) : null;

      await this.upsertRuntimeState({
        activeGoalId: goal?.id ?? null,
        activeStageId: stage?.id ?? null,
        activeDailyTaskId: blockId,
        activeStepId: latestStep?.id ?? null,
        activeQuestionThreadId: null,
        sessionStatus
      });

      return this.getLearningRuntimeSnapshot();
    }

    const step = await this.getOrCreateActiveStepForBlock({
      block: mapPlanBlock(block),
      task,
      goal,
      stage
    });

    await this.upsertRuntimeState({
      activeGoalId: goal?.id ?? null,
      activeStageId: stage?.id ?? null,
      activeDailyTaskId: blockId,
      activeStepId: step.id,
      activeQuestionThreadId: null,
      sessionStatus
    });

    return this.getLearningRuntimeSnapshot();
  }

  async getLearningRuntimeSnapshot(): Promise<LearningRuntimeSnapshot> {
    const state = await this.getOrCreateRuntimeState();
    const [goal, stage, block, step, questionThread] = await Promise.all([
      state.activeGoalId ? this.getGoal(state.activeGoalId) : Promise.resolve(null),
      state.activeStageId ? this.getStage(state.activeStageId) : Promise.resolve(null),
      state.activeDailyTaskId ? this.getBlock(state.activeDailyTaskId) : Promise.resolve(null),
      state.activeStepId ? this.getLearningStep(state.activeStepId) : Promise.resolve(null),
      state.activeQuestionThreadId ? this.getQuestionThread(state.activeQuestionThreadId) : Promise.resolve(null)
    ]);
    const task = block?.taskId ? await this.getTask(block.taskId) : step?.taskId ? await this.getTask(step.taskId) : null;
    const questionThreadId = questionThread?.id ?? null;
    const [questionMessageRows, recentSummaries, latestSubmission, latestEvaluation, latestDecision] = await Promise.all([
      questionThreadId ? this.listQuestionMessages(questionThreadId) : Promise.resolve([]),
      step?.blockId ? this.listRecentStepSummaries(step.blockId, step.id) : Promise.resolve([]),
      step ? this.getLatestSubmission(step.id) : Promise.resolve(null),
      step ? this.getLatestEvaluation(step.id) : Promise.resolve(null),
      step ? this.getLatestDecision(step.id) : Promise.resolve(null)
    ]);
    const pendingAdjustment = await this.getPendingAdjustment({
      goalId: goal?.id ?? null,
      stageId: stage?.id ?? null,
      taskId: task?.id ?? null
    });

    return {
      state,
      goal,
      stage,
      task,
      block,
      step,
      questionThread,
      questionMessages: questionMessageRows,
      recentStepSummaries: recentSummaries,
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

  async openQuestion(stepId: string, question: string): Promise<QuestionThread> {
    const step = await this.getLearningStep(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    const now = nowIso();
    const threadId = createId('question');
    await this.db.insert(questionThreads).values({
      id: threadId,
      goalId: step.goalId,
      stageId: step.stageId,
      taskId: step.taskId,
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

  async createSubmission(stepId: string, sessionId: string | null, content: string): Promise<LearningSubmission> {
    const step = await this.getLearningStep(stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);
    const row = {
      id: createId('submission'),
      stepId,
      sessionId,
      content,
      createdAt: nowIso()
    };
    await this.db.insert(learningSubmissions).values(row);
    return row;
  }

  async saveEvaluationAndDecision(params: {
    submission: LearningSubmission;
    evaluationOutput: SubmissionEvaluationAgentOutput;
    decisionOutput: NextStepDecisionAgentOutput;
    evaluationAiReviewId?: string;
    decisionAiReviewId?: string;
  }): Promise<{ evaluation: LearningEvaluation; decision: StoredNextStepDecision; nextStep: LearningStep | null }> {
    const now = nowIso();
    const evaluationId = createId('evaluation');
    await this.db.insert(learningEvaluations).values({
      id: evaluationId,
      submissionId: params.submission.id,
      stepId: params.submission.stepId,
      result: params.evaluationOutput.result,
      mastery: params.evaluationOutput.mastery,
      evidenceJson: JSON.stringify(params.evaluationOutput.evidence),
      correctPartsJson: JSON.stringify(params.evaluationOutput.correctParts),
      misconceptionsJson: JSON.stringify(params.evaluationOutput.misconceptions),
      missingRequirementsJson: JSON.stringify(params.evaluationOutput.missingRequirements),
      feedback: params.evaluationOutput.feedback,
      recommendedAction: params.evaluationOutput.recommendedAction,
      aiReviewId: params.evaluationAiReviewId ?? null,
      createdAt: now
    });

    const decisionId = createId('decision');
    await this.db.insert(nextStepDecisions).values({
      id: decisionId,
      evaluationId,
      stepId: params.submission.stepId,
      decision: params.decisionOutput.decision,
      reason: params.decisionOutput.reason,
      taskCompleted: params.decisionOutput.taskCompleted,
      nextStepJson: params.decisionOutput.nextStep ? JSON.stringify(params.decisionOutput.nextStep) : null,
      remediationJson: params.decisionOutput.remediation ? JSON.stringify(params.decisionOutput.remediation) : null,
      carryForward: params.decisionOutput.carryForward || null,
      aiReviewId: params.decisionAiReviewId ?? null,
      createdAt: now
    });

    const currentStep = await this.getLearningStep(params.submission.stepId);
    if (!currentStep) throw new Error(`Step not found: ${params.submission.stepId}`);
    let nextStep: LearningStep | null = null;
    const nextStepInput = params.decisionOutput.nextStep ?? (
      params.decisionOutput.remediation
        ? {
            title: params.decisionOutput.remediation.title,
            objective: params.decisionOutput.remediation.title,
            instruction: params.decisionOutput.remediation.instruction,
            expectedOutput: params.decisionOutput.remediation.expectedOutput,
            successCriteria: params.decisionOutput.remediation.successCriteria
          }
        : null
    );

    if (params.decisionOutput.decision === 'complete_task' || params.decisionOutput.taskCompleted) {
      await this.markStepCompleted(currentStep.id, params.decisionOutput.carryForward);
      await this.upsertRuntimeState({ sessionStatus: 'completed' });
      if (currentStep.blockId) {
        await this.db.update(dailyPlanBlocks).set({ status: 'done' }).where(eq(dailyPlanBlocks.id, currentStep.blockId));
        await this.updateDailyGuideTaskProgress(currentStep.blockId, {
          status: 'done',
          progressPercent: 100,
          nextStartPoint: null
        });
      }
      if (currentStep.taskId) {
        await this.db
          .update(taskItems)
          .set({ status: 'done', updatedAt: nowIso() })
          .where(eq(taskItems.id, currentStep.taskId));
      }
      await this.saveStepSummary(currentStep.id, {
        result: params.evaluationOutput.result,
        feedback: params.evaluationOutput.feedback,
        carryForward: params.decisionOutput.carryForward || ''
      });
      await this.saveTaskSummaryAndAdjustment({
        step: currentStep,
        decisionId,
        evaluationOutput: params.evaluationOutput,
        decisionOutput: params.decisionOutput
      });
    } else if (nextStepInput) {
      await this.markStepCompleted(currentStep.id, params.decisionOutput.carryForward);
      await this.saveStepSummary(currentStep.id, {
        result: params.evaluationOutput.result,
        feedback: params.evaluationOutput.feedback,
        carryForward: params.decisionOutput.carryForward || '',
        nextDecision: params.decisionOutput.decision
      });
      nextStep = await this.createLearningStep({
        goalId: currentStep.goalId,
        stageId: currentStep.stageId,
        taskId: currentStep.taskId,
        blockId: currentStep.blockId,
        title: nextStepInput.title,
        objective: nextStepInput.objective,
        instruction: nextStepInput.instruction,
        expectedOutput: nextStepInput.expectedOutput,
        successCriteria: nextStepInput.successCriteria,
        status: 'active',
        attempt: 1,
        position: currentStep.position + 1
      });
      await this.upsertRuntimeState({
        activeStepId: nextStep.id,
        activeQuestionThreadId: null,
        sessionStatus: 'active'
      });
    } else {
      if (currentStep.blockId) {
        await this.updateDailyGuideTaskProgress(currentStep.blockId, {
          status: 'active',
          progressPercent: params.evaluationOutput.result === 'partial' ? Math.max(50, params.evaluationOutput.mastery) : params.evaluationOutput.mastery,
          nextStartPoint: params.decisionOutput.carryForward || params.evaluationOutput.missingRequirements[0] || params.evaluationOutput.misconceptions[0] || null
        });
      }
      await this.db
        .update(learningSteps)
        .set({ status: 'needs_revision', updatedAt: nowIso() })
        .where(eq(learningSteps.id, currentStep.id));
    }

    const evaluation = await this.getEvaluation(evaluationId);
    const decision = await this.getDecision(decisionId);
    if (!evaluation || !decision) throw new Error('Evaluation or decision was not saved.');
    return { evaluation, decision, nextStep };
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

  private async getDailyGuide(guideId: string): Promise<DailyGuide | null> {
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
    const sessions = await this.db.select().from(studySessions).where(eq(studySessions.blockId, blockId));
    const totalElapsedMinutes = Math.round(sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0));
    await this.db
      .update(dailyGuideTasks)
      .set({
        totalElapsedMinutes,
        updatedAt: nowIso()
      })
      .where(eq(dailyGuideTasks.id, task.id));
  }

  private async updateDailyGuideTaskProgress(
    blockId: string,
    patch: {
      status: DailyGuideTask['status'];
      progressPercent: number;
      nextStartPoint: string | null;
    }
  ): Promise<void> {
    const taskRows = await this.db
      .select()
      .from(dailyGuideTasks)
      .where(eq(dailyGuideTasks.legacyPlanBlockId, blockId))
      .limit(1);
    const task = taskRows[0];
    if (!task) return;
    const actions = await this.db
      .select()
      .from(dailyGuideActions)
      .where(eq(dailyGuideActions.taskId, task.id))
      .orderBy(asc(dailyGuideActions.position));
    const boundedProgress = Math.max(0, Math.min(100, Math.round(patch.progressPercent)));
    const completedCount = patch.status === 'done'
      ? actions.length
      : Math.max(0, Math.min(actions.length, Math.floor((boundedProgress / 100) * actions.length)));
    const completedAt = nowIso();
    for (const [index, action] of actions.entries()) {
      const done = index < completedCount;
      await this.db
        .update(dailyGuideActions)
        .set({
          status: done ? 'done' : 'planned',
          completedAt: done ? (action.completedAt ?? completedAt) : null
        })
        .where(eq(dailyGuideActions.id, action.id));
    }
    const nextAction = actions[completedCount] ?? null;
    await this.db
      .update(dailyGuideTasks)
      .set({
        status: patch.status,
        progressPercent: boundedProgress,
        currentActionId: nextAction?.id ?? null,
        nextStartPoint: patch.nextStartPoint ?? nextAction?.title ?? null,
        updatedAt: completedAt
      })
      .where(eq(dailyGuideTasks.id, task.id));
    await this.updateDailyGuideTaskElapsed(blockId);
  }

  private async getTask(taskId: string): Promise<TaskItem | null> {
    const rows = await this.db.select().from(taskItems).where(eq(taskItems.id, taskId)).limit(1);
    return rows[0] ? mapTask(rows[0]) : null;
  }

  private async getStage(stageId: string): Promise<PlanStage | null> {
    const rows = await this.db.select().from(planStages).where(eq(planStages.id, stageId)).limit(1);
    return rows[0] ? mapStage(rows[0]) : null;
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
    return next;
  }

  private async getOrCreateActiveStepForBlock(params: {
    block: DailyPlanBlock;
    task: TaskItem | null;
    goal: LearningGoal | null;
    stage: PlanStage | null;
  }): Promise<LearningStep> {
    const rows = await this.db
      .select()
      .from(learningSteps)
      .where(eq(learningSteps.blockId, params.block.id))
      .orderBy(asc(learningSteps.position));
    const active = rows
      .map(mapLearningStep)
      .find((step) => ['active', 'waiting_for_submission', 'needs_revision'].includes(step.status));
    if (active) return active;
    const latest = rows.length > 0 ? mapLearningStep(rows[rows.length - 1]) : null;
    return this.createLearningStep({
      goalId: params.goal?.id ?? params.task?.goalId ?? null,
      stageId: params.stage?.id ?? null,
      taskId: params.block.taskId,
      blockId: params.block.id,
      title: params.block.objective,
      objective: params.block.objective,
      instruction: params.block.action,
      expectedOutput: params.block.expectedOutput,
      successCriteria: params.block.successCheck,
      status: 'active',
      attempt: 1,
      position: latest ? latest.position + 1 : 0
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
          params.evaluationOutput.missingRequirements[0] ||
          '根据本次完成情况调整下一次学习重点。'
      }),
      createdAt: now,
      decidedAt: null
    });
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
      | 'reflection';
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
  }): Promise<string> {
    const id = createId('ai_review');
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
      createdAt: nowIso()
    });
    return id;
  }

  async createReview(date: string, output: ReviewAgentOutput): Promise<string> {
    return this.saveAiReview({
      kind: 'reflection',
      date,
      provider: 'deepseek',
      model: 'configured',
      inputSnapshot: { date },
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success'
    });
  }

  async getDaySnapshot(date: string) {
    const plans = await this.listPlans(date);
    const tasks = await this.listTasks();
    const sessions = await this.db.select().from(studySessions).orderBy(desc(studySessions.startedAt));
    const todayGuide = await this.listTodayGuide(date);
    const guideTasks = [];
    for (const guideTask of todayGuide.guide?.tasks ?? []) {
      const taskSessions = sessions
        .filter((session) => session.blockId && session.blockId === guideTask.legacyPlanBlockId)
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
      plans,
      tasks,
      sessions: sessions.map(mapSession),
      guideTasks
    };
  }
}

function mapRawImport(row: typeof rawImports.$inferSelect): RawImport {
  return {
    id: row.id,
    source: row.source,
    rawText: row.rawText,
    status: row.status,
    createdAt: row.createdAt,
    parsedAt: row.parsedAt
  };
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
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapShortPlanDay(row: typeof shortPlanDays.$inferSelect): ShortPlanDay {
  return {
    id: row.id,
    goalId: row.goalId,
    dayIndex: row.dayIndex,
    date: row.date,
    title: row.title,
    focus: row.focus,
    tasks: parseStringArray(row.tasksJson),
    expectedOutput: row.expectedOutput,
    successCriteria: row.successCriteria,
    createdAt: row.createdAt
  };
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
    date: row.date,
    status: row.status,
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
    blockId: row.blockId,
    taskId: row.taskId,
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

function mapSubmission(row: typeof learningSubmissions.$inferSelect): LearningSubmission {
  return {
    id: row.id,
    stepId: row.stepId,
    sessionId: row.sessionId,
    content: row.content,
    createdAt: row.createdAt
  };
}

function mapEvaluation(row: typeof learningEvaluations.$inferSelect): LearningEvaluation {
  return {
    id: row.id,
    submissionId: row.submissionId,
    stepId: row.stepId,
    result: row.result,
    mastery: row.mastery,
    evidence: parseStringArray(row.evidenceJson),
    correctParts: parseStringArray(row.correctPartsJson),
    misconceptions: parseStringArray(row.misconceptionsJson),
    missingRequirements: parseStringArray(row.missingRequirementsJson),
    feedback: row.feedback,
    recommendedAction: row.recommendedAction,
    aiReviewId: row.aiReviewId,
    createdAt: row.createdAt
  };
}

function mapDecision(row: typeof nextStepDecisions.$inferSelect): StoredNextStepDecision {
  return {
    id: row.id,
    evaluationId: row.evaluationId,
    stepId: row.stepId,
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
