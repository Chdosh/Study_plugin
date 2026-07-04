import type {
  AppSettings, DailyGuide, DailyPlan, DailyPlanBlock, GoalBrief, GoalIntake,
  GoalIntakeState, HistoryIntakeSummary, ImportParseResult, LayeredPlanResult,
  LearningGoal, LearningRuntimeSnapshot, PlanAdjustmentProposal, PlanStage,
  PromptProfile, QuestionAnswerResult, ReviewResult, StageOutlineResult,
  StudySession, StudyWindow, SubmissionEvaluationResult, TaskItem,
  TeachStepResult, TodayGuideState, StudyAppApi
} from '../../../shared/types';
import { type PreviewConfig, getPreviewConfig, isBrowserMode, SCENARIO_DELAY_MS } from './url-state';
import {
  createAppSettings, createDailyGuide, createDailyPlans, createGoalIntakeState,
  createGuideActions, createGuideBlocks, createGuideTasks, createHistorySummaries,
  createLayeredPlanResult, createLearningGoal, createLearningRuntimeSnapshot,
  createPromptProfiles, createReviewResult, createRoadmapStages, createShortPlanDays,
  createStudySession, createTaskItems, createAdjustmentProposal,
  createTodayGuideState, mockId, toScenario, type MockScenario
} from './mock-data';

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  MockStudyAppApi                                                   */
/* ------------------------------------------------------------------ */
export class MockStudyAppApi implements StudyAppApi {
  private config: PreviewConfig;
  private scenario: MockScenario;
  private _currentSession: StudySession | null = null;
  private _guideSeq = 0;
  private _intakeSeq = 0;
  private _sessionSeq = 0;
  private _navCallbacks: Array<(page: string) => void> = [];
  private _sessionCallbacks: Array<(data: { session: StudySession | null; block: DailyPlanBlock | null }) => void> = [];
  private _goalIntakeState: GoalIntakeState;
  private _todayGuideState: TodayGuideState;
  private _settings: AppSettings;
  private _tasks: TaskItem[];
  private _plans: DailyPlan[];
  private _prompts: PromptProfile[];
  private _historySummaries: HistoryIntakeSummary[];
  private _runtimeSnapshot: LearningRuntimeSnapshot;

  constructor(config: PreviewConfig) {
    this.config = config;
    this.scenario = toScenario(config);
    this._settings = createAppSettings(this.scenario);
    this._tasks = createTaskItems(this.scenario);
    this._todayGuideState = createTodayGuideState(config);
    this._goalIntakeState = createGoalIntakeState(this.scenario);
    this._plans = createDailyPlans(this.scenario);
    this._prompts = createPromptProfiles();
    this._historySummaries = createHistorySummaries();
    this._runtimeSnapshot = createLearningRuntimeSnapshot(this.scenario.isEmpty ? false : true);

    const block = this._todayGuideState.guide?.blocks[0] ?? this._plans[0]?.blocks[0] ?? null;
    if (config.session === 'running') {
      this._currentSession = createStudySession('active', block?.id);
    } else if (config.session === 'paused') {
      this._currentSession = createStudySession('paused', block?.id);
    }
  }

  private async maybeDelay(): Promise<void> {
    if (this.scenario.isLoading) {
      await delay(SCENARIO_DELAY_MS);
    }
    if (this.scenario.isError) {
      throw new Error('[模拟错误] 模拟 API 返回错误，用于测试错误 UI');
    }
  }

  // ── settings ──────────────────────────────────────────────────────
  settings = {
    get: async (): Promise<AppSettings> => {
      await this.maybeDelay();
      return this._settings;
    },
    update: async (patch: Partial<AppSettings> & { deepseekApiKey?: string }): Promise<AppSettings> => {
      await this.maybeDelay();
      this._settings = { ...this._settings, ...patch, hasDeepseekApiKey: patch.deepseekApiKey ? true : this._settings.hasDeepseekApiKey };
      return this._settings;
    }
  };

