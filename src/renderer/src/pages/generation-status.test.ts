import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_REQUEST_TIMEOUT_MS } from '../../../shared/ai-request';
import { OverviewPage, pendingGenerationLabel } from './OverviewPage';
import { SettingsPage } from './SettingsPage';

describe('AI generation status presentation', () => {
  it('pendingGenerationLabel distinguishes short wait, slow generation and near-timeout', () => {
    const nearTimeout = Math.floor(DEFAULT_AI_REQUEST_TIMEOUT_MS / 1000 * 2 / 3);
    expect(pendingGenerationLabel(false, 0)).toBe('AI 正在生成回答');
    expect(pendingGenerationLabel(false, 29)).toBe('AI 正在生成回答');
    expect(pendingGenerationLabel(false, 30)).toContain('已等待 30 秒');
    expect(pendingGenerationLabel(false, 30)).toContain('仍在生成');
    expect(pendingGenerationLabel(false, nearTimeout - 1)).toContain('已等待');
    expect(pendingGenerationLabel(false, nearTimeout)).toContain('AI 响应较慢');
    expect(pendingGenerationLabel(false, nearTimeout)).toContain('超时后会自动提示失败原因');
    expect(pendingGenerationLabel(true, 0)).toContain('约需 1 分钟');
    expect(pendingGenerationLabel(true, 0, '正在规划长期学习大纲')).toContain('正在规划长期学习大纲');
    expect(pendingGenerationLabel(true, 0, '正在规划长期学习大纲')).toContain('约需 1 分钟');
    expect(pendingGenerationLabel(true, 65, '正在展开今天的学习任务')).toContain('已等待 65 秒');
    expect(pendingGenerationLabel(true, 65)).toContain('接近完成');
  });

  it('shows the persisted generation failure instead of a generic retry message', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: null,
      todayGuide: {
        goal: { id: 'goal-1', title: '测试目标' },
        roadmap: [],
        shortPlan: [],
        guide: {
          id: 'guide-1',
          nearTermPlanItemId: null,
          sessionStatus: 'draft',
          tasks: []
        },
        currentStage: null,
        goalProgress: { status: 'on_schedule' },
        preparationState: 'generation_failed',
        errorMessage: '模型地址返回 503'
      },
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('模型地址返回 503');
    expect(html).toContain('已有目标和近期计划均已保留');
  });

  it('distinguishes a saved key from the latest provider result', () => {
    const html = renderToStaticMarkup(createElement(SettingsPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true,
        aiProviderStatus: {
          state: 'failed',
          checkedAt: '2026-07-26T12:00:00.000Z',
          model: 'example-model',
          errorCategory: 'ai_failure',
          message: '模型地址不可访问'
        },
        autoLaunch: false,
        defaultBlockMinutes: 10,
        dailyStudyWindows: [],
        learningStyle: 'detailed'
      },
      runAction: async () => undefined,
      onSaved: async () => undefined
    }));

    expect(html).toContain('已配置');
    expect(html).toContain('最近失败');
    expect(html).toContain('模型地址不可访问');
  });

  it('shows one clear pending state while the goal intake request is running', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'ready',
          goalId: 'goal-1',
          brief: {
            title: '掌握 Git',
            targetOutcome: '完成一次团队协作',
            currentLevel: '基础',
            availableTime: '一小时',
            deadline: ''
          },
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [],
        activeGoal: {
          id: 'goal-1',
          title: '掌握 Git'
        }
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: true,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('AI 正在生成回答');
    expect(html).not.toContain('AI 正在生成完整学习计划');
    expect(html).not.toContain('使用当前信息生成完整计划</button>');
    expect(html).not.toContain('继续生成完整计划</button>');
    expect(html).not.toContain('生成完整学习计划</button>');
  });

  it('shows the plan-generating banner once the Goal is ready and the plan pipeline runs', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'ready',
          goalId: null,
          brief: {
            title: '掌握 Git',
            targetOutcome: '完成一次团队协作',
            currentLevel: '基础',
            availableTime: '一小时',
            deadline: '一个月'
          },
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [],
        activeGoal: null
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: false,
      planGenerating: true,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('正在生成完整学习计划');
    expect(html).not.toContain('AI 正在生成回答');
  });

  it('single_choice 追问渲染选项按钮，点击选项即以选项文本作答', () => {
    const answers: string[] = [];
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'collecting',
          goalId: null,
          brief: null,
          createdAt: '2026-08-04T08:00:00.000Z',
          updatedAt: '2026-08-04T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [{ id: 'm1', intakeId: 'intake-1', role: 'assistant', content: '你想以哪种方式学习？', createdAt: '2026-08-04T08:00:00.000Z' }],
        activeGoal: null,
        pendingInteraction: {
          id: 'p1',
          runReviewId: 'r1',
          toolReviewId: 't1',
          scopeType: 'goal_intake',
          scopeId: 'intake-1',
          question: '你想以哪种方式学习？',
          reason: '继续目标澄清需要用户补充关键信息。',
          answerMode: 'single_choice',
          options: ['从零系统学', '快速了解架构', '专项深入'],
          canSkip: true,
          intent: 'continue_goal_intake',
          expectedContextVersion: 2,
          status: 'open',
          answerText: null,
          answerMessageRefId: null,
          createdAt: '2026-08-04T08:00:00.000Z',
          resolvedAt: null
        }
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async (content: string) => { answers.push(content); },
      onboardingOperationPending: false,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('从零系统学');
    expect(html).toContain('快速了解架构');
    expect(html).toContain('专项深入');
    expect(html).toContain('option-action');
  });

  it('多问题表单：collecting 且带 questions 时渲染全部问题与提交按钮', () => {
    const sent: string[] = [];
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'collecting',
          goalId: null,
          brief: null,
          questions: [
            { prompt: '你想以哪种方式学习？', options: ['从零系统学', '快速了解架构', '专项深入'] },
            { prompt: '每天可以投入多少时间？', options: ['1-2 小时', '3-4 小时', '5 小时以上'] }
          ],
          createdAt: '2026-08-04T08:00:00.000Z',
          updatedAt: '2026-08-04T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [{ id: 'm1', intakeId: 'intake-1', role: 'assistant', content: '请回答以下问题。', createdAt: '2026-08-04T08:00:00.000Z' }],
        activeGoal: null,
        pendingInteraction: null
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async (content: string) => { sent.push(content); },
      onboardingOperationPending: false,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('你想以哪种方式学习？');
    expect(html).toContain('每天可以投入多少时间？');
    expect(html).toContain('提交回答');
    expect(html).toContain('已回答 0 / 2 个问题');
  });

  it('ready 摘要卡显示学习方向与确认按钮', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'ready',
          goalId: null,
          brief: {
            title: '了解 RAG 与 LangChain 架构',
            targetOutcome: '能说清整体架构',
            currentLevel: '几乎无编程基础',
            availableTime: '每天两小时',
            deadline: '未明确',
            depth: '快速了解架构',
            direction: '先概览 AI 技术生态，再深入核心原理。',
            constraints: [],
            successCriteria: ['能讲清原理']
          },
          questions: [],
          createdAt: '2026-08-04T08:00:00.000Z',
          updatedAt: '2026-08-04T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [],
        activeGoal: null,
        pendingInteraction: null
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: false,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('学习方向');
    expect(html).toContain('先概览 AI 技术生态，再深入核心原理。');
    expect(html).toContain('确认并生成计划');
    expect(html).toContain('快速了解架构');
  });

  it('Goal 已确认但无 Guide 时，访谈历史仍然可读、可继续补充', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'confirmed',
          goalId: 'goal-1',
          brief: { title: '掌握 Git', targetOutcome: '完成一次团队协作', currentLevel: '基础', availableTime: '一小时', deadline: '一个月' },
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: '2026-07-28T08:01:00.000Z'
        },
        messages: [
          { id: 'm1', role: 'user', content: '我想系统学习 TypeScript', createdAt: '2026-07-28T08:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: '目标已经清楚，可以生成学习路径。', createdAt: '2026-07-28T08:00:30.000Z' }
        ],
        activeGoal: { id: 'goal-1', title: '掌握 Git' }
      },
      todayGuide: {
        goal: { id: 'goal-1', title: '掌握 Git' },
        roadmap: [],
        shortPlan: [],
        guide: null,
        currentStage: null,
        goalProgress: { status: 'on_schedule' },
        preparationState: 'generation_failed',
        errorMessage: '生成执行稿失败'
      },
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: false,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('目标访谈');
    expect(html).toContain('访谈记录已收纳');
    expect(html).toContain('查看历史对话');
  });

  it('有计划时概览页展示学习路径总览：阶段卡片、进度、近期计划项', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'confirmed',
          goalId: 'goal-1',
          brief: {
            title: '掌握 TypeScript',
            targetOutcome: '完成一个项目',
            currentLevel: '基础',
            availableTime: '每天两小时',
            deadline: '两个月',
            depth: '从零系统学',
            direction: '先补类型基础，再进入项目实战。',
            constraints: [],
            successCriteria: []
          },
          questions: [],
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: '2026-07-28T08:01:00.000Z'
        },
        messages: [],
        activeGoal: { id: 'goal-1', title: '掌握 TypeScript' }
      },
      todayGuide: {
        goal: { id: 'goal-1', title: '掌握 TypeScript' },
        roadmap: [
          {
            id: 'stage-1', goalId: 'goal-1', title: '打好基础', objective: '掌握核心类型系统',
            direction: '小练习建立类型思维', successCriteria: '能为常见函数建模', targetDate: '2026-08-15',
            status: 'completed', position: 0, createdAt: '', updatedAt: ''
          },
          {
            id: 'stage-2', goalId: 'goal-1', title: '完成项目', objective: '综合运用 TypeScript',
            direction: '完成可运行项目', successCriteria: '项目通过类型检查', targetDate: '2026-09-24',
            status: 'active', position: 1, createdAt: '', updatedAt: ''
          }
        ],
        shortPlan: [
          {
            id: 'item-1', goalId: 'goal-1', roadmapStageId: 'stage-2', itemIndex: 2, date: null,
            sessionStatus: 'active', title: '类型基础实践', focus: '用类型约束实现功能',
            tasks: [], expectedOutput: '可运行函数', successCriteria: '类型检查通过', createdAt: ''
          }
        ],
        guide: {
          id: 'guide-1', nearTermPlanItemId: 'item-1', sessionStatus: 'active', tasks: []
        },
        currentStage: { id: 'stage-2', title: '完成项目' },
        goalProgress: { status: 'on_schedule', dueDate: '2026-09-24', currentStageTargetDate: '2026-09-24', currentStageTitle: '完成项目' },
        preparationState: 'active',
        errorMessage: null
      },
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: false,
      planGenerating: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('学习路径');
    expect(html).toContain('先补类型基础，再进入项目实战。');
    expect(html).toContain('1 / 2 阶段已完成');
    expect(html).toContain('进度正常');
    expect(html).toContain('类型基础实践');
  });

  it('does not render the obsolete goal summary or rolling-plan action before a roadmap exists', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'ready',
          goalId: 'goal-1',
          brief: {
            title: '掌握 Git',
            targetOutcome: '完成一次团队协作',
            currentLevel: '基础',
            availableTime: '一小时',
            deadline: ''
          },
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: null
        },
        messages: [],
        activeGoal: { id: 'goal-1', title: '掌握 Git' }
      },
      todayGuide: {
        goal: { id: 'goal-1', title: '掌握 Git' },
        roadmap: [],
        shortPlan: [],
        guide: null,
        currentStage: null,
        goalProgress: { status: 'on_schedule' },
        preparationState: 'plan_exhausted',
        errorMessage: null
      },
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onboardingOperationPending: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).not.toContain('目标理解摘要');
    expect(html).not.toContain('生成下一批任务');
  });

  it('shows a direct plan generation action after a Goal is confirmed but no Guide exists', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: {
        intake: {
          id: 'intake-1',
          status: 'ready',
          goalId: 'goal-1',
          brief: {
            title: '掌握 Git',
            targetOutcome: '满足工作和面试需求',
            currentLevel: '用过但不熟悉',
            availableTime: '一小时',
            deadline: ''
          },
          createdAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
          confirmedAt: '2026-07-28T08:01:00.000Z'
        },
        messages: [],
        activeGoal: { id: 'goal-1', title: '掌握 Git' }
      },
      todayGuide: null,
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onGenerateInitialPlan: async () => undefined,
      onboardingOperationPending: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onGenerateRollingPlan: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('确认并生成计划');
    expect(html).not.toContain('使用当前信息生成完整计划</button>');
    expect(html).not.toContain('生成完整学习计划</button>');
  });

  it('keeps an active Goal visible and offers the current learning unit when no Guide exists', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage, {
      settings: {
        aiBaseUrl: 'https://example.invalid/v1',
        aiModel: 'example-model',
        hasAiApiKey: true
      },
      onboarding: null,
      todayGuide: {
        goal: { id: 'goal-1', title: '一天掌握 Git 核心操作' },
        roadmap: [{ id: 'stage-1', title: 'Git 基础与工作流', status: 'active' }],
        shortPlan: [{ id: 'plan-1', title: '仓库初始化与基础操作', focus: '建立完整 Git 操作链路', sessionStatus: 'active' }],
        guide: null,
        currentStage: null,
        goalProgress: { status: 'on_schedule' },
        preparationState: 'ready_to_generate'
      },
      activeSession: null,
      learningState: null,
      runAction: async () => undefined,
      onSendOnboarding: async () => undefined,
      onGenerateInitialPlan: async () => undefined,
      onboardingOperationPending: false,
      temporaryLearning: null,
      onAskTemporaryQuestion: async () => undefined,
      onLinkTemporaryQuestionToGoal: async () => undefined,
      onKeepTemporaryQuestion: async () => undefined,
      onConvertTemporaryQuestionToTask: async () => undefined,
      availableGoals: [],
      onCancelPendingQuestion: async () => undefined,
      onConfirmGuide: async () => undefined,
      onArchiveTodayAndRestart: async () => undefined,
      onPrepareCurrentLearningDay: async () => undefined,
      knowledgeItems: []
    } as never));

    expect(html).toContain('一天掌握 Git 核心操作');
    expect(html).toContain('生成当前学习单元');
    expect(html).toContain('当前学习');
    expect(html).toContain('学习路径');
    expect(html).toContain('Git 基础与工作流');
    expect(html).toContain('仓库初始化与基础操作');
    expect(html).not.toContain('intake-workspace');
    expect(html).not.toContain('你准备学习什么');
  });
});
