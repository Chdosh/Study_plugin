import type { AiCallMetrics } from '../ai/ai-client';
import type { PendingAgentInteraction } from '../../shared/types';
export type { PendingAgentInteraction } from '../../shared/types';

export type AgentToolName =
  | 'propose_goal'
  | 'propose_roadmap'
  | 'propose_short_plan'
  | 'prepare_learning_guide'
  | 'reflect'
  | 'explain'
  | 'quiz'
  | 'practice'
  | 'evaluate'
  | 'search_kb'
  | 'ask_user';

export type AgentContextKind =
  | 'goal_intake'
  | 'planning'
  | 'study'
  | 'evaluation'
  | 'review'
  | 'knowledge';

export type AgentRunStatus =
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentContext {
  kind: AgentContextKind;
  scopeType: string;
  scopeId: string;
  goalId?: string;
  messageRefId?: string;
  contextVersion: number;
}

export interface AskUserRequest {
  question: string;
  reason: string;
  answerMode: 'free_text' | 'single_choice';
  options?: string[];
  canSkip: boolean;
  intent: string;
}

export interface AgentToolExecution<TOutput = unknown> {
  output: TOutput;
  metrics?: AiCallMetrics;
  requestUser?: AskUserRequest;
}

export interface AgentToolDefinition<TInput = unknown, TOutput = unknown> {
  name: AgentToolName;
  description: string;
  contexts: AgentContextKind[];
  execute: (input: TInput, context: AgentContext) => Promise<AgentToolExecution<TOutput>>;
}

export interface AgentRunAudit {
  kind: string;
  date?: string;
  provider: string;
  model: string;
  promptProfileId?: string;
  promptVersionId?: string | null;
  inputSnapshot: unknown;
  outputSchemaVersion: string;
  idempotencyKey?: string;
}

export interface AgentLoopResult<TOutput> {
  runReviewId: string;
  status: 'completed' | 'waiting_user';
  output: TOutput;
  pendingInteraction?: PendingAgentInteraction;
}

export interface SaveAiReviewInput {
  kind: string;
  date?: string;
  provider: string;
  model: string;
  promptProfileId?: string;
  promptVersionId?: string | null;
  inputSnapshot: unknown;
  output: unknown;
  outputSchemaVersion: string;
  status: 'success' | AgentRunStatus;
  errorMessage?: string;
  metrics?: AiCallMetrics;
  recordType?: 'legacy_call' | 'run' | 'tool_call';
  parentReviewId?: string;
  toolName?: AgentToolName;
  toolSequence?: number;
  idempotencyKey?: string;
  goalId?: string;
  conversationScope?: string;
  conversationRefId?: string;
  messageRefId?: string;
  contextVersion?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface UpdateAiReviewInput {
  status?: AgentRunStatus;
  output?: unknown;
  errorMessage?: string | null;
  metrics?: AiCallMetrics;
  completedAt?: string | null;
}

export interface CreatePendingInteractionInput {
  runReviewId: string;
  toolReviewId: string;
  scopeType: string;
  scopeId: string;
  request: AskUserRequest;
  expectedContextVersion: number;
}

export interface AgentLoopPersistencePort {
  saveAiReview(params: SaveAiReviewInput): Promise<string>;
  updateAiReview(id: string, patch: UpdateAiReviewInput): Promise<void>;
  getActiveAgentRun(scopeType: string, scopeId: string): Promise<{ id: string; status: AgentRunStatus } | null>;
  getNextAgentToolSequence(runReviewId: string): Promise<number>;
  createPendingInteraction(params: CreatePendingInteractionInput): Promise<PendingAgentInteraction>;
  getPendingInteraction(id: string): Promise<PendingAgentInteraction | null>;
  getOpenPendingInteraction(scopeType: string, scopeId: string): Promise<PendingAgentInteraction | null>;
  answerPendingInteraction(
    id: string,
    answer: string,
    answerMessageRefId?: string
  ): Promise<boolean>;
  skipPendingInteraction(id: string, answerMessageRefId?: string): Promise<boolean>;
  cancelPendingInteraction(id: string): Promise<boolean>;
  failInterruptedAgentRuns(): Promise<number>;
}
