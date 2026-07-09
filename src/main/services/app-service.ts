import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import type { NextStepDecisionAgentOutput, SubmissionEvaluationAgentOutput } from '../../shared/schemas';
import type { AppSettings, DailyGuideTask, DailyPlanBlock, GoalBrief, Id, RawImport, RoadmapStage, ShortPlanDay, StudySession, StudyWindow, TaskItem } from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import {
  DailyGuideAgent,
  GoalIntakeAgent,
  ImportAgent,
  PlannerAgent,
  ReflectionAgent,
  RoadmapAgent,
  ShortPlanAgent,
  StageOutlineAgent,
  StepQuestionAgent,
  SubmissionEvaluationAgent,
  TeachStepAgent
} from '../ai/agents';
import { ContextBuilder } from './context-builder';
import { FocusMonitor } from './focus-monitor';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly importAgent = new ImportAgent(this.aiClient);
  private readonly plannerAgent = new PlannerAgent(this.aiClient);
  private readonly reflectionAgent = new ReflectionAgent(this.aiClient);
  private readonly goalIntakeAgent = new GoalIntakeAgent(this.aiClient);
  private readonly roadmapAgent = new RoadmapAgent(this.aiClient);
  private readonly shortPlanAgent = new ShortPlanAgent(this.aiClient);
  private readonly dailyGuideAgent = new DailyGuideAgent(this.aiClient);
  private readonly stageOutlineAgent = new StageOutlineAgent(this.aiClient);
  private readonly teachStepAgent = new TeachStepAgent(this.aiClient);
  private readonly questionAgent = new StepQuestionAgent(this.aiClient);
  private readonly evaluationAgent = new SubmissionEvaluationAgent(this.aiClient);
  private readonly contextBuilder: ContextBuilder;
  private readonly focusMonitor: FocusMonitor;

  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly getFloatWindow: () => BrowserWindow | null
  ) {
    this.focusMonitor = new FocusMonitor(store);
    this.contextBuilder = new ContextBuilder(store);
  }

  getSettings() {
    return this.settings.getAppSettings();
  }

  updateSettings(patch: Partial<AppSettings> & { deepseekApiKey?: string }) {
    return this.settings.updateSettings(patch);
  }

  getCurrentOnboarding() {
    return this.store.getCurrentGoalIntake();
  }

  async sendOnboardingMessage(content: string) {
    if (!content.trim()) {
      throw new Error('访谈内容不能为空。');
    }
    const current = await this.store.getCurrentGoalIntake();
    await this.store.addGoalIntakeMessage(current.intake.id, 'user', content.trim());
    const [nextState, profile, runtimeSettings] = await Promise.all([
      this.store.getCurrentGoalIntake(),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const output = await this.goalIntakeAgent.run({
      messages: nextState.messages,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'goal_intake',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: {
        intakeId: current.intake.id,
        messageCount: nextState.messages.length
      },
      output,
      outputSchemaVersion: 'goal-intake.v1',
      status: 'success'
    });
    return this.store.saveGoalIntakeAgentOutput(current.intake.id, output);
  }

  confirmOnboardingGoal(briefPatch?: Partial<GoalBrief>) {
    return this.store.confirmGoalIntake(briefPatch);
  }

  async generateLayeredPlan(goalId: Id) {
    const goal = await this.store.getGoal(goalId);
    if (!goal) throw new Error('找不到要生成计划的学习目标。');
    const [brief, profile, runtimeSettings] = await Promise.all([
      this.store.getGoalBriefForGoal(goalId),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const date = todayIso();
    const windows = runtimeSettings.dailyStudyWindows;
    const roadmapOutput = await this.roadmapAgent.run({
      goal,
      brief,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'roadmap',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId, brief },
      output: roadmapOutput,
      outputSchemaVersion: 'roadmap.v1',
      status: 'success'
    });
    const draftRoadmap = roadmapOutput.stages.map<RoadmapStage>((stage, index) => ({
      id: `draft-roadmap-${index}`,
      goalId,
      title: stage.title,
      objective: stage.objective,
      direction: stage.direction,
      successCriteria: stage.successCriteria,
      position: index,
      createdAt: '',
      updatedAt: ''
    }));
    const shortPlanOutput = await this.shortPlanAgent.run({
      goal,
      brief,
      roadmap: draftRoadmap,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'short_plan',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId, brief, roadmap: roadmapOutput },
      output: shortPlanOutput,
      outputSchemaVersion: 'short-plan.v1',
      status: 'success'
    });
    const draftShortPlan = shortPlanOutput.days.map<ShortPlanDay>((day) => ({
      id: `draft-short-day-${day.dayIndex}`,
      goalId,
      dayIndex: day.dayIndex,
      date: day.dayIndex === 1 ? date : null,
      title: day.title,
      focus: day.focus,
      tasks: day.tasks,
      expectedOutput: day.expectedOutput,
      successCriteria: day.successCriteria,
      createdAt: ''
    }));
    const dailyGuideOutput = await this.dailyGuideAgent.run({
      date,
      windows,
      goal,
      brief,
      roadmap: draftRoadmap,
      shortPlan: draftShortPlan,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'daily_guide',
      date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goalId, brief, roadmap: roadmapOutput, shortPlan: shortPlanOutput },
      output: dailyGuideOutput,
      outputSchemaVersion: 'daily-guide.v2',
      status: 'success'
    });
    return this.store.saveLayeredPlan({
      goal,
      brief,
      date,
      windows,
      roadmap: roadmapOutput,
      shortPlan: shortPlanOutput,
      dailyGuide: dailyGuideOutput
    });
  }

  confirmDailyGuide(guideId: Id) {
    return this.store.confirmDailyGuide(guideId);
  }

  async archiveTodayAndRestart() {
    const active = await this.getActiveSession();
    if (active?.session.status === 'active') {
      this.focusMonitor.stop();
      const paused = await this.store.pauseSession(active.session.id);
      await this.pushSessionState(paused);
    }
    return this.store.archiveTodayGuides(todayIso());
  }

  listTodayGuide() {
    return this.store.listTodayGuide(todayIso());
  }

  createImport(rawText: string, source: RawImport['source']) {
    if (!rawText.trim()) {
      throw new Error('导入文本不能为空。');
    }
    return this.store.createRawImport(rawText, source);
  }

  async parseImport(importId: Id, promptProfileId?: Id) {
    const [rawImport, profile, runtimeSettings] = await Promise.all([
      this.store.getRawImport(importId),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    try {
      const output = await this.importAgent.run(rawImport.rawText, profile, runtimeSettings);
      const tasks = await this.store.saveParsedImport(importId, output);
      await this.store.saveAiReview({
        kind: 'import',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          importId,
          rawText: rawImport.rawText
        },
        output,
        outputSchemaVersion: 'import.v1',
        status: 'success'
      });
      return {
        importId,
        goalsCreated: output.goals.length,
        tasksCreated: tasks.length,
        tasks
      };
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'import',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { importId },
        output: {},
        outputSchemaVersion: 'import.v1',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  listTasks() {
    return this.store.listTasks();
  }

  listGoals() {
    return this.store.listGoals();
  }

  createGoal(title: string, description?: string) {
    return this.store.createGoal(title, description);
  }

  listStages(goalId?: Id) {
    return this.store.listStages(goalId);
  }

  async generateStageOutline(goalId?: Id, promptProfileId?: Id) {
    const [goals, tasks, profile, runtimeSettings] = await Promise.all([
      this.store.listGoals(),
      this.store.listTasks(),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    const goal = goalId ? goals.find((item) => item.id === goalId) : goals.find((item) => item.status === 'active') ?? goals[0];
    if (!goal) {
      throw new Error('请先创建或导入一个学习目标。');
    }
    const goalTasks = tasks.filter((task) => task.goalId === goal.id);
    const output = await this.stageOutlineAgent.run({
      goal,
      tasks: goalTasks,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'stage_outline',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { goal, taskIds: goalTasks.map((task) => task.id) },
      output,
      outputSchemaVersion: 'stage-outline.v1',
      status: 'success'
    });
    const stages = await this.store.saveStageOutline(goal.id, output);
    return { goal, stages };
  }

  confirmStages(goalId: Id) {
    return this.store.confirmStages(goalId);
  }

  updateTask(taskId: Id, patch: Partial<TaskItem>) {
    return this.store.updateTask(taskId, patch);
  }

  listPlans(date?: string) {
    return this.store.listPlans(date);
  }

  async generatePlan(date: string, availableWindows: StudyWindow[], promptProfileId?: Id) {
    const [tasks, profile, runtimeSettings, planContext] = await Promise.all([
      this.store.listTasks(),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings(),
      this.contextBuilder.build('generate_daily_plan', { date, availableWindows })
    ]);
    const learningState = planContext.snapshot;
    let planningTasks = tasks;
    let unresolvedTasks = planningTasks.filter((task) => {
      if (['done', 'skipped'].includes(task.status)) return false;
      if (learningState.goal?.id && task.goalId && task.goalId !== learningState.goal.id) return false;
      return true;
    });
    if (unresolvedTasks.length === 0) {
      const createdInitialTask = await this.store.ensureInitialTaskForCurrentStage(learningState.goal?.id ?? undefined);
      if (createdInitialTask) {
        planningTasks = [createdInitialTask, ...planningTasks];
        unresolvedTasks = planningTasks.filter((task) => {
          if (['done', 'skipped'].includes(task.status)) return false;
          if (learningState.goal?.id && task.goalId && task.goalId !== learningState.goal.id) return false;
          return true;
        });
      }
    }
    if (unresolvedTasks.length === 0) {
      throw new Error('没有可用于规划的未完成任务。');
    }
    try {
      const output = await this.plannerAgent.run({
        date,
        windows: availableWindows,
        tasks: unresolvedTasks,
        goal: learningState.goal,
        stage: learningState.stage,
        context: {
          ...planContext.context,
          unresolvedTaskIds: unresolvedTasks.map((task) => task.id)
        },
        profile,
        settings: runtimeSettings
      });
      await this.store.saveAiReview({
        kind: 'plan',
        date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          date,
          availableWindows,
          contextSourceIds: planContext.contextSourceIds,
          context: planContext.context,
          currentGoal: learningState.goal,
          currentStage: learningState.stage,
          tasks: unresolvedTasks
        },
        output,
        outputSchemaVersion: 'daily-plan.v1',
        status: 'success'
      });
      return this.store.createPlanFromAgentOutput({
        date,
        availableWindowsJson: JSON.stringify(availableWindows),
        output
      });
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'plan',
        date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          date,
          availableWindows,
          contextSourceIds: planContext.contextSourceIds,
          context: planContext.context,
          currentGoal: learningState.goal,
          currentStage: learningState.stage,
          tasks: unresolvedTasks
        },
        output: {},
        outputSchemaVersion: 'daily-plan.v1',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof Error && error.message.includes('缺少 DeepSeek API Key')) {
        throw error;
      }
      throw new Error('生成计划失败：AI 返回内容没有通过本地校验，已记录失败。请重试一次，或在设置里调低提示词复杂度。');
    }
  }

  confirmPlan(planId: Id) {
    return this.store.confirmPlan(planId);
  }

  async startSession(blockId: Id) {
    const session = await this.store.startSession(blockId);
    await this.store.initializeLearningForBlock(blockId, 'active');
    this.focusMonitor.start(session.id);
    this.getMainWindow()?.flashFrame(true);
    await this.pushSessionState(session);
    return session;
  }

  async pauseSession(sessionId: Id) {
    this.focusMonitor.stop();
    const session = await this.store.pauseSession(sessionId);
    if (session.blockId) {
      await this.store.initializeLearningForBlock(session.blockId, 'paused');
    }
    await this.pushSessionState(session);
    return session;
  }

  async completeSession(sessionId: Id, notes?: string) {
    this.focusMonitor.stop();
    const session = await this.store.completeSession(sessionId, notes);
    if (session.blockId) {
      await this.store.initializeLearningForBlock(session.blockId, 'completed');
    }
    await this.pushSessionState(session);
    return session;
  }

  async skipBlock(blockId: Id, reason: string) {
    if (!reason.trim()) {
      throw new Error('跳过学习块时必须填写原因。');
    }
    return this.store.skipBlock(blockId, reason);
  }

  async generateReview(date: string) {
    const [snapshot, profile, runtimeSettings] = await Promise.all([
      this.store.getDaySnapshot(date),
      this.store.getPromptProfile(),
      this.settings.getRuntimeSettings()
    ]);
    const output = await this.reflectionAgent.run({
      date,
      snapshot,
      profile,
      settings: runtimeSettings
    });
    const reviewId = await this.store.saveAiReview({
      kind: 'reflection',
      date,
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: snapshot,
      output,
      outputSchemaVersion: 'review.v1',
      status: 'success'
    });
    return {
      reviewId,
      date,
      ...output
    };
  }

  async getActiveSession(): Promise<{ session: StudySession; block: DailyPlanBlock } | null> {
    const sessions = await this.store.listSessions();
    // Only show float for truly active sessions (not paused — those can resume from main window)
    const active = sessions.find((s) => s.status === 'active');
    if (!active || !active.blockId) return null;
    const block = await this.store.getBlock(active.blockId);
    if (!block) return null;
    if (block.status === 'done' || block.status === 'skipped' || block.status === 'deferred') {
      return null;
    }
    return { session: active, block };
  }

  async getAccumulatedSeconds(blockId: string, excludeSessionId?: string): Promise<number> {
    return this.store.getAccumulatedSeconds(blockId, excludeSessionId);
  }

  getLearningState() {
    return this.store.getLearningRuntimeSnapshot();
  }

  async teachCurrentStep(promptProfileId?: Id) {
    const [built, profile, runtimeSettings] = await Promise.all([
      this.contextBuilder.build('teach_step'),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    if (!built.snapshot.step) {
      throw new Error('当前没有可展开的学习步骤。请先开始今日任务。');
    }
    const output = await this.teachStepAgent.run({
      context: built.context,
      profile,
      settings: runtimeSettings
    });
    const aiReviewId = await this.store.saveAiReview({
      kind: 'teach_step',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { contextSourceIds: built.contextSourceIds, context: built.context },
      output,
      outputSchemaVersion: 'teach-step.v1',
      status: 'success'
    });
    void aiReviewId;
    const step = await this.store.updateCurrentStepFromTeaching(built.snapshot.step.id, output);
    return {
      step,
      explanation: output.explanation,
      userAction: output.userAction,
      requiresSubmission: output.requiresSubmission,
      contextSourceIds: built.contextSourceIds
    };
  }

  async askStepQuestion(question: string, promptProfileId?: Id) {
    if (!question.trim()) {
      throw new Error('问题不能为空。');
    }
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.step) {
      throw new Error('当前没有学习步骤，无法提问。');
    }
    const thread = before.questionThread?.status === 'open'
      ? before.questionThread
      : await this.store.openQuestion(before.step.id, question);
    if (before.questionThread?.status === 'open') {
      await this.store.addQuestionMessage(thread.id, 'user', question);
    }
    const [built, profile, runtimeSettings] = await Promise.all([
      this.contextBuilder.build('answer_step_question', { question }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    const output = await this.questionAgent.run({
      question,
      context: built.context,
      profile,
      settings: runtimeSettings
    });
    await this.store.saveAiReview({
      kind: 'question',
      provider: 'deepseek',
      model: runtimeSettings.deepseekModel,
      promptProfileId: profile.id,
      promptVersionId: profile.activeVersionId,
      inputSnapshot: { contextSourceIds: built.contextSourceIds, question },
      output,
      outputSchemaVersion: 'question-answer.v1',
      status: 'success'
    });
    const updatedThread = await this.store.saveQuestionAnswer(thread.id, output);
    const messages = await this.store.getQuestionMessages(thread.id);
    return {
      thread: updatedThread,
      messages,
      answer: output.answer,
      resolved: output.resolved,
      returnToStepInstruction: output.returnToStepInstruction
    };
  }

  async resolveQuestion(threadId: Id, summary?: string) {
    await this.store.resolveQuestion(threadId, summary);
    return this.store.getLearningRuntimeSnapshot();
  }

  async submitLearningResult(content: string, promptProfileId?: Id) {
    if (!content.trim()) {
      throw new Error('提交内容不能为空。');
    }
    const before = await this.store.getLearningRuntimeSnapshot();
    if (!before.step) {
      throw new Error('当前没有学习步骤，无法提交结果。');
    }
    const active = await this.getActiveSession();
    const submission = await this.store.createSubmission(before.step.id, active?.session.id ?? null, content);
    const guideTask = before.step.blockId ? await this.store.getDailyGuideTaskByBlockId(before.step.blockId) : null;
    const [evaluationContext, profile, runtimeSettings] = await Promise.all([
      this.contextBuilder.build('evaluate_submission', { submission: content }),
      this.store.getPromptProfile(promptProfileId),
      this.settings.getRuntimeSettings()
    ]);
    let evaluationAiReviewId: string | undefined;
    const evaluationOutput = guideTask?.evaluationMode === 'local'
      ? buildLocalSubmissionEvaluation(content, guideTask)
      : await this.evaluationAgent.run({
          submission: content,
          context: evaluationContext.context,
          profile,
          settings: runtimeSettings
        });
    if (guideTask?.evaluationMode !== 'local') {
      evaluationAiReviewId = await this.store.saveAiReview({
        kind: 'submission_evaluation',
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: {
          contextSourceIds: evaluationContext.contextSourceIds,
          submissionId: submission.id
        },
        output: evaluationOutput,
        outputSchemaVersion: 'submission-evaluation.v1',
        status: 'success'
      });
    }
    const decisionOutput = buildLocalDecisionFromEvaluation(evaluationOutput);
    return this.store.saveEvaluationAndDecision({
      submission,
      evaluationOutput,
      decisionOutput,
      evaluationAiReviewId
    });
  }

  decidePlanAdjustment(proposalId: Id, status: 'accepted' | 'rejected') {
    return this.store.decidePlanAdjustment(proposalId, status);
  }

  async pushSessionState(session: StudySession): Promise<void> {
    let block: DailyPlanBlock | null = null;
    if (session.blockId) {
      block = await this.store.getBlock(session.blockId);
    }
    const payload = { session, block };
    const allWindows = [this.getMainWindow(), this.getFloatWindow()].filter(Boolean) as BrowserWindow[];
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send(ipcChannels.sessionStateChanged, payload);
      }
    }
  }

  async getFloatPosition(): Promise<{ x: number; y: number } | null> {
    const raw = await this.store.getSetting('floatWindowPosition');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { x: number; y: number };
    } catch {
      return null;
    }
  }

  async saveFloatPosition(x: number, y: number): Promise<void> {
    await this.store.putSetting('floatWindowPosition', JSON.stringify({ x, y }));
  }

  listPrompts() {
    return this.store.listPromptProfiles();
  }

  updatePrompt(profileId: Id, content: string) {
    return this.store.updatePrompt(profileId, content);
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildLocalDecisionFromEvaluation(evaluation: SubmissionEvaluationAgentOutput): NextStepDecisionAgentOutput {
  const passed = evaluation.result === 'passed' || evaluation.recommendedAction === 'complete_task' || evaluation.recommendedAction === 'advance';
  if (passed) {
    return {
      decision: 'complete_task',
      reason: evaluation.feedback,
      taskCompleted: true,
      nextStep: null,
      remediation: null,
      carryForward: ''
    };
  }

  const decision = evaluation.recommendedAction === 'advance' || evaluation.recommendedAction === 'complete_task'
    ? 'remediate'
    : evaluation.recommendedAction;
  return {
    decision,
    reason: evaluation.feedback,
    taskCompleted: false,
    nextStep: null,
    remediation: null,
    carryForward: evaluation.missingRequirements[0] ?? evaluation.misconceptions[0] ?? ''
  };
}

function buildLocalSubmissionEvaluation(content: string, task: DailyGuideTask): SubmissionEvaluationAgentOutput {
  const trimmed = content.trim();
  const passed = trimmed.length >= 10;
  return {
    result: passed ? 'passed' : 'unclear',
    mastery: passed ? 100 : 30,
    evidence: passed
      ? [`已提交：${truncateForLocalEvaluation(trimmed)}`, ...task.doneWhen]
      : ['提交内容过短，本地检查无法确认已完成。'],
    correctParts: passed ? ['提交了主任务最终产出。'] : [],
    misconceptions: [],
    missingRequirements: passed ? [] : task.doneWhen,
    feedback: passed
      ? '本地检查通过：已收到主任务最终产出。'
      : '本地检查未通过：请补充可验收的最终产出后再提交。',
    recommendedAction: passed ? 'complete_task' : 'request_user_decision'
  };
}

function truncateForLocalEvaluation(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 119)}…`;
}
