import type { Id, LearningTurnArtifact } from '../../../shared/types';
import { CategorizedError } from '../../ai/categorized-error';
import type { AgentLoop } from '../../agent/agent-loop';
import { AGENT_SYSTEM_PROMPT, systemPromptFor } from '../../agent/agent-system-prompt';
import type {
  AgentContext,
  AgentLoopResult,
  AgentRunAudit,
  AgentToolName,
  AgentTurnInput,
  PendingAgentInteraction
} from '../../agent/agent-types';
import type { SettingsService } from '../../services/settings-service';
import type { StudyStore } from '../../services/store';
import type { LearnerContextModule } from '../context/context';

export type LearningTurnIntent =
  | 'continue_teaching'
  | 'answer_question'
  | 'check_understanding'
  | 'generate_practice'
  | 'evaluate_response';

export interface StartLearningTurnInput {
  intent: LearningTurnIntent;
  promptProfileId?: Id;
  userInput?: string;
  messageRefId?: string;
  idempotencyKey?: string;
}

export interface LearningTurnResult<TArtifact = unknown> {
  runId: string;
  status: 'completed' | 'waiting_user';
  artifacts: TArtifact[];
  contextSourceIds: string[];
  effects: Array<{ type: string; refId?: string }>;
  refresh: Array<'learning' | 'conversation' | 'history'>;
  pendingInteraction?: PendingAgentInteraction;
}

export interface ResumeLearningTurnInput extends StartLearningTurnInput {
  pendingInteractionId: string;
  answer: string;
  expectedContextVersion: number;
  answerMessageRefId?: string;
  resolution?: 'answered' | 'skipped';
}

interface PreparedLearningTurn {
  turn: AgentTurnInput;
  contextSourceIds: string[];
  taskId?: string;
}

export class LearningTurnModule {
  constructor(
    private readonly store: StudyStore,
    private readonly settings: SettingsService,
    private readonly contextModule: LearnerContextModule,
    private readonly loop: AgentLoop
  ) {}

  async start(input: StartLearningTurnInput): Promise<LearningTurnResult<LearningTurnArtifact>> {
    const prepared = await this.prepare(input);
    const run = await this.loop.runTurn<LearningTurnArtifact>(prepared.turn);
    await this.recordProcessEvidence(run, prepared);
    return this.toResult(run, prepared.contextSourceIds);
  }

  startTool<TInput, TOutput>(params: {
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }) {
    return this.loop.runTurn<TOutput>(this.buildConfiguredTurn(params));
  }

  resumeTool<TInput, TOutput>(params: {
    pendingInteractionId: string;
    answer: string;
    expectedContextVersion: number;
    resolution?: 'answered' | 'skipped';
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }) {
    return this.loop.resumeTurn<TOutput>({
      pendingInteractionId: params.pendingInteractionId,
      answer: params.answer,
      expectedContextVersion: params.expectedContextVersion,
      resolution: params.resolution,
      turn: this.buildConfiguredTurn(params)
    });
  }

  async resume(input: ResumeLearningTurnInput): Promise<LearningTurnResult<LearningTurnArtifact>> {
    const prepared = await this.prepare(input);
    const run = await this.loop.resumeTurn<LearningTurnArtifact>({
      pendingInteractionId: input.pendingInteractionId,
      answer: input.answer,
      answerMessageRefId: input.answerMessageRefId,
      expectedContextVersion: input.expectedContextVersion,
      resolution: input.resolution,
      turn: prepared.turn
    });
    await this.recordProcessEvidence(run, prepared);
    return this.toResult(run, prepared.contextSourceIds);
  }

  retry(input: StartLearningTurnInput & { failedRunId: string }): Promise<LearningTurnResult<LearningTurnArtifact>> {
    return this.start({
      ...input,
      idempotencyKey: input.idempotencyKey ?? `retry:${input.failedRunId}`
    });
  }

  cancel(pendingInteractionId: string): Promise<boolean> {
    return this.loop.cancelPendingInteraction(pendingInteractionId);
  }

  getOpenInteraction(scopeType: string, scopeId: string) {
    return this.loop.getOpenInteraction(scopeType, scopeId);
  }

