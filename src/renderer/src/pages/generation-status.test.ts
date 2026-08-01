import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { SettingsPage } from './SettingsPage';

describe('AI generation status presentation', () => {
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

    expect(html).toContain('AI 正在生成完整学习计划');
    expect(html).not.toContain('使用当前信息生成完整计划</button>');
    expect(html).not.toContain('继续生成完整计划</button>');
    expect(html).not.toContain('生成完整学习计划</button>');
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

    expect(html).toContain('生成完整学习计划</button>');
    expect(html).not.toContain('使用当前信息生成完整计划</button>');
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
