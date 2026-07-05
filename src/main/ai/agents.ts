import {
  answerStepQuestionAgentOutputSchema,
  dailyGuideAgentOutputSchema,
  goalIntakeAgentOutputSchema,
  nextStepDecisionAgentOutputSchema,
  roadmapAgentOutputSchema,
  reviewAgentOutputSchema,
  shortPlanAgentOutputSchema,
  submissionEvaluationAgentOutputSchema,
  teachStepAgentOutputSchema
} from '../../shared/schemas';
import type { AppSettings, GoalBrief, GoalIntakeMessage, LearningGoal, PromptProfile, RoadmapStage, ShortPlanDay, StudyWindow } from '../../shared/types';
import { AiClient } from './ai-client';
import {
  buildAnswerStepQuestionPrompt,
  buildDailyGuidePrompt,
  buildDecideNextStepPrompt,
  buildEvaluateSubmissionPrompt,
  buildGoalIntakePrompt,
  buildRoadmapPrompt,
  buildReviewPrompt,
  buildShortPlanPrompt,
  buildTeachStepPrompt
} from './agent-prompts';

export interface AgentRuntimeSettings extends AppSettings {
  deepseekApiKey: string | null;
}

export class ReflectionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { date: string; snapshot: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: reviewAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 reflection-agent。只返回合法 JSON。',
      user: buildReviewPrompt({
        date: params.date,
        snapshot: params.snapshot,
        profile: params.profile
      })
    });
  }
}

export class GoalIntakeAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { messages: GoalIntakeMessage[]; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: goalIntakeAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 goal-intake-agent。只返回合法 JSON。',
      user: buildGoalIntakePrompt({
        messages: params.messages,
        profile: params.profile
      })
    });
  }
}

export class RoadmapAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { goal: LearningGoal; brief: GoalBrief | null; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: roadmapAgentOutputSchema,
      system: '你是本地优先 AI 学习管家的 generate-roadmap-agent。只返回合法 JSON。',
      user: buildRoadmapPrompt({
        goal: params.goal,
        brief: params.brief,
        profile: params.profile
      })
    });
  }
}

export class ShortPlanAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: {
    goal: LearningGoal;
    brief: GoalBrief | null;
    roadmap: RoadmapStage[];
    profile: PromptProfile;
    settings: AgentRuntimeSettings;
  }) {
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
        profile: params.profile
      })
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
  }) {
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
        profile: params.profile
      })
    });
  }
}

export class TeachStepAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: teachStepAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 tutoring-service。只返回合法 JSON。',
      user: buildTeachStepPrompt({
        context: params.context,
        profile: params.profile
      })
    });
  }
}

export class StepQuestionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { question: string; context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
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
      })
    });
  }
}

export class SubmissionEvaluationAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { submission: string; context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: submissionEvaluationAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 evaluation-service。只返回合法 JSON。',
      user: buildEvaluateSubmissionPrompt({
        submission: params.submission,
        context: params.context,
        profile: params.profile
      })
    });
  }
}

export class NextStepDecisionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { evaluation: unknown; context: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: nextStepDecisionAgentOutputSchema,
      system: '你是渐进式 AI 学习导师的 progression-service。只返回合法 JSON。',
      user: buildDecideNextStepPrompt({
        evaluation: params.evaluation,
        context: params.context,
        profile: params.profile
      })
    });
  }
}