  private async prepare(input: StartLearningTurnInput): Promise<PreparedLearningTurn> {
    const learningStyleValue = await this.store.getSetting('learningStyle');
    const learningStyle = learningStyleValue === 'concise'
      || learningStyleValue === 'detailed'
      || learningStyleValue === 'code_first'
      ? learningStyleValue
      : 'detailed';
    const [built, profile, runtimeSettings, current] = await Promise.all([
      this.contextModule.build('teach_step', { learningStyle }),
      this.store.getPromptProfile(input.promptProfileId),
      this.settings.getRuntimeSettings(),
      this.store.getCurrentLearningContext()
    ]);
    const action = built.snapshot.dailyGuideAction;
    if (!action) {
      throw new CategorizedError(
        'validation_error',
        '当前没有可展开的学习步骤。请先进入一个可执行的学习任务。'
      );
    }

    const allowedTools = toolsForIntent(input.intent);
    return {
      turn: {
        intent: input.intent,
        userInput: input.userInput,
        boundedContext: built.context,
        context: {
          kind: 'study',
          scopeType: 'learning_action',
          scopeId: action.id,
          goalId: built.snapshot.goal?.id,
          messageRefId: input.messageRefId,
          contextVersion: current.version
        },
        audit: {
          kind: 'learning_turn',
          provider: 'configured_ai',
          model: runtimeSettings.aiModel,
          promptProfileId: profile.id,
          promptVersionId: profile.activeVersionId,
          inputSnapshot: {
            intent: input.intent,
            contextSourceIds: built.contextSourceIds
          },
          outputSchemaVersion: 'learning-turn.teaching.v1',
          idempotencyKey: input.idempotencyKey
        },
        modelConfig: {
          apiKey: runtimeSettings.aiApiKey,
          baseUrl: runtimeSettings.aiBaseUrl,
          model: runtimeSettings.aiModel,
          temperature: 0.7,
          system: [
            systemPromptFor('主线内主动教学'),
            profile.content,
            '程序负责推进业务状态；你只能选择已挂载工具。',
            '若可信上下文含 knowledgePriorities，优先处理第一项：把它和当前 Action 关联起来，选择讲解、练习或理解检查；用户纠正优先于冲突的 AI 判断。它是教学重点，不是阻止用户继续的硬门槛。',
            '除非缺少继续教学所必需的信息，否则不要询问用户；不要为了流程完整性而提问。',
            '选择小测是为了收集用户的回答：quiz 后选择 ask_user 让用户在同一个 Learning Turn 中作答，回答后选择 evaluate 给出即时反馈；若不需要用户作答，就不要触发小测。'
          ].join('\n'),
          traceId: `ta_${crypto.randomUUID()}`
        },
        allowedTools
      },
      contextSourceIds: built.contextSourceIds,
      taskId: built.snapshot.dailyGuideTask?.id
    };
  }

  private async recordProcessEvidence(
    run: AgentLoopResult<unknown>,
    prepared: PreparedLearningTurn
  ): Promise<void> {
    if (run.status !== 'completed' || !prepared.turn.context.goalId) return;
    const evaluation = [...run.toolResults].reverse().find((item) =>
      item.toolName === 'evaluate'
      && isConversationEvaluation(item.output)
    );
    if (!evaluation || !isConversationEvaluation(evaluation.output)) return;
    await this.contextModule.processConversationEvaluation({
      goalId: prepared.turn.context.goalId,
      taskId: prepared.taskId,
      sourceId: evaluation.toolReviewId ?? run.runReviewId,
      correctParts: evaluation.output.correctParts,
      misconceptions: evaluation.output.misconceptions
    });
  }

  private buildConfiguredTurn<TInput>(params: {
    toolName: AgentToolName;
    input: TInput;
    context: AgentContext;
    audit: AgentRunAudit;
  }): AgentTurnInput {
    const input = params.input && typeof params.input === 'object'
      ? params.input as Record<string, unknown>
      : {};
    const settings = input.settings as {
      aiApiKey: string | null;
      aiBaseUrl: string;
      aiModel: string;
    } | undefined;
    const profile = input.profile as { content?: string } | undefined;
    if (!settings) {
      throw new CategorizedError('missing_config', 'Agent Turn 缺少模型运行配置。');
    }
    const {
      settings: _settings,
      profile: _profile,
      traceId,
      ...boundedContext
    } = input;
    return {
      intent: params.audit.kind,
      boundedContext,
      context: params.context,
      audit: params.audit,
      modelConfig: {
        apiKey: settings.aiApiKey,
        baseUrl: settings.aiBaseUrl,
        model: settings.aiModel,
        temperature: teachingToolNames.has(params.toolName) ? 0.7 : 0.2,
        system: [
          AGENT_SYSTEM_PROMPT,
          profile?.content ?? '',
          operationInstruction(params.toolName)
        ].filter(Boolean).join('\n'),
        traceId: typeof traceId === 'string' ? traceId : `ta_${crypto.randomUUID()}`
      },
      allowedTools: [params.toolName]
    };
  }

  private toResult(
    run: Awaited<ReturnType<AgentLoop['runTurn']>>,
    contextSourceIds: string[]
  ): LearningTurnResult<LearningTurnArtifact> {
    return {
      runId: run.runReviewId,
      status: run.status,
      artifacts: run.toolResults
        .map((item) => normalizeArtifact(item.output))
        .filter(hasVisibleArtifact),
      contextSourceIds,
      effects: [],
      refresh: ['learning', 'history'],
      pendingInteraction: run.pendingInteraction
    };
  }
}

function hasVisibleArtifact(artifact: LearningTurnArtifact): boolean {
  return Boolean(artifact.explanation.trim() || artifact.userAction.trim());
}

