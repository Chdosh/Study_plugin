import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  status: text('status', { enum: ['draft', 'confirmed', 'archived'] }).notNull().default('draft'),
  availableWindowsJson: text('available_windows_json').notNull(),
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

export const studySessions = sqliteTable('study_sessions', {
  id: text('id').primaryKey(),
  blockId: text('block_id').references(() => dailyPlanBlocks.id),
  taskId: text('task_id').references(() => taskItems.id),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMinutes: integer('duration_minutes'),
  status: text('status', { enum: ['active', 'paused', 'completed', 'skipped'] })
    .notNull()
    .default('active'),
  focusScore: integer('focus_score'),
  notes: text('notes')
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
  kind: text('kind', { enum: ['import', 'plan', 'evaluation', 'replan', 'reflection'] }).notNull(),
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

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull()
});
