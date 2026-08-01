import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'done', 'archived'] }).notNull().default('active'),
  priority: integer('priority').notNull().default(3),
  dueDate: text('due_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const goalIntakes = sqliteTable('goal_intakes', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['collecting', 'ready', 'confirmed'] }).notNull().default('collecting'),
  goalId: text('goal_id').references(() => goals.id),
  briefJson: text('brief_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  confirmedAt: text('confirmed_at')
});

export const goalIntakeMessages = sqliteTable('goal_intake_messages', {
  id: text('id').primaryKey(),
  intakeId: text('intake_id').notNull().references(() => goalIntakes.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull()
});

export const roadmapStages = sqliteTable('roadmap_stages', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  direction: text('direction').notNull(),
  successCriteria: text('success_criteria').notNull(),
  targetDate: text('target_date'),
  status: text('status', {
    enum: ['pending', 'active', 'ready_for_review', 'completed', 'blocked', 'adjusted']
  }).notNull().default('pending'),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const nearTermPlanItems = sqliteTable('near_term_plan_items', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id),
  roadmapStageId: text('roadmap_stage_id').references(() => roadmapStages.id),
  itemIndex: integer('item_index').notNull(),
  suggestedDate: text('suggested_date'),
  status: text('status', { enum: ['pending', 'active', 'completed', 'skipped'] }).notNull().default('pending'),
  title: text('title').notNull(),
  focus: text('focus').notNull(),
  tasksJson: text('tasks_json').notNull(),
  expectedOutput: text('expected_output').notNull(),
  successCriteria: text('success_criteria').notNull(),
  createdAt: text('created_at').notNull()
});

export const planVersions = sqliteTable('plan_versions', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id),
  version: integer('version').notNull(),
  changeSummary: text('change_summary').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull()
});

export const learningGuides = sqliteTable('learning_guides', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull().references(() => goals.id),
  nearTermPlanItemId: text('near_term_plan_item_id').references(() => nearTermPlanItems.id),
  suggestedDate: text('suggested_date'),
  status: text('status', { enum: ['draft', 'active', 'closed', 'archived'] }).notNull().default('draft'),
  weekFocus: text('week_focus').notNull().default(''),
  learningGoal: text('learning_goal').notNull(),
  deliverablesJson: text('deliverables_json').notNull(),
  boundariesJson: text('boundaries_json').notNull(),
  acceptanceCriteriaJson: text('acceptance_criteria_json').notNull(),
  nextActionsJson: text('next_actions_json').notNull(),
  createdAt: text('created_at').notNull(),
  confirmedAt: text('confirmed_at')
});

export const learningTasks = sqliteTable('learning_tasks', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  guideId: text('guide_id').references(() => learningGuides.id),
  roadmapStageId: text('roadmap_stage_id').references(() => roadmapStages.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  scope: text('scope').notNull(),
  estimatedMinMinutes: integer('estimated_min_minutes').notNull(),
  estimatedTargetMinutes: integer('estimated_target_minutes').notNull(),
  estimatedMaxMinutes: integer('estimated_max_minutes').notNull(),
  deliverable: text('deliverable').notNull(),
  doneWhenJson: text('done_when_json').notNull(),
  quickHint: text('quick_hint').notNull(),
  evaluationMode: text('evaluation_mode', { enum: ['local', 'ai'] }).notNull().default('ai'),
  difficulty: text('difficulty', { enum: ['foundation', 'standard', 'advanced'] }),
  taskMode: text('task_mode', { enum: ['learning', 'exam'] }).notNull().default('learning'),
  status: text('status', { enum: ['planned', 'active', 'deferred', 'closed'] }).notNull().default('planned'),
  closureKind: text('closure_kind', { enum: ['completed', 'partial', 'abandoned', 'replaced'] }),
  closureReason: text('closure_reason'),
  nextStartPoint: text('next_start_point'),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const learningActions = sqliteTable('learning_actions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => learningTasks.id),
  title: text('title').notNull(),
  instruction: text('instruction').notNull(),
  checkpoint: text('checkpoint').notNull(),
  requirement: text('requirement', { enum: ['required', 'optional'] }).notNull().default('optional'),
  status: text('status', { enum: ['planned', 'done', 'skipped'] }).notNull().default('planned'),
  progressNote: text('progress_note'),
  completedAt: text('completed_at'),
  origin: text('origin', { enum: ['guide_generated', 'agent_supplement'] })
    .notNull()
    .default('guide_generated'),
  sourceAiReviewId: text('source_ai_review_id').references(() => aiReviews.id),
  position: integer('position').notNull()
});

export const focusSessions = sqliteTable(
  'focus_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => learningTasks.id),
    startedAt: text('started_at').notNull(),
    activeSince: text('active_since'),
    endedAt: text('ended_at'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    status: text('status', { enum: ['active', 'paused', 'ended'] }).notNull().default('active'),
    notes: text('notes')
  },
  (table) => ({
    singleUnfinished: uniqueIndex('focus_sessions_single_unfinished')
      .on(sql`(1)`)
      .where(sql`${table.status} IN ('active', 'paused')`)
  })
);

export const currentLearningContext = sqliteTable('current_learning_context', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  guideId: text('guide_id').references(() => learningGuides.id),
  taskId: text('task_id').references(() => learningTasks.id),
  actionId: text('action_id').references(() => learningActions.id),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull()
});