  // ── onboarding ────────────────────────────────────────────────────
  onboarding = {
    getCurrent: async (): Promise<GoalIntakeState> => {
      await this.maybeDelay();
      return this._goalIntakeState;
    },
    sendMessage: async (content: string): Promise<GoalIntakeState> => {
      await this.maybeDelay();
      this._intakeSeq++;
      const userMsg = { id: mockId('msg'), intakeId: this._goalIntakeState.intake.id, role: 'user' as const, content, createdAt: new Date().toISOString() };
      const aiMsg = { id: mockId('msg'), intakeId: this._goalIntakeState.intake.id, role: 'assistant' as const, content: `已收到你的信息。根据你的描述，我理解你的目标正在逐步明确。能否告诉我更多关于你目前掌握的程度？`, createdAt: new Date().toISOString() };
      this._goalIntakeState = {
        ...this._goalIntakeState,
        messages: [...this._goalIntakeState.messages, userMsg, aiMsg],
        intake: { ...this._goalIntakeState.intake, status: this._intakeSeq >= 3 ? 'ready' : 'collecting' }
      };
      return this._goalIntakeState;
    },
    confirmGoal: async (briefPatch?: Partial<GoalBrief>): Promise<{ goal: LearningGoal; intake: GoalIntake }> => {
      await this.maybeDelay();
      const goal = createLearningGoal(this.scenario);
      const intake: GoalIntake = {
        ...this._goalIntakeState.intake,
        status: 'confirmed',
        goalId: goal.id,
        brief: this._goalIntakeState.intake.brief ? { ...this._goalIntakeState.intake.brief, ...briefPatch } : null,
        confirmedAt: new Date().toISOString()
      };
      return { goal, intake };
    }
  };

  // ── guides ────────────────────────────────────────────────────────
  guides = {
    generateLayeredPlan: async (goalId: string): Promise<LayeredPlanResult> => {
      await this.maybeDelay();
      this._guideSeq++;
      const result = createLayeredPlanResult(this.scenario);
      this._todayGuideState = { goal: result.goal, roadmap: result.roadmap, shortPlan: result.shortPlan, guide: result.guide };
      return result;
    },
    confirmDailyGuide: async (guideId: string): Promise<DailyGuide> => {
      await this.maybeDelay();
      if (this._todayGuideState.guide) {
        this._todayGuideState.guide = { ...this._todayGuideState.guide, status: 'confirmed', confirmedAt: new Date().toISOString() };
      }
      return this._todayGuideState.guide ?? createDailyGuide(this.scenario);
    },
    archiveTodayAndRestart: async (): Promise<GoalIntakeState> => {
      await this.maybeDelay();
      this._todayGuideState = { goal: null, roadmap: [], shortPlan: [], guide: null };
      this._goalIntakeState = createGoalIntakeState({ ...this.scenario, isEmpty: true });
      return this._goalIntakeState;
    },
    listToday: async (): Promise<TodayGuideState> => {
      await this.maybeDelay();
      return this._todayGuideState;
    }
  };

  // ── history ───────────────────────────────────────────────────────
  history = {
    listAll: async (): Promise<HistoryIntakeSummary[]> => {
      await this.maybeDelay();
      return this._historySummaries;
    },
    getById: async (intakeId: string): Promise<GoalIntakeState> => {
      await this.maybeDelay();
      return this._goalIntakeState;
    }
  };

  // ── imports ───────────────────────────────────────────────────────
  imports = {
    create: async (rawText: string, source: string): Promise<any> => {
      await this.maybeDelay();
      return { id: mockId('import'), source, rawText, status: 'created', createdAt: new Date().toISOString(), parsedAt: null };
    },
    parse: async (importId: string, promptProfileId?: string): Promise<ImportParseResult> => {
      await this.maybeDelay();
      return { importId, goalsCreated: 1, tasksCreated: 3, tasks: this._tasks };
    }
  };

  // ── tasks ─────────────────────────────────────────────────────────
  tasks = {
    list: async (): Promise<TaskItem[]> => {
      await this.maybeDelay();
      return this._tasks;
    },
    update: async (taskId: string, patch: Partial<TaskItem>): Promise<TaskItem> => {
      await this.maybeDelay();
      const idx = this._tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new Error(`Task ${taskId} not found`);
      this._tasks[idx] = { ...this._tasks[idx], ...patch, updatedAt: new Date().toISOString() };
      return this._tasks[idx];
    }
  };

