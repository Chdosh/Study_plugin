import {
  answerStepQuestionAgentOutputSchema,
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  roadmapAgentOutputSchema,
  reviewAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema,
  teachStepAgentOutputSchema
} from '../../shared/schemas';
import type { AppSettings, GoalBrief, GoalIntakeMessage, KnowledgeItem, LearningGoal, PromptProfile, RoadmapStage, ShortPlanDay, StudyWindow } from '../../shared/types';
import { AiClient, type AiCallMetrics } from './ai-client';
import {
  buildAnswerStepQuestionPrompt,
  buildDailyGuidePrompt,
  buildEvaluateSubmissionPrompt,
  buildGoalIntakePrompt,
  buildRoadmapPrompt,
  buildReviewPrompt,
  buildRollingPlanPrompt,
  buildShortPlanPrompt,
  buildTeachStepPrompt
} from './agent-prompts';

export interface AgentRuntimeSettings extends AppSettings {
  deepseekApiKey: string | null;
}

export interface AgentRunExtras {
  traceId?: string;
  onMetrics?: (metrics: AiCallMetrics) => void;
}

export class ReflectionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { date: string; snapshot: unknown; context?: unknown; profile: PromptProfile; settings: AgentRuntimeSettings } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: reviewAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 reflection-agent。只返回合法 JSON。',
      user: buildReviewPrompt({
        date: params.date,
        snapshot: params.snapshot,
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class GoalIntakeAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { messages: GoalIntakeMessage[]; context?: unknown; profile: PromptProfile; settings: AgentRuntimeSettings } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: goalIntakeAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 goal-intake-agent。只返回合法 JSON。',
      user: buildGoalIntakePrompt({
        messages: params.messages,
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class RoadmapAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { goal: LearningGoal; brief: GoalBrief | null; context?: unknown; profile: PromptProfile; settings: AgentRuntimeSettings } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: roadmapAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 generate-roadmap-agent。只返回合法 JSON。',
      user: buildRoadmapPrompt({
        goal: params.goal,
        brief: params.brief,
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class ShortPlanAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    roadmap: RoadmapStage[];
    context?: unknown;
    profile: PromptProfile;
    settings: AgentRuntimeSettings;
  } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: shortPlanAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 generate-short-plan-agent。只返回合法 JSON。',
      user: buildShortPlanPrompt({
        goal: params.goal,
        brief: params.brief,
        roadmap: params.roadmap,
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }

  runRolling(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    activeStage: RoadmapStage;
    completedSummary: string;
    reviewSummary?: string;
    profile: PromptProfile;
    settings: AgentRuntimeSettings;
    knowledgeItems?: KnowledgeItem[];
    reviewKnowledgeItems?: KnowledgeItem[];
    context?: unknown;
  } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: shortPlanAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 rolling-plan-agent。只返回合法 JSON。',
      user: buildRollingPlanPrompt({
        goal: params.goal,
        brief: params.brief,
        activeStage: params.activeStage,
        completedSummary: params.completedSummary,
        reviewSummary: params.reviewSummary,
        profile: params.profile,
        knowledgeItems: params.knowledgeItems,
        reviewKnowledgeItems: params.reviewKnowledgeItems,
        context: params.context
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class DailyGuideAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: {
    date: string;
    windows: StudyWindow[];
    goal: LearningGoal;
    brief: GoalBrief | null;
    roadmap: RoadmapStage[];
    targetDay: ShortPlanDay;
    previousDayResult?: {
      completedTasks: string[];
      evaluationSummary: string;
      reviewSummary?: string;
    };
    profile: PromptProfile;
    settings: AgentRuntimeSettings;
    knowledgeItems?: KnowledgeItem[];
    reviewKnowledgeItems?: KnowledgeItem[];
    context?: unknown;
  } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: dailyGuideAgentOutputSchema,
      timeoutMs: 120_000,
      system: '你是本地优先 AI 学习管家的 generate-daily-guide-agent。只返回合法 JSON。',
      user: buildDailyGuidePrompt({
        date: params.date,
        windows: params.windows,
        blockMinutes: params.settings.defaultBlockMinutes,
        goal: params.goal,
        brief: params.brief,
        roadmap: params.roadmap,
        targetDay: params.targetDay,
        previousDayResult: params.previousDayResult,
        profile: params.profile,
        knowledgeItems: params.knowledgeItems,
        reviewKnowledgeItems: params.reviewKnowledgeItems,
        context: params.context
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class TeachStepAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: teachStepAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 tutoring-service。只返回合法 JSON。',
      user: buildTeachStepPrompt({
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class StepQuestionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { question: string; context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: answerStepQuestionAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 question-branch tutor。只返回合法 JSON。',
      user: buildAnswerStepQuestionPrompt({
        question: params.question,
        context: params.context,
        profile: params.profile
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}

export class SubmissionEvaluationAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { submission: string; context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings; knowledgeItems?: KnowledgeItem[]; reviewKnowledgeItems?: KnowledgeItem[] } & AgentRunExtras) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: submissionEvaluationAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 evaluation-service。只返回合法 JSON。',
      user: buildEvaluateSubmissionPrompt({
        submission: params.submission,
        context: params.context,
        profile: params.profile,
        knowledgeItems: params.knowledgeItems,
        reviewKnowledgeItems: params.reviewKnowledgeItems
      }),
      traceId: params.traceId,
      onMetrics: params.onMetrics
    });
  }
}