export const conversationThreads = sqliteTable('conversation_threads', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
  kind: text('kind', { enum: ['question', 'debug', 'practice'] }).notNull().default('question'),
  question: text('question').notNull(),
  resolutionSummary: text('resolution_summary'),
  metadata: text('metadata'),
  isPartial: integer('is_partial', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  resolvedAt: text('resolved_at')
});

export const conversationMessages = sqliteTable('conversation_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => conversationThreads.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  linkedGoalId: text('linked_goal_id').references(() => goals.id),
  linkedTaskId: text('linked_task_id').references(() => learningTasks.id),
  linkedActionId: text('linked_action_id').references(() => learningActions.id),
  createdAt: text('created_at').notNull()
});

export const learningSubmissions = sqliteTable('learning_submissions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => learningTasks.id),
  stepId: text('step_id').references(() => learningActions.id),
  goalId: text('goal_id').references(() => goals.id),
  sessionId: text('session_id').references(() => focusSessions.id),
  content: text('content').notNull(),
  evaluationStatus: text('evaluation_status', {
    enum: ['waiting', 'evaluating', 'completed', 'failed']
  }).notNull().default('waiting'),
  evaluationAttemptCount: integer('evaluation_attempt_count').notNull().default(0),
  lastEvaluationError: text('last_evaluation_error'),
  lastEvaluationAt: text('last_evaluation_at'),
  createdAt: text('created_at').notNull()
});

export const aiReviews = sqliteTable('ai_reviews', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  date: text('date'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptProfileId: text('prompt_profile_id'),
  promptVersionId: text('prompt_version_id'),
  inputSnapshotJson: text('input_snapshot_json').notNull(),
  outputJson: text('output_json').notNull(),
  outputSchemaVersion: text('output_schema_version').notNull(),
  status: text('status', {
    enum: ['success', 'running', 'waiting_user', 'completed', 'failed', 'cancelled']
  }).notNull(),
  errorMessage: text('error_message'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  errorCategory: text('error_category', {
    enum: ['user_input_error', 'ai_failure', 'schema_violation', 'db_error', 'missing_config', 'validation_error']
  }),
  traceId: text('trace_id'),
  recordType: text('record_type', { enum: ['legacy_call', 'run', 'tool_call'] }).notNull().default('legacy_call'),
  parentReviewId: text('parent_review_id'),
  toolName: text('tool_name'),
  toolSequence: integer('tool_sequence'),
  idempotencyKey: text('idempotency_key'),
  goalId: text('goal_id').references(() => goals.id),
  conversationScope: text('conversation_scope'),
  conversationRefId: text('conversation_ref_id'),
  messageRefId: text('message_ref_id'),
  contextVersion: integer('context_version'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull()
});

export const learningEvaluations = sqliteTable('learning_evaluations', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['submission', 'goal_review'] }).notNull().default('submission'),
  submissionId: text('submission_id').references(() => learningSubmissions.id),
  goalId: text('goal_id').references(() => goals.id),
  result: text('result', { enum: ['passed', 'partial', 'failed', 'unclear'] }).notNull(),
  evidenceJson: text('evidence_json').notNull(),
  correctPartsJson: text('correct_parts_json').notNull(),
  misconceptionsJson: text('misconceptions_json').notNull(),
  missingRequirementsJson: text('missing_requirements_json').notNull(),
  feedback: text('feedback').notNull(),
  direction: text('direction', { enum: ['advance', 'stay', 'remediate', 'replan'] }).notNull(),
  selfNote: text('self_note'),
  recommendationJson: text('recommendation_json'),
  recommendationDecision: text('recommendation_decision', {
    enum: ['pending', 'accepted', 'declined', 'deferred']
  }),
  recommendationDecisionReason: text('recommendation_decision_reason'),
  applicationStatus: text('application_status', { enum: ['pending', 'applied', 'failed'] }),
  applicationError: text('application_error'),
  appliedAt: text('applied_at'),
  source: text('source', { enum: ['ai', 'user_correction'] }).notNull().default('ai'),
  supersedesEvaluationId: text('supersedes_evaluation_id'),
  correctionReason: text('correction_reason'),
  aiReviewId: text('ai_review_id').references(() => aiReviews.id),
  createdAt: text('created_at').notNull()
});