  // ── goals ─────────────────────────────────────────────────────────
  goals = {
    create: async (title: string, description?: string): Promise<LearningGoal> => {
      await this.maybeDelay();
      return createLearningGoal(this.scenario);
    },
    list: async (): Promise<LearningGoal[]> => {
      await this.maybeDelay();
      return [createLearningGoal(this.scenario)];
    },
    listStages: async (goalId?: string): Promise<PlanStage[]> => {
      await this.maybeDelay();
      return createRoadmapStages().map((s) => ({
        id: s.id, goalId: s.goalId, title: s.title, objective: s.objective,
        prerequisites: null, successCriteria: s.successCriteria,
        status: 'confirmed' as const, position: s.position,
        summary: null, createdAt: '', updatedAt: ''
      }));
    },
    generateStages: async (goalId?: string, promptProfileId?: string): Promise<StageOutlineResult> => {
      await this.maybeDelay();
      const goal = createLearningGoal(this.scenario);
      const stages = createRoadmapStages().map((s) => ({
        id: s.id, goalId: s.goalId, title: s.title, objective: s.objective,
        prerequisites: null, successCriteria: s.successCriteria,
        status: 'proposed' as const, position: s.position,
        summary: null, createdAt: '', updatedAt: ''
      }));
      return { goal, stages };
    },
    confirmStages: async (goalId: string): Promise<PlanStage[]> => {
      await this.maybeDelay();
      return createRoadmapStages().map((s) => ({
        id: s.id, goalId: s.goalId, title: s.title, objective: s.objective,
        prerequisites: null, successCriteria: s.successCriteria,
        status: 'confirmed' as const, position: s.position,
        summary: null, createdAt: '', updatedAt: ''
      }));
    }
  };

  // ── plans ─────────────────────────────────────────────────────────
  plans = {
    list: async (date?: string): Promise<DailyPlan[]> => {
      await this.maybeDelay();
      return this._plans;
    },
    generate: async (date: string, availableWindows: StudyWindow[], promptProfileId?: string): Promise<DailyPlan> => {
      await this.maybeDelay();
      return this._plans[0] ?? createDailyPlans(this.scenario)[0];
    },
    confirm: async (planId: string): Promise<DailyPlan> => {
      await this.maybeDelay();
      const plan = this._plans.find((p) => p.id === planId);
      if (plan) {
        plan.status = 'confirmed';
      }
      return this._plans[0] ?? createDailyPlans(this.scenario)[0];
    }
  };

  // ── sessions ──────────────────────────────────────────────────────
  private _getActiveBlock(): DailyPlanBlock | null {
    return this._plans[0]?.blocks[0] ?? null;
  }

  sessions = {
    getActive: async (): Promise<{ session: StudySession; block: DailyPlanBlock } | null> => {
      await this.maybeDelay();
      if (!this._currentSession) return null;
      const block = this._getActiveBlock();
      return block ? { session: this._currentSession!, block } : null;
    },
    start: async (blockId: string): Promise<StudySession> => {
      await this.maybeDelay();
      this._sessionSeq++;
      this._currentSession = createStudySession('active', blockId);
      this._notifySessionChange();
      return this._currentSession;
    },
    pause: async (sessionId: string): Promise<StudySession> => {
      await this.maybeDelay();
      if (this._currentSession) {
        this._currentSession = createStudySession('paused', this._currentSession.blockId ?? undefined);
        this._notifySessionChange();
      }
      return this._currentSession ?? createStudySession('paused');
    },
    complete: async (sessionId: string, notes?: string): Promise<StudySession> => {
      await this.maybeDelay();
      this._currentSession = createStudySession('completed', this._currentSession?.blockId ?? undefined);
      if (notes) this._currentSession.notes = notes;
      this._notifySessionChange();
      return this._currentSession;
    },
    skip: async (blockId: string, reason: string): Promise<void> => {
      await this.maybeDelay();
      // no-op
    },
    getAccumulated: async (blockId: string, excludeSessionId?: string): Promise<number> => {
      await this.maybeDelay();
      return this._currentSession?.durationMinutes ?? 0;
    }
  };

