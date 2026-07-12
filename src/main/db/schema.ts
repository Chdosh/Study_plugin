import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rawImports = sqliteTable('raw_imports', {
  id: text('id').primaryKey(),
  source: text('source', { enum: ['chatgpt', 'codex', 'manual'] }).notNull(),
  rawText: text('raw_text').notNull(),
  status: text('status', { enum: ['created', 'parsed', 'failed'] }).notNull().default('created'),
  createdAt: text('created_at').notNull(),
  parsedAt: text('parsed_at')
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  sourceImportId: text('source_import_id').references(() => rawImports.id),
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
  intakeId: text('intake_id')
    .notNull()
    .references(() => goalIntakes.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull()
});

export const roadmapStages = sqliteTable('roadmap_stages', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  direction: text('direction').notNull(),
  successCriteria: text('success_criteria').notNull(),
  status: text('status', { enum: ['pending', 'active', 'ready_for_review', 'completed', 'blocked', 'adjusted'] }).notNull().default('pending'),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const shortPlanDays = sqliteTable('short_plan_days', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  roadmapStageId: text('roadmap_stage_id').references(() => roadmapStages.id),
  dayIndex: integer('day_index').notNull(),
  date: text('date'),
  sessionStatus: text('session_status', { enum: ['pending', 'active', 'completed', 'skipped'] }).notNull().default('pending'),
  title: text('title').notNull(),
  focus: text('focus').notNull(),
  tasksJson: text('tasks_json').notNull(),
  expectedOutput: text('expected_output').notNull(),
  successCriteria: text('success_criteria').notNull(),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
});

export const taskItems = sqliteTable('task_items', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  sourceImportId: text('source_import_id').references(() => rawImports.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['backlog', 'planned', 'in_progress', 'done', 'skipped']
  })
    .notNull()
    .default('backlog'),
  priority: integer('priority').notNull().default(3),
  difficulty: text('difficulty', { enum: ['foundation', 'standard', 'advanced', 'exam'] })
    .notNull()
    .default('foundation'),
  estimateMinutes: integer('estimate_minutes').notNull().default(30),
  acceptanceCriteria: text('acceptance_criteria'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const planStages = sqliteTable('plan_stages', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  prerequisites: text('prerequisites'),
  successCriteria: text('success_criteria').notNull(),
  status: text('status', { enum: ['proposed', 'confirmed', 'active', 'completed', 'skipped'] })
    .notNull()
    .default('proposed'),
  position: integer('position').notNull(),
  summary: text('summary'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => taskItems.id),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    uniqueDependency: uniqueIndex('task_dependencies_unique').on(table.taskId, table.dependsOnTaskId)
  })
);

export const dailyPlans = sqliteTable('daily_plans', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  status: text('status', { enum: ['draft', 'confirmed', 'completed', 'archived'] }).notNull().default('draft'),
  availableWindowsJson: text('available_windows_json').notNull(),
  shortPlanDayId: text('short_plan_day_id').references(() => shortPlanDays.id),
  createdAt: text('created_at').notNull(),
  confirmedAt: text('confirmed_at'),
  sourceReviewId: text('source_review_id'),
  version: integer('version').notNull().default(1)
});

export const dailyPlanBlocks = sqliteTable('daily_plan_blocks', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => dailyPlans.id),
  taskId: text('task_id').references(() => taskItems.id),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  objective: text('objective').notNull(),
  action: text('action').notNull(),
  expectedOutput: text('expected_output').notNull(),
  difficulty: text('difficulty').notNull(),
  material: text('material').notNull(),
  successCheck: text('success_check').notNull(),
  fallback: text('fallback').notNull(),
  status: text('status', { enum: ['planned', 'active', 'done', 'skipped', 'deferred'] })
    .notNull()
    .default('planned'),
  position: integer('position').notNull()
});