export const learnerFacts = sqliteTable('learner_facts', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  taskId: text('task_id').references(() => learningTasks.id),
  scope: text('scope', { enum: ['task', 'goal', 'global'] }).notNull().default('goal'),
  key: text('key').notNull(),
  value: text('value').notNull(),
  source: text('source', { enum: ['user_stated', 'inferred', 'confirmed'] }).notNull(),
  confidence: real('confidence').notNull().default(0.8),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const knowledgeItems = sqliteTable('knowledge_items', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  key: text('key').notNull(),
  summary: text('summary').notNull(),
  detail: text('detail'),
  sourceType: text('source_type', { enum: ['misconception', 'weakness', 'insight', 'correction'] }).notNull(),
  sourceId: text('source_id'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  lastSeenAt: text('last_seen_at'),
  status: text('status', { enum: ['active', 'resolved', 'dormant'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const knowledgeItemEvidence = sqliteTable(
  'knowledge_item_evidence',
  {
    id: text('id').primaryKey(),
    knowledgeItemId: text('knowledge_item_id').notNull().references(() => knowledgeItems.id),
    sourceType: text('source_type', { enum: ['misconception', 'weakness', 'insight', 'correction'] }).notNull(),
    sourceId: text('source_id'),
    submissionId: text('submission_id').references(() => learningSubmissions.id),
    evaluationId: text('evaluation_id').references(() => learningEvaluations.id),
    taskId: text('task_id').references(() => learningTasks.id),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    uniqueEvaluationEvidence: uniqueIndex('knowledge_item_evidence_evaluation_unique')
      .on(table.knowledgeItemId, table.evaluationId)
  })
);

export const pendingInteractions = sqliteTable('pending_interactions', {
  id: text('id').primaryKey(),
  runReviewId: text('run_review_id').notNull().references(() => aiReviews.id),
  toolReviewId: text('tool_review_id').notNull().references(() => aiReviews.id),
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id').notNull(),
  question: text('question').notNull(),
  reason: text('reason').notNull(),
  answerMode: text('answer_mode', { enum: ['free_text', 'single_choice'] }).notNull(),
  optionsJson: text('options_json').notNull().default('[]'),
  canSkip: integer('can_skip', { mode: 'boolean' }).notNull().default(false),
  intent: text('intent').notNull(),
  expectedContextVersion: integer('expected_context_version').notNull(),
  status: text('status', { enum: ['open', 'answered', 'skipped', 'cancelled'] }).notNull().default('open'),
  answerText: text('answer_text'),
  answerMessageRefId: text('answer_message_ref_id'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at')
});

export const promptProfiles = sqliteTable('prompt_profiles', {
  id: text('id').primaryKey(),
  key: text('key', { enum: ['foundation', 'standard', 'advanced', 'exam', 'recovery'] }).notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  activeVersionId: text('active_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => promptProfiles.id),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull()
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull()
});
