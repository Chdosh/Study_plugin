import {
  dailyPlanAgentOutputSchema,
  importAgentOutputSchema,
  reviewAgentOutputSchema
} from '../../shared/schemas';
import type { AppSettings, PromptProfile, StudyWindow, TaskItem } from '../../shared/types';
import { AiClient } from './ai-client';
import { buildImportPrompt, buildPlanPrompt, buildReviewPrompt } from './agent-prompts';

export interface AgentRuntimeSettings extends AppSettings {
  deepseekApiKey: string | null;
}

export class ImportAgent {
  constructor(private readonly ai: AiClient) {}

  run(rawText: string, profile: PromptProfile, settings: AgentRuntimeSettings) {
    return this.ai.generateJson({
      apiKey: settings.deepseekApiKey,
      baseUrl: settings.deepseekBaseUrl,
      model: settings.deepseekModel,
      schema: importAgentOutputSchema,
      system: 'You are import-agent for a local-first AI study supervisor.',
      user: buildImportPrompt(rawText, profile)
    });
  }
}

export class PlannerAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: {
    date: string;
    windows: StudyWindow[];
    tasks: TaskItem[];
    profile: PromptProfile;
    settings: AgentRuntimeSettings;
  }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: dailyPlanAgentOutputSchema,
      system: 'You are planner-agent for a local-first AI study supervisor.',
      user: buildPlanPrompt({
        date: params.date,
        windows: params.windows,
        tasks: params.tasks,
        profile: params.profile,
        blockMinutes: params.settings.defaultBlockMinutes
      })
    });
  }
}

export class ReflectionAgent {
  constructor(private readonly ai: AiClient) {}

  run(params: { date: string; snapshot: unknown; profile: PromptProfile; settings: AgentRuntimeSettings }) {
    return this.ai.generateJson({
      apiKey: params.settings.deepseekApiKey,
      baseUrl: params.settings.deepseekBaseUrl,
      model: params.settings.deepseekModel,
      schema: reviewAgentOutputSchema,
      system: 'You are reflection-agent for a local-first AI study supervisor.',
      user: buildReviewPrompt({
        date: params.date,
        snapshot: params.snapshot,
        profile: params.profile
      })
    });
  }
}