export const dailyGuides = sqliteTable('daily_guides', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  planId: text('plan_id')
    .notNull()
    .references(() => dailyPlans.id),
  shortPlanDayId: text('short_plan_day_id').references(() => shortPlanDays.id),
  date: text('date').notNull(),
  status: text('status', { enum: ['draft', 'confirmed', 'completed', 'archived'] }).notNull().default('draft'),
  sessionStatus: text('session_status', { enum: ['draft', 'active', 'closed'] }).notNull().default('active'),
  weekFocus: text('week_focus').notNull().default(''),
  todayGoal: text('today_goal').notNull(),
  deliverablesJson: text('deliverables_json').notNull(),
  boundariesJson: text('boundaries_json').notNull(),
  acceptanceCriteriaJson: text('acceptance_criteria_json').notNull(),
  tomorrowActionsJson: text('tomorrow_actions_json').notNull(),
  createdAt: text('created_at').notNull(),
  confirmedAt: text('confirmed_at')
});

export const dailyGuideBlocks = sqliteTable('daily_guide_blocks', {
  id: text('id').primaryKey(),
  guideId: text('guide_id')
    .notNull()
    .references(() => dailyGuides.id),
  planBlockId: text('plan_block_id')
    .notNull()
    .references(() => dailyPlanBlocks.id),
  title: text('title').notNull(),
  position: integer('position').notNull()
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

export const dailyGuideTasks = sqliteTable('daily_guide_tasks', {
  id: text('id').primaryKey(),
  guideId: text('guide_id')
    .notNull()
    .references(() => dailyGuides.id),
  roadmapStageId: text('roadmap_stage_id').references(() => roadmapStages.id),
  legacyPlanBlockId: text('legacy_plan_block_id').references(() => dailyPlanBlocks.id),
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
  submissionPolicy: text('submission_policy', { enum: ['once_after_task'] }).notNull().default('once_after_task'),
  carryoverAllowed: integer('carryover_allowed', { mode: 'boolean' }).notNull().default(true),
  status: text('status', { enum: ['planned', 'active', 'done', 'skipped', 'deferred'] })
    .notNull()
    .default('planned'),
  progressPercent: integer('progress_percent').notNull().default(0),
  currentActionId: text('current_action_id'),
  nextStartPoint: text('next_start_point'),
  totalElapsedMinutes: integer('total_elapsed_minutes').notNull().default(0),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const dailyGuideActions = sqliteTable('daily_guide_actions', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => dailyGuideTasks.id),
  title: text('title').notNull(),
  instruction: text('instruction').notNull(),
  checkpoint: text('checkpoint').notNull(),
  status: text('status', { enum: ['planned', 'done', 'skipped'] }).notNull().default('planned'),
  progressNote: text('progress_note'),
  completedAt: text('completed_at'),
  position: integer('position').notNull()
});

export const studySessions = sqliteTable('study_sessions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => dailyGuideTasks.id),
  taskItemsId: text('task_items_id').references(() => taskItems.id),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMinutes: integer('duration_minutes'),
  status: text('status', { enum: ['active', 'paused', 'completed', 'skipped'] })
    .notNull()
    .default('active'),
  focusScore: integer('focus_score'),
  notes: text('notes')
});

export const learningSteps = sqliteTable('learning_steps', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  stageId: text('stage_id').references(() => planStages.id),
  taskId: text('task_id').references(() => taskItems.id),
  blockId: text('block_id').references(() => dailyPlanBlocks.id),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  instruction: text('instruction').notNull(),
  expectedOutput: text('expected_output').notNull(),
  successCriteria: text('success_criteria').notNull(),
  status: text('status', {
    enum: ['planned', 'active', 'waiting_for_submission', 'completed', 'needs_revision', 'skipped']
  })
    .notNull()
    .default('active'),
  attempt: integer('attempt').notNull().default(1),
  position: integer('position').notNull().default(0),
  summary: text('summary'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const learningRuntimeStates = sqliteTable('learning_runtime_states', {
  id: text('id').primaryKey(),
  activeGoalId: text('active_goal_id').references(() => goals.id),
  activeStageId: text('active_stage_id').references(() => roadmapStages.id),
  activeDailyTaskId: text('active_daily_task_id').references(() => dailyGuideTasks.id),
  activeStepId: text('active_step_id').references(() => dailyGuideActions.id),
  activeQuestionThreadId: text('active_question_thread_id'),
  sessionStatus: text('session_status', { enum: ['idle', 'active', 'paused', 'completed'] })
    .notNull()
    .default('idle'),
  updatedAt: text('updated_at').notNull()
});

export const questionThreads = sqliteTable('question_threads', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  stageId: text('stage_id').references(() => planStages.id),
  taskId: text('task_id').references(() => taskItems.id),
  stepId: text('step_id').references(() => learningSteps.id),
  dailyGuideActionId: text('daily_guide_action_id').references(() => dailyGuideActions.id),
  status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
  kind: text('kind', { enum: ['question', 'debug', 'practice'] }).notNull().default('question'),
  metadata: text('metadata'),
  question: text('question').notNull(),
  resolutionSummary: text('resolution_summary'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  resolvedAt: text('resolved_at')
});

export const questionMessages = sqliteTable('question_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => questionThreads.id),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull()
});

export const learningSubmissions = sqliteTable('learning_submissions', {
  id: text('id').primaryKey(),
  stepId: text('step_id').references(() => learningSteps.id),
  dailyGuideActionId: text('daily_guide_action_id').references(() => dailyGuideActions.id),
  sessionId: text('session_id').references(() => studySessions.id),
  content: text('content').notNull(),
  evaluationStatus: text('evaluation_status', {
    enum: ['waiting', 'evaluating', 'completed', 'failed']
  }).notNull().default('completed'),
  applicationStatus: text('application_status', {
    enum: ['pending', 'applied', 'failed']
  }).notNull().default('applied'),
  applicationError: text('application_error'),
  appliedAt: text('applied_at'),
  createdAt: text('created_at').notNull()
});

export const learningEvaluations = sqliteTable('learning_evaluations', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id')
    .notNull()
    .references(() => learningSubmissions.id),
  stepId: text('step_id').references(() => learningSteps.id),
  dailyGuideActionId: text('daily_guide_action_id').references(() => dailyGuideActions.id),
  result: text('result', { enum: ['passed', 'partial', 'failed', 'unclear'] }).notNull(),
  mastery: integer('mastery').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  correctPartsJson: text('correct_parts_json').notNull(),
  misconceptionsJson: text('misconceptions_json').notNull(),
  missingRequirementsJson: text('missing_requirements_json').notNull(),
  feedback: text('feedback').notNull(),
  recommendedAction: text('recommended_action', {
    enum: ['advance', 'explain_again', 'remediate', 'practice', 'simplify', 'complete_task', 'request_user_decision']
  }).notNull(),
  decision: text('decision', { enum: ['advance', 'stay', 'remediate', 'replan'] }).notNull().default('stay'),
  aiReviewId: text('ai_review_id'),
  createdAt: text('created_at').notNull()
});

export const learnerFacts = sqliteTable('learner_facts', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  taskId: text('task_id').references(() => dailyGuideTasks.id),
  scope: text('scope', { enum: ['task', 'goal', 'global'] }).notNull().default('goal'),
  key: text('key').notNull(),
  value: text('value').notNull(),
  source: text('source', { enum: ['user_stated', 'inferred', 'confirmed'] }).notNull(),
  confidence: real('confidence').notNull().default(0.8),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const knowledgeItemEvidence = sqliteTable(
  'knowledge_item_evidence',
  {
    id: text('id').primaryKey(),
    knowledgeItemId: text('knowledge_item_id')
      .notNull()
      .references(() => knowledgeItems.id),
    sourceType: text('source_type', { enum: ['misconception', 'weakness', 'insight', 'correction'] }).notNull(),
    sourceId: text('source_id'),
    submissionId: text('submission_id').references(() => learningSubmissions.id),
    evaluationId: text('evaluation_id').references(() => learningEvaluations.id),
    taskId: text('task_id').references(() => dailyGuideTasks.id),
    createdAt: text('created_at').notNull()
  },
  (table) => ({
    uniqueEvaluationEvidence: uniqueIndex('knowledge_item_evidence_evaluation_unique')
      .on(table.knowledgeItemId, table.evaluationId)
  })
);

export const nextStepDecisions = sqliteTable('next_step_decisions', {
  id: text('id').primaryKey(),
  evaluationId: text('evaluation_id')
    .notNull()
    .references(() => learningEvaluations.id),
  stepId: text('step_id').references(() => learningSteps.id),
  decision: text('decision', {
    enum: ['advance', 'explain_again', 'remediate', 'practice', 'simplify', 'complete_task', 'request_user_decision']
  }).notNull(),
  reason: text('reason').notNull(),
  taskCompleted: integer('task_completed', { mode: 'boolean' }).notNull().default(false),
  nextStepJson: text('next_step_json'),
  remediationJson: text('remediation_json'),
  carryForward: text('carry_forward'),
  aiReviewId: text('ai_review_id'),
  createdAt: text('created_at').notNull()
});

export const planAdjustmentProposals = sqliteTable('plan_adjustment_proposals', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').references(() => goals.id),
  stageId: text('stage_id').references(() => planStages.id),
  taskId: text('task_id').references(() => taskItems.id),
  sourceDecisionId: text('source_decision_id').references(() => nextStepDecisions.id),
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
  reason: text('reason').notNull(),
  proposedChangesJson: text('proposed_changes_json').notNull(),
  appliedTaskId: text('applied_task_id').references(() => taskItems.id),
  createdAt: text('created_at').notNull(),
  decidedAt: text('decided_at'),
  appliedAt: text('applied_at')
});

export const learningSummaries = sqliteTable('learning_summaries', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['question', 'step', 'task', 'day', 'stage'] }).notNull(),
  refId: text('ref_id').notNull(),
  status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('ready'),
  summaryJson: text('summary_json').notNull(),
  createdAt: text('created_at').notNull()
});

