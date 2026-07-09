import type {
  AppSettings, DailyGuide, DailyGuideBlock, DailyGuideTask, DailyGuideAction,
  GoalBrief, GoalIntake, GoalIntakeMessage,
  GoalIntakeState, HistoryIntakeSummary, LearningGoal, LearningRuntimeSnapshot,
  LearningRuntimeState, LearningStep, LearningSubmission, LearningEvaluation,
  StoredNextStepDecision, PlanAdjustmentProposal, PlanStage, PromptProfile,
  ReviewResult, RoadmapStage, ShortPlanDay, StudySession,
  TeachStepResult, TodayGuideState, QuestionThread, QuestionMessage,
  QuestionAnswerResult, SubmissionEvaluationResult, LayeredPlanResult
} from '../../../shared/types';
import { type PreviewConfig } from './url-state';

/* ------------------------------------------------------------------ */
/*  ID utilities                                                      */
/* ------------------------------------------------------------------ */
let _id = 1000;
export function mockId(prefix = 'mock'): string {
  return `${prefix}_${++_id}`;
}

/* ------------------------------------------------------------------ */
/*  Scenario helpers                                                   */
/* ------------------------------------------------------------------ */
export interface MockScenario {
  isNormal: boolean;
  isEmpty: boolean;
  hasLongTitle: boolean;
  hasManyTasks: boolean;
  isAiUnavailable: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function toScenario(config: PreviewConfig): MockScenario {
  const s = config.scenario;
  return {
    isNormal: !s || s === 'normal',
    isEmpty: s === 'empty',
    hasLongTitle: s === 'long-title',
    hasManyTasks: s === 'many-tasks',
    isAiUnavailable: s === 'ai-unavailable',
    isLoading: s === 'loading',
    isError: s === 'error'
  };
}

/* ------------------------------------------------------------------ */
/*  LONG TITLE                                                         */
/* ------------------------------------------------------------------ */
const LONG_TITLE = '深入理解 TypeScript 高级类型系统中的条件类型、映射类型、模板字面量类型及递归类型别名的综合应用与实战场景分析';
const LONG_OBJ = '通过实际项目案例，系统性地掌握 TypeScript 高级类型系统的各种复杂用法，包括但不限于条件类型分发、infer 关键字、映射类型修饰符、递归类型别名等核心概念';
const LONG_SCOPE = '本任务涵盖 TypeScript 高级类型的全部核心概念，包括条件类型（Conditional Types）、映射类型（Mapped Types）、模板字面量类型（Template Literal Types）、递归类型别名（Recursive Type Aliases）、infer 类型推断、类型体操实战等六大模块，每个模块包含理论基础、代码实践和综合练习三个子阶段';

/* ------------------------------------------------------------------ */
/*  FACTORY: AppSettings                                               */
/* ------------------------------------------------------------------ */
export function createAppSettings(scenario: MockScenario): AppSettings {
  return {
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-chat',
    hasDeepseekApiKey: !scenario.isAiUnavailable,
    autoLaunch: true,
    defaultBlockMinutes: 25,
    dailyStudyWindows: [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '17:00' },
      { start: '20:00', end: '22:00' }
    ]
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: DailyGuideBlock[]                                         */
/* ------------------------------------------------------------------ */
export function createGuideBlocks(guideId: string, scenario: MockScenario): DailyGuideBlock[] {
  if (scenario.isEmpty) return [];
  const t = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return [
    {
      id: mockId('gblock'), guideId, planBlockId: mockId('pblock'),
      title: scenario.hasLongTitle ? LONG_TITLE : 'React 组件设计原则',
      startTime: t(9, 0), endTime: t(10, 30), durationMinutes: 90,
      objective: '掌握 React 组件的设计原则和最佳实践',
      action: '阅读 React 官方文档中关于组件设计的部分，完成 3 个练习组件',
      expectedOutput: '3 个符合设计原则的 React 组件代码',
      successCriteria: '组件满足单一职责、可组合性、可测试性要求',
      fallback: '参考官方示例或查阅社区最佳实践文章',
      status: 'active', position: 0
    },
    {
      id: mockId('gblock'), guideId, planBlockId: mockId('pblock'),
      title: 'React Hooks 深入理解',
      startTime: t(10, 30), endTime: t(12, 0), durationMinutes: 90,
      objective: '深入理解 useState、useEffect、useCallback 等核心 Hooks 的工作原理',
      action: '实现自定义 Hook，理解闭包陷阱和依赖数组管理',
      expectedOutput: '3 个自定义 Hook 的实现和测试',
      successCriteria: 'Hooks 无内存泄漏，依赖数组正确管理',
      fallback: '查看 React 官方 Hooks 文档和常见问题',
      status: 'planned', position: 1
    },
    {
      id: mockId('gblock'), guideId, planBlockId: mockId('pblock'),
      title: '状态管理方案对比',
      startTime: t(14, 0), endTime: t(15, 30), durationMinutes: 90,
      objective: '对比 Context、Redux、Zustand 等不同状态管理方案的优劣',
      action: '用至少两种方案实现同一个计数器应用，总结差异',
      expectedOutput: '对比报告 + 两种实现的代码',
      successCriteria: '能清晰阐述各方案的适用场景和取舍',
      fallback: '参考各框架的官方对比文档',
      status: 'planned', position: 2
    }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: DailyGuideAction[]                                        */
/* ------------------------------------------------------------------ */
export function createGuideActions(taskId: string): DailyGuideAction[] {
  const now = new Date().toISOString();
  return [
    {
      id: mockId('gact'), taskId,
      title: '阅读官方文档',
      instruction: '阅读 React 官方文档中关于该主题的核心章节，标注重点',
      checkpoint: '完成阅读并记录至少 5 个关键概念',
      status: 'done', progressNote: '已完成阅读并做笔记', completedAt: now, position: 0
    },
    {
      id: mockId('gact'), taskId,
      title: '编写示例代码',
      instruction: '根据所学概念编写至少 2 个可运行的示例代码',
      checkpoint: '代码能正常运行并通过基本测试',
      status: 'planned', progressNote: null, completedAt: null, position: 1
    },
    {
      id: mockId('gact'), taskId,
      title: '总结与复盘',
      instruction: '整理今天的学习收获，形成结构化笔记',
      checkpoint: '笔记包含概念总结、代码示例和遇到的问题',
      status: 'planned', progressNote: null, completedAt: null, position: 2
    }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: DailyGuideTask[]                                          */
/* ------------------------------------------------------------------ */
export function createGuideTasks(guideId: string, scenario: MockScenario): DailyGuideTask[] {
  if (scenario.isEmpty) return [];
  const taskData = [
    {
      legacyPlanBlockId: mockId('pblock'),
      title: scenario.hasLongTitle ? LONG_TITLE : 'React 组件设计原则',
      objective: '掌握 React 组件的设计原则和最佳实践',
      scope: scenario.hasLongTitle ? LONG_SCOPE : '阅读 React 官方文档中关于组件设计的部分，完成 3 个练习组件',
      deliverable: '3 个符合设计原则的 React 组件代码',
      doneWhen: ['组件满足单一职责、可组合性、可测试性要求', '代码通过 lint 检查', '提交到 Git 仓库'],
      quickHint: '参考官方示例或查阅社区最佳实践文章',
      evaluationMode: 'local' as const,
      status: 'active' as const,
      progressPercent: 35,
      completedActions: [mockId('gact_done')],
      currentAction: {
        id: mockId('gact'), taskId: mockId('gtask'),
        title: '编写示例代码',
        instruction: '根据所学概念编写至少 2 个可运行的示例代码',
        checkpoint: '代码能正常运行并通过基本测试',
        status: 'planned' as const, progressNote: null, completedAt: null, position: 1
      },
      totalElapsedMinutes: 35
    },
    {
      legacyPlanBlockId: mockId('pblock'),
      title: 'React Hooks 深入理解',
      objective: '深入理解 useState、useEffect、useCallback 等核心 Hooks 的工作原理',
      scope: '实现自定义 Hook，理解闭包陷阱和依赖数组管理',
      deliverable: '3 个自定义 Hook 的实现和测试',
      doneWhen: ['Hooks 无内存泄漏，依赖数组正确管理', '代码通过 lint 检查'],
      quickHint: '查看 React 官方 Hooks 文档和常见问题',
      evaluationMode: 'ai' as const,
      status: 'planned' as const,
      progressPercent: 0,
      completedActions: [],
      currentAction: null,
      totalElapsedMinutes: 0
    },
    {
      legacyPlanBlockId: mockId('pblock'),
      title: '状态管理方案对比',
      objective: '对比 Context、Redux、Zustand 等不同状态管理方案的优劣',
      scope: '用至少两种方案实现同一个计数器应用，总结差异',
      deliverable: '对比报告 + 两种实现的代码',
      doneWhen: ['能清晰阐述各方案的适用场景和取舍', '代码通过 lint 检查'],
      quickHint: '参考各框架的官方对比文档',
      evaluationMode: 'ai' as const,
      status: 'planned' as const,
      progressPercent: 0,
      completedActions: [],
      currentAction: null,
      totalElapsedMinutes: 0
    }
  ];
  return taskData.map((data, idx) => ({
    id: mockId('gtask'),
    guideId,
    legacyPlanBlockId: data.legacyPlanBlockId,
    title: data.title,
    objective: data.objective,
    scope: data.scope,
    estimatedMinutes: { min: 30, target: 90, max: 120 },
    actions: createGuideActions(mockId('gtask')),
    deliverable: data.deliverable,
    doneWhen: data.doneWhen,
    quickHint: data.quickHint,
    evaluationMode: data.evaluationMode,
    submissionPolicy: 'once_after_task' as const,
    carryoverAllowed: true,
    status: data.status,
    progressPercent: data.progressPercent,
    completedActions: data.completedActions,
    remainingActions: [],
    currentAction: data.currentAction,
    nextStartPoint: null,
    totalElapsedMinutes: data.totalElapsedMinutes,
    position: idx,
    createdAt: '2026-07-04T08:00:00.000Z',
    updatedAt: '2026-07-04T10:30:00.000Z'
  }));
}

/* ------------------------------------------------------------------ */
/*  FACTORY: DailyGuide                                                */
/* ------------------------------------------------------------------ */
export function createDailyGuide(scenario: MockScenario): DailyGuide {
  const guideId = mockId('guide');
  const blocks = createGuideBlocks(guideId, scenario);
  const tasks = createGuideTasks(guideId, scenario);
  return {
    id: guideId,
    goalId: mockId('goal'),
    planId: mockId('plan'),
    date: '2026-07-04',
    status: 'confirmed',
    weekFocus: '夯实 React 基础，掌握组件化开发思维',
    todayGoal: '完成 React 组件设计原则的学习，掌握 Hooks 核心用法，对比不同状态管理方案',
    deliverables: ['组件设计笔记', 'Hooks 示例代码', '状态管理对比报告'],
    boundaries: ['今天不写业务代码', '不深入网络/构建工具', '不学习 Redux 中间件', '不超过 4 小时学习'],
    acceptanceCriteria: ['至少完成 2 个组件设计练习', '自定义 Hook 通过测试', '状态管理对比文档完成'],
    tomorrowActions: ['开始 Redux 状态管理学习', '完成未完成的组件练习'],
    createdAt: '2026-07-04T08:00:00.000Z',
    confirmedAt: '2026-07-04T08:30:00.000Z',
    tasks,
    blocks
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: TodayGuideState                                           */
/* ------------------------------------------------------------------ */
export function createTodayGuideState(config: PreviewConfig): TodayGuideState {
  const scenario = toScenario(config);
  if (config.guide === 'no-guide') {
    return { goal: scenario.isEmpty ? null : createLearningGoal(scenario), roadmap: [], shortPlan: [], guide: null };
  }
  return {
    goal: createLearningGoal(scenario),
    roadmap: createRoadmapStages(),
    shortPlan: createShortPlanDays(),
    guide: createDailyGuide(scenario)
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: RoadmapStage[]                                            */
/* ------------------------------------------------------------------ */
export function createRoadmapStages(): RoadmapStage[] {
  const gid = mockId('goal');
  return [
    { id: mockId('stage'), goalId: gid, title: '基础夯实', objective: '掌握 React 和 TypeScript 基础', direction: '从组件基础到 Hooks 深入', successCriteria: '能独立完成简单应用', position: 0, createdAt: '', updatedAt: '' },
    { id: mockId('stage'), goalId: gid, title: '工程化实践', objective: '掌握现代前端工程化工具链', direction: 'Webpack/Vite 配置、ESLint/Prettier 集成', successCriteria: '能从头搭建项目脚手架', position: 1, createdAt: '', updatedAt: '' },
    { id: mockId('stage'), goalId: gid, title: '项目实战', objective: '完成综合项目开发', direction: '从需求分析到部署上线的全流程', successCriteria: '项目通过验收评审', position: 2, createdAt: '', updatedAt: '' }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: ShortPlanDay[]                                            */
/* ------------------------------------------------------------------ */
export function createShortPlanDays(): ShortPlanDay[] {
  const gid = mockId('goal');
  return [
    { id: mockId('spday'), goalId: gid, dayIndex: 0, date: '2026-07-04', title: 'React 核心概念', focus: '组件和 Hooks', tasks: ['阅读文档', '编写示例'], expectedOutput: '学习笔记', successCriteria: '完成基础概念理解', createdAt: '' },
    { id: mockId('spday'), goalId: gid, dayIndex: 1, date: '2026-07-05', title: 'TypeScript 集成', focus: '类型系统', tasks: ['类型定义', '泛型实践'], expectedOutput: '类型声明文件', successCriteria: '项目通过 tsc 编译', createdAt: '' },
    { id: mockId('spday'), goalId: gid, dayIndex: 2, date: '2026-07-06', title: '综合练习', focus: '实战项目', tasks: ['搭建项目', '实现功能'], expectedOutput: '可运行的项目', successCriteria: '完成核心功能开发', createdAt: '' }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: LearningGoal                                              */
/* ------------------------------------------------------------------ */
export function createLearningGoal(scenario: MockScenario): LearningGoal {
  return {
    id: mockId('goal'),
    sourceImportId: null,
    title: scenario.hasLongTitle ? LONG_TITLE : '掌握 React + TypeScript 全栈开发',
    description: '从零开始系统学习 React 和 TypeScript，最终能独立完成全栈项目开发',
    status: 'active',
    priority: 1,
    dueDate: '2026-08-15',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-04T08:00:00.000Z'
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: GoalIntakeState                                           */
/* ------------------------------------------------------------------ */
export function createGoalIntakeState(scenario: MockScenario): GoalIntakeState {
  if (scenario.isEmpty) {
    return {
      intake: {
        id: mockId('intake'), status: 'collecting', goalId: null,
        brief: null, createdAt: '', updatedAt: '', confirmedAt: null
      },
      messages: [],
      activeGoal: null
    };
  }
  const brief: GoalBrief = {
    title: '掌握 React + TypeScript 全栈开发',
    targetOutcome: '能独立完成一个包含前后端的全栈应用',
    currentLevel: '有 JavaScript 基础，熟悉 HTML/CSS，了解基本的前端开发概念',
    availableTime: '工作日每晚 2-3 小时，周末每天 4-6 小时',
    deadline: '2026 年 8 月中旬',
    constraints: ['白天需要上班，只能晚上学习', '需要兼顾工作项目'],
    successCriteria: ['完成全栈博客系统开发', '通过项目验收评审']
  };
  const intakeId = mockId('intake');
  const messages: GoalIntakeMessage[] = [
    { id: mockId('msg'), intakeId, role: 'assistant', content: '你准备学习什么？可以直接说目标、期限、基础和每天可投入时间。', createdAt: '' },
    { id: mockId('msg'), intakeId, role: 'user', content: '我想系统学习 React 和 TypeScript，目标是能独立做一个全栈项目。有 JavaScript 基础，每天晚上能学 2-3 小时，周末更多。希望在 8 月中旬前达到目标。', createdAt: '' },
    { id: mockId('msg'), intakeId, role: 'assistant', content: '很好，我帮你梳理一下：\n\n**目标**：掌握 React + TypeScript 全栈开发\n\n**期望结果**：能独立完成全栈应用\n\n**当前基础**：有 JS 基础\n\n**时间安排**：工作日每晚 2-3 小时，周末 4-6 小时\n\n**截止时间**：2026 年 8 月中旬\n\n我理解得对吗？你可以补充或修改以上内容。', createdAt: '' }
  ];
  const SC: GoalIntakeState = {
    intake: { id: intakeId, status: 'ready', goalId: mockId('goal'), brief, createdAt: '', updatedAt: '', confirmedAt: null },
    messages,
    activeGoal: createLearningGoal(scenario)
  };
  return SC;
}

/* ------------------------------------------------------------------ */
/*  FACTORY: History Intake Summary                                    */
/* ------------------------------------------------------------------ */
export function createHistorySummaries(): HistoryIntakeSummary[] {
  const intakeId1 = mockId('intake');
  const intakeId2 = mockId('intake');
  return [
    { intake: { id: intakeId1, status: 'confirmed', goalId: mockId('goal'), brief: null, createdAt: '2026-07-01T09:00:00.000Z', updatedAt: '2026-07-01T09:30:00.000Z', confirmedAt: '2026-07-01T09:30:00.000Z' }, goalTitle: '掌握 React + TypeScript 全栈开发', messageCount: 12 },
    { intake: { id: intakeId2, status: 'confirmed', goalId: mockId('goal'), brief: null, createdAt: '2026-06-28T10:00:00.000Z', updatedAt: '2026-06-28T10:20:00.000Z', confirmedAt: '2026-06-28T10:20:00.000Z' }, goalTitle: '算法与数据结构基础', messageCount: 8 }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: StudySession                                              */
/* ------------------------------------------------------------------ */
export function createStudySession(status: 'active' | 'paused' | 'completed' | 'skipped', blockId?: string): StudySession {
  const sid = mockId('session');
  return {
    id: sid,
    blockId: blockId ?? mockId('pblock'),
    taskId: null,
    startedAt: '2026-07-04T09:05:00.000Z',
    endedAt: status === 'active' ? null : '2026-07-04T10:00:00.000Z',
    durationMinutes: status === 'active' ? 35 : status === 'paused' ? 45 : 55,
    status,
    focusScore: status === 'completed' ? 85 : null,
    notes: status === 'completed' ? '完成了组件设计练习，效果不错' : null
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: LearningRuntimeSnapshot                                   */
/* ------------------------------------------------------------------ */
export function createLearningRuntimeSnapshot(hasStep: boolean): LearningRuntimeSnapshot {
  const state: LearningRuntimeState = {
    id: 'default',
    activeGoalId: mockId('goal'),
    activeStageId: mockId('stage'),
    activeDailyTaskId: mockId('gtask'),
    activeStepId: hasStep ? mockId('step') : null,
    activeQuestionThreadId: null,
    sessionStatus: 'idle',
    updatedAt: '2026-07-04T09:30:00.000Z'
  };
  const step: LearningStep = {
    id: mockId('step'), goalId: mockId('goal'), stageId: mockId('stage'), taskId: mockId('gtask'), blockId: null,
    title: '理解组件生命周期',
    objective: '掌握 React 组件的挂载、更新和卸载阶段',
    instruction: '阅读 React 生命周期文档，重点关注 useEffect 的清理机制',
    expectedOutput: '能解释每个生命周期的触发时机和最佳实践',
    successCriteria: '能正确回答生命周期相关的面试题',
    status: 'active', attempt: 1, position: 0,
    summary: null, createdAt: '', updatedAt: ''
  };
  return {
    state,
    goal: createLearningGoal({ isNormal: true, isEmpty: false, hasLongTitle: false, hasManyTasks: false, isAiUnavailable: false, isLoading: false, isError: false }),
    stage: null, task: null, block: null,
    step: hasStep ? step : null,
    questionThread: null, questionMessages: [],
    recentStepSummaries: [],
    latestSubmission: null, latestEvaluation: null, latestDecision: null,
    pendingAdjustment: null
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: ReviewResult                                              */
/* ------------------------------------------------------------------ */
export function createReviewResult(completed: boolean): ReviewResult {
  return {
    reviewId: mockId('review'),
    date: '2026-07-04',
    completionScore: completed ? 78 : 0,
    focusScore: completed ? 82 : 0,
    summary: completed ? '今日完成了 React 组件设计原则的学习，进度良好。重点完成了 2 个组件练习，对单一职责和组合模式有了深入理解。建议明天继续深入 Hooks 学习。' : '暂无学习数据',
    nextActions: completed
      ? ['继续保持当前学习节奏', '明天重点关注 Hooks 的闭包陷阱', '周末安排一次综合练习']
      : ['开始今日学习任务', '配置 API Key 以启用 AI 功能']
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: PlanAdjustmentProposal                                    */
/* ------------------------------------------------------------------ */
export function createAdjustmentProposal(): PlanAdjustmentProposal {
  return {
    id: mockId('adj'),
    goalId: mockId('goal'),
    stageId: null,
    taskId: null,
    sourceDecisionId: null,
    status: 'pending',
    reason: '今天的学习进度比预期慢，建议明天适当减少新内容，增加复习和练习时间',
    proposedChanges: { tomorrowFocus: '复习今天内容 + 一个 Hooks 练习' },
    appliedTaskId: null,
    createdAt: '2026-07-04T10:30:00.000Z',
    decidedAt: null,
    appliedAt: null
  };
}

/* ------------------------------------------------------------------ */
/*  FACTORY: PromptProfile[]                                           */
/* ------------------------------------------------------------------ */
export function createPromptProfiles(): PromptProfile[] {
  return [
    { id: mockId('prompt'), key: 'foundation', name: '基础档', description: '适合新手，解释详细', activeVersionId: mockId('pv'), version: 1, content: '你是一个耐心的 AI 学习助手。\n\n当前用户基础较弱，请用通俗易懂的语言解释概念，多举例说明。\n\n回答要求：\n1. 先给出核心结论\n2. 用类比帮助理解\n3. 提供可运行的代码示例\n4. 最后给出练习建议' },
    { id: mockId('prompt'), key: 'standard', name: '标准档', description: '适合中级学习者', activeVersionId: mockId('pv'), version: 2, content: '你是一个专业的 AI 学习助手。\n\n当前用户有一定基础，请在回答中兼顾深度和广度。\n\n回答要求：\n1. 先概述要点\n2. 深入分析核心机制\n3. 提供最佳实践\n4. 指出常见陷阱' },
    { id: mockId('prompt'), key: 'advanced', name: '进阶档', description: '适合高级学习者', activeVersionId: mockId('pv'), version: 1, content: '你是一个资深技术导师。\n\n当前用户基础扎实，请直接深入技术细节。\n\n回答要求：\n1. 从源码层面分析\n2. 对比不同实现方案\n3. 讨论性能影响\n4. 给出架构层面的建议' }
  ];
}

/* ------------------------------------------------------------------ */
/*  FACTORY: LayeredPlanResult                                         */
/* ------------------------------------------------------------------ */
export function createLayeredPlanResult(scenario: MockScenario): LayeredPlanResult {
  return {
    goal: createLearningGoal(scenario),
    roadmap: createRoadmapStages(),
    shortPlan: createShortPlanDays(),
    guide: createDailyGuide(scenario)
  };
}