  // ── learning ──────────────────────────────────────────────────────
  learning = {
    getState: async (): Promise<LearningRuntimeSnapshot> => {
      await this.maybeDelay();
      return this._runtimeSnapshot;
    },
    teachCurrentStep: async (promptProfileId?: string): Promise<TeachStepResult> => {
      await this.maybeDelay();
      return {
        step: {
          id: mockId('step'), goalId: mockId('goal'), stageId: mockId('stage'),
          taskId: mockId('gtask'), blockId: null,
          title: '理解组件生命周期',
          objective: '掌握 React 组件的挂载、更新和卸载阶段',
          instruction: '阅读 React 生命周期文档，重点关注 useEffect 的清理机制',
          expectedOutput: '能解释每个生命周期的触发时机和最佳实践',
          successCriteria: '能正确回答生命周期相关的面试题',
          status: 'active', attempt: 1, position: 0,
          summary: null, createdAt: '', updatedAt: ''
        },
        explanation: '## 组件生命周期概述\n\nReact 组件生命周期分为三个阶段：\n\n1. **挂载阶段（Mount）**：组件首次渲染到 DOM\n2. **更新阶段（Update）**：组件的 state 或 props 发生变化\n3. **卸载阶段（Unmount）**：组件从 DOM 中移除\n\n### 函数组件中的生命周期\n\n函数组件通过 `useEffect` Hook 模拟生命周期：\n\n```typescript\nuseEffect(() => {\n  // 挂载和更新时执行\n  return () => {\n    // 卸载时执行（清理函数）\n  };\n}, [依赖数组]);\n```\n\n### 练习建议\n\n尝试为一个计时器组件编写完整的生命周期管理代码。',
        userAction: '请按照上述说明，创建一个 Timer 组件，包含开始、暂停和重置功能。使用 useEffect 管理计时器的启动和清理。',
        requiresSubmission: true,
        contextSourceIds: [mockId('ctx')]
      };
    },
    completeCurrentAction: async (): Promise<LearningRuntimeSnapshot> => {
      await this.maybeDelay();
      return this._runtimeSnapshot;
    },
    askQuestion: async (question: string, promptProfileId?: string): Promise<QuestionAnswerResult> => {
      await this.maybeDelay();
      return {
        thread: {
          id: mockId('thread'), goalId: mockId('goal'), stageId: mockId('stage'),
          taskId: mockId('gtask'), stepId: mockId('step'),
          status: 'open', question, resolutionSummary: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null
        },
        messages: [
          { id: mockId('qmsg'), threadId: mockId('thread'), role: 'user', content: question, createdAt: new Date().toISOString() },
          { id: mockId('qmsg'), threadId: mockId('thread'), role: 'assistant', content: `关于你的问题「${question}」，我的理解是：\n\n这是 React 中一个很重要的概念。让我从几个角度来帮你理解：\n\n1. **核心原理**：React 通过虚拟 DOM 和协调机制来高效更新 UI\n2. **实际应用**：在实际开发中，这个概念体现在组件设计和数据流中\n3. **最佳实践**：建议遵循 React 官方推荐的模式\n\n如果还有疑问，欢迎继续提问！`, createdAt: new Date().toISOString() }
        ],
        answer: `关于你的问题「${question}」，这是 React 中一个很重要的概念。让我从几个角度来帮你理解：\n\n1. **核心原理**：React 通过虚拟 DOM 和协调机制来高效更新 UI\n2. **实际应用**：在实际开发中，这个概念体现在组件设计和数据流中\n3. **最佳实践**：建议遵循 React 官方推荐的模式`,
        resolved: false,
        returnToStepInstruction: '回到当前步骤，继续完成学习任务。'
      };
    },
    resolveQuestion: async (threadId: string, summary?: string): Promise<LearningRuntimeSnapshot> => {
      await this.maybeDelay();
      return this._runtimeSnapshot;
    },
    submitResult: async (content: string, promptProfileId?: string): Promise<SubmissionEvaluationResult> => {
      await this.maybeDelay();
      return {
        submission: {
          id: mockId('sub'), stepId: mockId('step'), sessionId: this._currentSession?.id ?? null,
          content, createdAt: new Date().toISOString()
        },
        evaluation: {
          id: mockId('eval'), submissionId: mockId('sub'), stepId: mockId('step'),
          result: 'passed', mastery: 85,
          evidence: ['代码结构清晰，符合规范', '正确使用了生命周期方法', '测试用例全部通过'],
          correctParts: ['组件初始化逻辑正确', '清理函数实现完整', '状态管理恰当'],
          misconceptions: ['没有明显误解'],
          missingRequirements: ['可以增加边缘情况处理'],
          feedback: '你的实现很好！组件结构清晰，生命周期管理正确。建议进一步了解 React 18 的自动批处理机制。',
          recommendedAction: 'advance',
          aiReviewId: null, createdAt: new Date().toISOString()
        },
        decision: {
          id: mockId('dec'), evaluationId: mockId('eval'), stepId: mockId('step'),
          decision: 'advance', reason: '学习目标已达成，掌握度 85%，建议进入下一阶段',
          taskCompleted: false,
          nextStep: {
            title: '深入学习 Hooks 规则',
            objective: '掌握 Hooks 的使用规则和最佳实践',
            instruction: '学习 React Hooks 规则文档，注意 hooks 的调用顺序和条件限制',
            expectedOutput: '总结 Hooks 使用规则清单',
            successCriteria: '能识别并纠正违反 Hooks 规则的代码'
          },
          remediation: null,
          carryForward: null,
          aiReviewId: null, createdAt: new Date().toISOString()
        },
        nextStep: {
          id: mockId('step'), goalId: mockId('goal'), stageId: mockId('stage'),
          taskId: mockId('gtask'), blockId: null,
          title: '深入学习 Hooks 规则',
          objective: '掌握 Hooks 的使用规则和最佳实践',
          instruction: '学习 React Hooks 规则文档，注意 hooks 的调用顺序和条件限制',
          expectedOutput: '总结 Hooks 使用规则清单',
          successCriteria: '能识别并纠正违反 Hooks 规则的代码',
          status: 'planned', attempt: 0, position: 1,
          summary: null, createdAt: '', updatedAt: ''
        }
      };
    },
    decideAdjustment: async (proposalId: string, status: 'accepted' | 'rejected'): Promise<PlanAdjustmentProposal> => {
      await this.maybeDelay();
      return { ...createAdjustmentProposal(), status, decidedAt: new Date().toISOString() };
    }
  };