export const focusEvents = sqliteTable('focus_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => studySessions.id),
  appName: text('app_name').notNull(),
  windowTitle: text('window_title'),
  eventType: text('event_type', { enum: ['foreground', 'away', 'return', 'unknown'] }).notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationSeconds: integer('duration_seconds')
});

export const skipLogs = sqliteTable('skip_logs', {
  id: text('id').primaryKey(),
  blockId: text('block_id').references(() => dailyPlanBlocks.id),
  taskId: text('task_id').references(() => taskItems.id),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull()
});

export const aiReviews = sqliteTable('ai_reviews', {
  id: text('id').primaryKey(),
  kind: text('kind', {
    enum: [
      'import',
      'plan',
      'goal_intake',
      'roadmap',
      'short_plan',
      'daily_guide',
      'stage_outline',
      'teach_step',
      'question',
      'submission_evaluation',
      'next_step',
      'evaluation',
      'replan',
      'reflection',
      'rolling_plan'
    ]
  }).notNull(),
  date: text('date'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptProfileId: text('prompt_profile_id'),
  promptVersionId: text('prompt_version_id'),
  inputSnapshotJson: text('input_snapshot_json').notNull(),
  outputJson: text('output_json').notNull(),
  outputSchemaVersion: text('output_schema_version').notNull(),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  errorCategory: text('error_category', {
    enum: ['user_input_error', 'ai_failure', 'schema_violation', 'db_error', 'missing_config', 'validation_error']
  }),
  traceId: text('trace_id'),
  createdAt: text('created_at').notNull()
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
  profileId: text('profile_id')
    .notNull()
    .references(() => promptProfiles.id),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull()
});

export const planVersions = sqliteTable('plan_versions', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => dailyPlans.id),
  version: integer('version').notNull(),
  changeSummary: text('change_summary').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull()
});

export const generationLocks = sqliteTable('generation_locks', {
  lockKey: text('lock_key').primaryKey(),
  lockedAt: text('locked_at').notNull()
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull()
});