function isConversationEvaluation(value: unknown): value is {
  mode: 'conversation_response';
  correctParts: string[];
  misconceptions: string[];
} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.mode === 'conversation_response'
    && Array.isArray(record.correctParts)
    && record.correctParts.every((item) => typeof item === 'string')
    && Array.isArray(record.misconceptions)
    && record.misconceptions.every((item) => typeof item === 'string');
}

function operationInstruction(toolName: AgentToolName): string {
  switch (toolName) {
    case 'propose_goal':
      return '根据访谈事实形成目标简报；信息不足时选择 ask_user，不要编造约束。';
    case 'propose_roadmap':
      return '根据已确认目标生成少量分层 Roadmap 提案；有截止日期时为各阶段设置有序检查点日期，不生成每日计划，不直接改变正式计划。';
    case 'propose_short_plan':
      return '生成近期粗粒度安排，保持阶段顺序，不直接应用计划。';
    case 'prepare_learning_guide':
      return '把近期安排展开成当前可执行的 Guide、Task 和 Action 草稿。';
    case 'reflect':
      return '只根据当前 Learning Guide 下已保存的 Task、Action、Session、Submission、Evaluation 和问题记录生成简短复盘。不得按连续天数、打卡频率或前台窗口推断投入和专注；缺少证据时明确说未知，不编造统计。';
    case 'explain':
      return '回答用户当前问题，并明确如何返回原 Action 主线。';
    case 'evaluate':
      return '评价已持久化的提交，给出证据、误区、方向和建议，不直接推进 Task。';
    default:
      return '完成当前明确意图，只选择已挂载工具。';
  }
}

function normalizeArtifact(output: unknown): LearningTurnArtifact {
  const value = output && typeof output === 'object'
    ? output as Record<string, unknown>
    : {};
  if (typeof value.question === 'string') {
    return {
      kind: 'question',
      explanation: value.question,
      userAction: '回答这个问题后，导师会在同一轮学习中继续。',
      requiresSubmission: false
    };
  }
  if (Array.isArray(value.questions)) {
    const questions = value.questions
      .map((item, index) => {
        if (!item || typeof item !== 'object') return '';
        const question = item as Record<string, unknown>;
        const prompt = typeof question.prompt === 'string' ? question.prompt : '';
        const answerFormat = typeof question.answerFormat === 'string'
          ? `（${question.answerFormat}）`
          : '';
        return prompt ? `${index + 1}. ${prompt}${answerFormat}` : '';
      })
      .filter(Boolean);
    return {
      kind: 'quiz',
      explanation: [stringValue(value.explanation), ...questions].filter(Boolean).join('\n'),
      userAction: stringValue(value.userAction),
      requiresSubmission: value.requiresSubmission === true
    };
  }
  if (typeof value.exercise === 'string') {
    return {
      kind: 'practice',
      explanation: [
        stringValue(value.explanation),
        value.exercise,
        typeof value.successCriteria === 'string' ? `完成标准：${value.successCriteria}` : ''
      ].filter(Boolean).join('\n\n'),
      userAction: stringValue(value.userAction),
      requiresSubmission: value.requiresSubmission === true
    };
  }
  if (typeof value.feedback === 'string') {
    const misconceptions = Array.isArray(value.misconceptions)
      ? value.misconceptions.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      kind: 'evaluation',
      explanation: [
        value.feedback,
        misconceptions.length > 0 ? `需要纠正：${misconceptions.join('；')}` : ''
      ].filter(Boolean).join('\n'),
      userAction: stringValue(value.nextPrompt),
      requiresSubmission: value.requiresSubmission === true
    };
  }
  return {
    kind: 'explanation',
    explanation: [
      stringValue(value.explanation),
      ...(Array.isArray(value.keyPoints)
        ? value.keyPoints
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((point, index) => `${index + 1}. ${point}`)
        : []),
      stringValue(value.example) ? `例子：${stringValue(value.example)}` : '',
      stringValue(value.commonMistake) ? `常见误区：${stringValue(value.commonMistake)}` : '',
      stringValue(value.checkQuestion) ? `思考一下：${stringValue(value.checkQuestion)}` : ''
    ].filter(Boolean).join('\n\n'),
    userAction: stringValue(value.userAction),
    requiresSubmission: value.requiresSubmission === true
  };
}

const teachingToolNames: ReadonlySet<string> = new Set([
  'propose_goal',
  'explain',
  'quiz',
  'practice'
]);

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toolsForIntent(intent: LearningTurnIntent): AgentTurnInput['allowedTools'] {
  switch (intent) {
    case 'check_understanding':
      return ['search_kb', 'quiz', 'ask_user', 'evaluate'];
    case 'generate_practice':
      return [
        'search_kb',
        'practice',
        'insert_guide_supplement',
        'quiz',
        'ask_user',
        'evaluate'
      ];
    case 'evaluate_response':
      return ['evaluate', 'explain', 'ask_user'];
    case 'answer_question':
      return ['search_kb', 'explain', 'ask_user'];
    case 'continue_teaching':
      return [
        'search_kb',
        'explain',
        'quiz',
        'practice',
        'evaluate',
        'insert_guide_supplement',
        'ask_user'
      ];
  }
}
