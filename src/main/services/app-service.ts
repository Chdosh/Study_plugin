import type { BrowserWindow } from 'electron';
import { ipcChannels } from '../../shared/ipc';
import type { DailyGuideAgentOutput, NextStepDecisionAgentOutput, SubmissionEvaluationAgentOutput } from '../../shared/schemas';
import type { AppSettings, DailyGuideTask, DailyPlanBlock, GoalBrief, Id, RoadmapStage, ShortPlanDay, StudySession } from '../../shared/types';
import { AiClient } from '../ai/ai-client';
import {
  DailyGuideAgent,
  GoalIntakeAgent,
  ReflectionAgent,
  RoadmapAgent,
  ShortPlanAgent,
  StepQuestionAgent,
  SubmissionEvaluationAgent,
  TeachStepAgent
} from '../ai/agents';
import { ContextBuilder } from './context-builder';
import { FocusMonitor } from './focus-monitor';
import type { SettingsService } from './settings-service';
import type { StudyStore } from './store';
import { isPassingEvaluation } from '../domain/execution-state-machine';

export class AppService {
  private readonly aiClient = new AiClient();
  private readonly reflectionAgent = new ReflectionAgent(this.aiClient);
  private readonly goalIntakeAgent = new GoalIntakeAgent(this.aiClient);
  private readonly roadmapAgent = new RoadmapAgent(this.aiClient);
  private readonly shortPlanAgent = new ShortPlanAgent(this.aiClient);
  private readonly dailyGuideAgent = new DailyGuideAgent(this.aiClient);
  private readonly teachStepAgent = new TeachStepAgent(this.aiClient);
  private readonly questionAgent = new StepQuestionAgent(this.aiClient);
  private readonly evaluationAgent = new SubmissionEvaluationAgent(this.aiClient);
  private readonly contextBuilder: ContextBuilder;
  private readonly focusMonitor: FocusMonitor;

  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly getMainWindow: () => BrowserWindow | null
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

  listHistory() {
    return this.store.listGoalIntakes();
  }

  getHistoryIntake(intakeId: Id) {
    return this.store.getGoalIntakeById(intakeId);
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
    let dailyGuideOutput: DailyGuideAgentOutput;
    try {
      dailyGuideOutput = await this.dailyGuideAgent.run({
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
    } catch (error) {
      await this.store.saveAiReview({
        kind: 'daily_guide',
        date,
        provider: 'deepseek',
        model: runtimeSettings.deepseekModel,
        promptProfileId: profile.id,
        promptVersionId: profile.activeVersionId,
        inputSnapshot: { goalId, brief, roadmap: roadmapOutput, shortPlan: shortPlanOutput },
        output: {},
        outputSchemaVersion: 'daily-guide.v2',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof Error && error.message.includes('缺少 DeepSeek API Key')) {
        throw error;
      }
      throw new Error('生成今日执行稿失败：AI 返回没有通过本地校验，已记录失败。请重试一次，或在设置里调低提示词复杂度。');
    }
    const result = await this.store.saveLayeredPlan({
      goal,
      brief,
      date,
      windows,
      roadmap: roadmapOutput,
      shortPlan: shortPlanOutput,
      dailyGuide: dailyGuideOutput
    });
    return result;
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

  async startSession(blockId: Id) {
    const session = await this.store.startSession(blockId);
    this.focusMonitor.start(session.id);
    this.getMainWindow()?.flashFrame(true);
    await this.pushSessionState(session);
    return session;
  }

  async pauseSession(sessionId: Id) {
    this.focusMonitor.stop();
    const session = await this.store.pauseSession(sessionId);
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
    // "Current session" for UI recovery: active and paused sessions both belong to
    // the same resumable Focus Session. Completed/skipped sessions are historical.
    const active = sessions.find((s) => s.status === 'active' || s.status === 'paused');
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

  completeCurrentAction() {
    return this.store.completeCurrentAction();
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
    const result = await this.store.saveEvaluationAndDecision({
      submission,
      evaluationOutput,
      decisionOutput,
      evaluationAiReviewId
    });
    if (result.decision.taskCompleted && active?.session) {
      this.focusMonitor.stop();
      const completedSession = await this.store.completeSession(active.session.id);
      await this.pushSessionState(completedSession);
    }
    return result;
  }

  decidePlanAdjustment(proposalId: Id, status: 'accepted' | 'rejected') {
    return this.store.decidePlanAdjustment(proposalId, status);
  }

  async pushSessionState(session: StudySession): Promise<void> {
    let block: DailyPlanBlock | null = null;
    if (session.blockId) {
      block = await this.store.getBlock(session.blockId);
    }
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(ipcChannels.sessionStateChanged, { session, block });
    }
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
  if (isPassingEvaluation(evaluation)) {
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