  // ── reviews ───────────────────────────────────────────────────────
  reviews = {
    generate: async (date: string): Promise<ReviewResult> => {
      await this.maybeDelay();
      return createReviewResult(this.config.review === 'completed' || true);
    }
  };

  // ── prompts ───────────────────────────────────────────────────────
  prompts = {
    list: async (): Promise<PromptProfile[]> => {
      await this.maybeDelay();
      return this._prompts;
    },
    update: async (profileId: string, content: string): Promise<PromptProfile> => {
      await this.maybeDelay();
      const idx = this._prompts.findIndex((p) => p.id === profileId);
      if (idx >= 0) this._prompts[idx] = { ...this._prompts[idx], content, version: this._prompts[idx].version + 1 };
      return this._prompts[idx] ?? this._prompts[0];
    }
  };

  // ── event listeners ───────────────────────────────────────────────
  onNavigate = (callback: (page: string) => void): (() => void) => {
    this._navCallbacks.push(callback);
    return () => {
      this._navCallbacks = this._navCallbacks.filter((cb) => cb !== callback);
    };
  };

  onSessionStateChanged = (callback: (data: { session: StudySession | null; block: DailyPlanBlock | null }) => void): (() => void) => {
    this._sessionCallbacks.push(callback);
    return () => {
      this._sessionCallbacks = this._sessionCallbacks.filter((cb) => cb !== callback);
    };
  };

  private _notifySessionChange(): void {
    const block = this._getActiveBlock();
    const data = { session: this._currentSession, block };
    for (const cb of this._sessionCallbacks) {
      cb(data);
    }
  }
}
