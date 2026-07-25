import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import {
  bootstrapDatabase,
  REQUIRED_V2_INDEXES,
  REQUIRED_V2_TABLES,
  V2_SCHEMA_VERSION
} from '../main/db/bootstrap';

const MIGRATOR_VERSION = 'v1-to-v2.1';

export interface V1ToV2UpgradeResult {
  status: 'not_needed' | 'completed';
  v2Path: string;
  archivePath?: string;
  reportPath?: string;
}

export async function ensureV2Database(userDataPath: string): Promise<V1ToV2UpgradeResult> {
  const root = resolve(userDataPath);
  const v1Path = join(root, 'study-supervisor.db');
  const v2Path = join(root, 'study-supervisor-v2.db');
  if (existsSync(v2Path)) {
    return { status: 'not_needed', v2Path };
  }
  if (!existsSync(v1Path) || !(await isV1Database(v1Path))) {
    return { status: 'not_needed', v2Path };
  }
  return upgradeV1ToV2({ v1Path, v2Path });
}

export async function upgradeV1ToV2(params: {
  v1Path: string;
  v2Path: string;
}): Promise<V1ToV2UpgradeResult> {
  const v1Path = resolve(params.v1Path);
  const v2Path = resolve(params.v2Path);
  const targetDir = dirname(v2Path);
  if (dirname(v1Path) !== targetDir) {
    throw new Error('V1 and V2 databases must be in the same application data directory.');
  }
  if (basename(v2Path) !== 'study-supervisor-v2.db') {
    throw new Error('Unexpected V2 database filename.');
  }
  if (existsSync(v2Path)) {
    return { status: 'not_needed', v2Path };
  }

  const archivePath = join(targetDir, 'study-supervisor-v1-archive.db');
  const buildingPath = join(targetDir, 'study-supervisor-v2.building.db');
  const readyPath = join(targetDir, 'study-supervisor-v2.ready.db');
  const reportPath = join(targetDir, 'study-supervisor-v2-migration-report.json');

  await createConsistentArchive(v1Path, archivePath);
  const sourceSha256 = sha256File(archivePath);
  const upgradeId = createHash('sha256')
    .update(`${MIGRATOR_VERSION}:${sourceSha256}`)
    .digest('hex');

  if (existsSync(buildingPath)) {
    const resolvedBuilding = resolve(buildingPath);
    if (dirname(resolvedBuilding) !== targetDir || basename(resolvedBuilding) !== 'study-supervisor-v2.building.db') {
      throw new Error('Refusing to replace an unexpected building database path.');
    }
    rmSync(resolvedBuilding);
  }
  if (existsSync(readyPath)) {
    rmSync(readyPath);
  }

  const target = createClient({ url: `file:${buildingPath}` });
  let report: Record<string, unknown>;
  try {
    await bootstrapDatabase(target);
    await copyWhitelistedData(target, archivePath);
    const validation = await validateBuildingDatabase(target);
    report = {
      migratorVersion: MIGRATOR_VERSION,
      schemaVersion: V2_SCHEMA_VERSION,
      upgradeId,
      sourceArchive: basename(archivePath),
      sourceSha256,
      completedAt: new Date().toISOString(),
      validation,
      notes: [
        'V1 remains a permanent read-only archive.',
        'AI reviews, pending interactions, focus events and unfinished proposal processes were not migrated.',
        'Ambiguous or unsupported rows remain only in V1.'
      ]
    };
    await target.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    await target.execute('PRAGMA journal_mode=DELETE');
  } finally {
    target.close();
  }
  try {
    await renameWithRetry(buildingPath, v2Path);
  } catch {
    // libSQL can retain the validated file handle on Windows until process exit.
    // Copy the checkpointed database to an unopened ready file, then atomically
    // rename that file. Runtime still only sees the final V2 filename.
    copyFileSync(buildingPath, readyPath);
    renameSync(readyPath, v2Path);
    try {
      rmSync(buildingPath);
    } catch {
      // The isolated upgrader can remove this stale building file on its next run.
    }
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { status: 'completed', v2Path, archivePath, reportPath };
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
}

export function restoreV1Archive(params: {
  archivePath: string;
  restorePath: string;
}): void {
  const archivePath = resolve(params.archivePath);
  const restorePath = resolve(params.restorePath);
  if (dirname(archivePath) !== dirname(restorePath)) {
    throw new Error('Archive and restore target must be in the same application data directory.');
  }
  if (basename(archivePath) !== 'study-supervisor-v1-archive.db') {
    throw new Error('Unexpected V1 archive filename.');
  }
  if (basename(restorePath) !== 'study-supervisor.db') {
    throw new Error('Unexpected V1 restore filename.');
  }
  copyFileSync(archivePath, restorePath);
}

async function isV1Database(path: string): Promise<boolean> {
  const client = createClient({ url: `file:${path}` });
  try {
    const result = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'daily_guide_tasks'
      LIMIT 1
    `);
    return result.rows.length === 1;
  } finally {
    client.close();
  }
}

async function createConsistentArchive(v1Path: string, archivePath: string): Promise<void> {
  if (existsSync(archivePath)) return;
  const source = createClient({ url: `file:${v1Path}` });
  try {
    await source.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    await source.execute(`VACUUM INTO ${quoteSqlLiteral(archivePath)}`);
  } finally {
    source.close();
  }
}

async function copyWhitelistedData(target: Client, archivePath: string): Promise<void> {
  await target.execute(`ATTACH DATABASE ${quoteSqlLiteral(archivePath)} AS v1`);
  try {
    await target.executeMultiple(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;

      INSERT INTO goals (
        id, title, description, status, priority, due_date, created_at, updated_at
      )
      SELECT
        id, title, description, status, priority, due_date, created_at, updated_at
      FROM v1.goals;

      INSERT INTO goal_intakes (
        id, status, goal_id, brief_json, created_at, updated_at, confirmed_at
      )
      SELECT
        id, status,
        CASE WHEN goal_id IN (SELECT id FROM goals) THEN goal_id ELSE NULL END,
        brief_json, created_at, updated_at, confirmed_at
      FROM v1.goal_intakes;

      INSERT INTO goal_intake_messages (
        id, intake_id, role, content, created_at
      )
      SELECT m.id, m.intake_id, m.role, m.content, m.created_at
      FROM v1.goal_intake_messages m
      JOIN goal_intakes i ON i.id = m.intake_id
      WHERE trim(m.content) <> '';

      INSERT INTO roadmap_stages (
        id, goal_id, title, objective, direction, success_criteria,
        status, position, created_at, updated_at
      )
      SELECT
        r.id, r.goal_id, r.title, r.objective, r.direction, r.success_criteria,
        r.status, r.position, r.created_at, r.updated_at
      FROM v1.roadmap_stages r
      JOIN goals g ON g.id = r.goal_id;

      INSERT INTO near_term_plan_items (
        id, goal_id, roadmap_stage_id, item_index, suggested_date, status,
        title, focus, tasks_json, expected_output, success_criteria, created_at
      )
      SELECT
        s.id, s.goal_id,
        CASE WHEN s.roadmap_stage_id IN (SELECT id FROM roadmap_stages)
          THEN s.roadmap_stage_id ELSE NULL END,
        s.day_index, s.date,
        CASE s.session_status
          WHEN 'active' THEN 'active'
          WHEN 'completed' THEN 'completed'
          WHEN 'skipped' THEN 'skipped'
          ELSE 'pending'
        END,
        s.title, s.focus, s.tasks_json, s.expected_output, s.success_criteria,
        s.created_at
      FROM v1.short_plan_days s
      JOIN goals g ON g.id = s.goal_id;

      INSERT INTO plan_versions (
        id, goal_id, version, change_summary, snapshot_json, created_at
      )
      SELECT pv.id, mapped.goal_id, pv.version, pv.change_summary, pv.snapshot_json, pv.created_at
      FROM v1.plan_versions pv
      JOIN (
        SELECT dp.id AS plan_id, MIN(dg.goal_id) AS goal_id
        FROM v1.daily_plans dp
        JOIN v1.daily_guides dg ON dg.plan_id = dp.id
        GROUP BY dp.id
        HAVING COUNT(DISTINCT dg.goal_id) = 1
      ) mapped ON mapped.plan_id = pv.plan_id
      JOIN goals g ON g.id = mapped.goal_id;

      INSERT INTO learning_guides (
        id, goal_id, near_term_plan_item_id, suggested_date, status,
        week_focus, learning_goal, deliverables_json, boundaries_json,
        acceptance_criteria_json, next_actions_json, created_at, confirmed_at
      )
      SELECT
        d.id, d.goal_id,
        CASE WHEN d.short_plan_day_id IN (SELECT id FROM near_term_plan_items)
          THEN d.short_plan_day_id ELSE NULL END,
        d.date,
        CASE
          WHEN d.status = 'archived' THEN 'archived'
          WHEN d.status = 'draft' THEN 'draft'
          WHEN d.status = 'completed' OR d.session_status = 'closed' THEN 'closed'
          ELSE 'active'
        END,
        d.week_focus, d.today_goal, d.deliverables_json, d.boundaries_json,
        d.acceptance_criteria_json, d.tomorrow_actions_json,
        d.created_at, d.confirmed_at
      FROM v1.daily_guides d
      JOIN goals g ON g.id = d.goal_id;

      INSERT INTO learning_tasks (
        id, goal_id, guide_id, roadmap_stage_id, title, objective, scope,
        estimated_min_minutes, estimated_target_minutes, estimated_max_minutes,
        deliverable, done_when_json, quick_hint, evaluation_mode,
        difficulty, task_mode, status, closure_kind, next_start_point,
        position, created_at, updated_at
      )
      SELECT
        t.id, g.goal_id, t.guide_id,
        CASE WHEN t.roadmap_stage_id IN (SELECT id FROM roadmap_stages)
          THEN t.roadmap_stage_id ELSE NULL END,
        t.title, t.objective, t.scope,
        t.estimated_min_minutes, t.estimated_target_minutes, t.estimated_max_minutes,
        t.deliverable, t.done_when_json, t.quick_hint, t.evaluation_mode,
        NULL, 'learning',
        CASE t.status
          WHEN 'done' THEN 'closed'
          WHEN 'skipped' THEN 'closed'
          WHEN 'deferred' THEN 'deferred'
          WHEN 'active' THEN 'active'
          ELSE 'planned'
        END,
        CASE t.status
          WHEN 'done' THEN 'completed'
          WHEN 'skipped' THEN 'abandoned'
          ELSE NULL
        END,
        t.next_start_point, t.position, t.created_at, t.updated_at
      FROM v1.daily_guide_tasks t
      JOIN learning_guides g ON g.id = t.guide_id;

      INSERT INTO learning_tasks (
        id, goal_id, guide_id, roadmap_stage_id, title, objective, scope,
        estimated_min_minutes, estimated_target_minutes, estimated_max_minutes,
        deliverable, done_when_json, quick_hint, evaluation_mode,
        difficulty, task_mode, status, closure_kind, next_start_point,
        position, created_at, updated_at
      )
      SELECT
        t.id,
        CASE WHEN t.goal_id IN (SELECT id FROM goals) THEN t.goal_id ELSE NULL END,
        NULL, NULL, t.title, COALESCE(t.description, t.title), COALESCE(t.description, ''),
        t.estimate_minutes, t.estimate_minutes, t.estimate_minutes,
        COALESCE(t.acceptance_criteria, t.title),
        json_array(COALESCE(t.acceptance_criteria, t.title)),
        '', 'ai',
        CASE WHEN t.difficulty IN ('foundation','standard','advanced')
          THEN t.difficulty ELSE NULL END,
        CASE WHEN t.difficulty = 'exam' THEN 'exam' ELSE 'learning' END,
        CASE t.status
          WHEN 'in_progress' THEN 'active'
          WHEN 'done' THEN 'closed'
          WHEN 'skipped' THEN 'closed'
          ELSE 'planned'
        END,
        CASE t.status
          WHEN 'done' THEN 'completed'
          WHEN 'skipped' THEN 'abandoned'
          ELSE NULL
        END,
        NULL, 0, t.created_at, t.updated_at
      FROM v1.task_items t
      WHERE t.id NOT IN (SELECT id FROM learning_tasks);

      INSERT INTO learning_actions (
        id, task_id, title, instruction, checkpoint, requirement,
        status, progress_note, completed_at, position
      )
      SELECT
        a.id, a.task_id, a.title, a.instruction, a.checkpoint, 'optional',
        a.status, a.progress_note, a.completed_at, a.position
      FROM v1.daily_guide_actions a
      JOIN learning_tasks t ON t.id = a.task_id;

      INSERT INTO focus_sessions (
        id, task_id, started_at, active_since, ended_at, duration_seconds, status, notes
      )
      SELECT
        s.id,
        COALESCE(
          CASE WHEN s.task_id IN (SELECT id FROM learning_tasks) THEN s.task_id END,
          CASE WHEN s.task_items_id IN (SELECT id FROM learning_tasks) THEN s.task_items_id END
        ),
        s.started_at,
        NULL,
        COALESCE(s.ended_at, s.started_at),
        MAX(0, CAST(ROUND(COALESCE(s.duration_minutes, 0) * 60) AS INTEGER)),
        'ended',
        s.notes
      FROM v1.study_sessions s
      WHERE s.status IN ('completed','skipped');

      INSERT INTO focus_sessions (
        id, task_id, started_at, active_since, ended_at, duration_seconds, status, notes
      )
      SELECT
        s.id,
        COALESCE(
          CASE WHEN s.task_id IN (SELECT id FROM learning_tasks) THEN s.task_id END,
          CASE WHEN s.task_items_id IN (SELECT id FROM learning_tasks) THEN s.task_items_id END
        ),
        s.started_at, NULL, NULL,
        MAX(0, CAST(ROUND(COALESCE(s.duration_minutes, 0) * 60) AS INTEGER)),
        'paused',
        COALESCE(s.notes, '从 V1 恢复，请确认本次 Session 时长后再继续。')
      FROM v1.study_sessions s
      WHERE s.status IN ('active','paused')
        AND (SELECT COUNT(*) FROM v1.study_sessions WHERE status IN ('active','paused')) = 1;

      INSERT INTO current_learning_context (
        id, goal_id, guide_id, task_id, action_id, version, updated_at
      )
      SELECT
        'default',
        CASE WHEN r.active_goal_id IN (SELECT id FROM goals) THEN r.active_goal_id ELSE NULL END,
        (
          SELECT t.guide_id FROM learning_tasks t
          WHERE t.id = r.active_daily_task_id
        ),
        CASE WHEN r.active_daily_task_id IN (SELECT id FROM learning_tasks)
          THEN r.active_daily_task_id ELSE NULL END,
        CASE
          WHEN r.active_step_id IN (SELECT id FROM learning_actions)
           AND (SELECT task_id FROM learning_actions WHERE id = r.active_step_id) = r.active_daily_task_id
          THEN r.active_step_id
          ELSE NULL
        END,
        1, r.updated_at
      FROM v1.learning_runtime_states r
      ORDER BY r.updated_at DESC
      LIMIT 1;

      INSERT INTO conversation_threads (
        id, status, kind, question, resolution_summary, metadata,
        is_partial, created_at, updated_at, resolved_at
      )
      SELECT
        q.id,
        CASE WHEN q.status = 'resolved' THEN 'resolved' ELSE 'open' END,
        CASE WHEN q.kind IN ('question','debug','practice') THEN q.kind ELSE 'question' END,
        q.question, q.resolution_summary, q.metadata,
        CASE WHEN EXISTS (
          SELECT 1 FROM v1.question_messages omitted
          WHERE omitted.thread_id = q.id
            AND (trim(omitted.content) = '' OR omitted.role NOT IN ('user','assistant'))
        ) THEN 1 ELSE 0 END,
        q.created_at, q.updated_at, q.resolved_at
      FROM v1.question_threads q
      WHERE EXISTS (
        SELECT 1 FROM v1.question_messages m
        WHERE m.thread_id = q.id
          AND trim(m.content) <> ''
          AND m.role IN ('user','assistant')
      );

      INSERT INTO conversation_messages (
        id, thread_id, role, content,
        linked_goal_id, linked_task_id, linked_action_id, created_at
      )
      SELECT
        m.id, m.thread_id, m.role, m.content,
        COALESCE(
          CASE WHEN q.goal_id IN (SELECT id FROM goals) THEN q.goal_id END,
          (
            SELECT t.goal_id FROM learning_tasks t
            WHERE t.id = q.task_id AND t.goal_id IS NOT NULL
          ),
          (
            SELECT t.goal_id
            FROM learning_actions a
            JOIN learning_tasks t ON t.id = a.task_id
            WHERE a.id = q.daily_guide_action_id AND t.goal_id IS NOT NULL
          )
        ),
        COALESCE(
          CASE WHEN q.task_id IN (SELECT id FROM learning_tasks) THEN q.task_id END,
          (SELECT task_id FROM learning_actions WHERE id = q.daily_guide_action_id)
        ),
        CASE WHEN q.daily_guide_action_id IN (SELECT id FROM learning_actions)
          THEN q.daily_guide_action_id ELSE NULL END,
        m.created_at
      FROM v1.question_messages m
      JOIN v1.question_threads q ON q.id = m.thread_id
      JOIN conversation_threads t ON t.id = m.thread_id
      WHERE trim(m.content) <> ''
        AND m.role IN ('user','assistant');

      INSERT INTO learning_submissions (
        id, task_id, goal_id, session_id, content, created_at
      )
      SELECT
        s.id, a.task_id, t.goal_id,
        CASE WHEN s.session_id IN (SELECT id FROM focus_sessions) THEN s.session_id ELSE NULL END,
        s.content, s.created_at
      FROM v1.learning_submissions s
      JOIN learning_actions a ON a.id = s.daily_guide_action_id
      JOIN learning_tasks t ON t.id = a.task_id
      WHERE trim(s.content) <> '';

      INSERT INTO learning_evaluations (
        id, kind, submission_id, goal_id, result,
        evidence_json, correct_parts_json, misconceptions_json,
        missing_requirements_json, feedback, direction, self_note,
        recommendation_json, recommendation_decision,
        application_status, application_error, applied_at,
        ai_review_id, created_at
      )
      SELECT
        e.id, 'submission', e.submission_id, NULL, e.result,
        e.evidence_json, e.correct_parts_json, e.misconceptions_json,
        e.missing_requirements_json, e.feedback,
        CASE WHEN e.decision IN ('advance','stay','remediate','replan')
          THEN e.decision ELSE 'stay' END,
        NULL,
        CASE
          WHEN (SELECT COUNT(*) FROM v1.next_step_decisions d WHERE d.evaluation_id = e.id) = 1
          THEN json_object(
            'kind', e.recommended_action,
            'summary', e.feedback,
            'decision', (
              SELECT d.decision FROM v1.next_step_decisions d
              WHERE d.evaluation_id = e.id
            )
          )
          ELSE NULL
        END,
        NULL, NULL, NULL, NULL,
        NULL, e.created_at
      FROM v1.learning_evaluations e
      JOIN learning_submissions s ON s.id = e.submission_id;

      INSERT INTO knowledge_items (
        id, goal_id, key, summary, detail, source_type, source_id,
        occurrence_count, last_seen_at, status, created_at, updated_at
      )
      SELECT
        k.id,
        CASE WHEN k.goal_id IN (SELECT id FROM goals) THEN k.goal_id ELSE NULL END,
        k.key, k.summary, k.detail, k.source_type, k.source_id,
        k.occurrence_count, k.last_seen_at, k.status, k.created_at, k.updated_at
      FROM v1.knowledge_items k
      WHERE EXISTS (
        SELECT 1
        FROM v1.knowledge_item_evidence e
        WHERE e.knowledge_item_id = k.id
          AND (
            e.submission_id IN (SELECT id FROM learning_submissions)
            OR e.evaluation_id IN (SELECT id FROM learning_evaluations)
          )
      );

      INSERT INTO knowledge_item_evidence (
        id, knowledge_item_id, source_type, source_id,
        submission_id, evaluation_id, task_id, created_at
      )
      SELECT
        e.id, e.knowledge_item_id, e.source_type, e.source_id,
        CASE WHEN e.submission_id IN (SELECT id FROM learning_submissions)
          THEN e.submission_id ELSE NULL END,
        CASE WHEN e.evaluation_id IN (SELECT id FROM learning_evaluations)
          THEN e.evaluation_id ELSE NULL END,
        CASE WHEN e.task_id IN (SELECT id FROM learning_tasks)
          THEN e.task_id ELSE NULL END,
        e.created_at
      FROM v1.knowledge_item_evidence e
      JOIN knowledge_items k ON k.id = e.knowledge_item_id
      WHERE e.submission_id IN (SELECT id FROM learning_submissions)
         OR e.evaluation_id IN (SELECT id FROM learning_evaluations);

      INSERT INTO learner_facts (
        id, goal_id, task_id, scope, key, value, source,
        confidence, created_at, updated_at
      )
      SELECT
        f.id,
        CASE WHEN f.goal_id IN (SELECT id FROM goals) THEN f.goal_id ELSE NULL END,
        CASE WHEN f.task_id IN (SELECT id FROM learning_tasks) THEN f.task_id ELSE NULL END,
        f.scope, f.key, f.value, f.source,
        f.confidence, f.created_at, f.updated_at
      FROM v1.learner_facts f
      WHERE f.source IN ('user_stated','confirmed');

      INSERT INTO prompt_profiles (
        id, key, name, description, active_version_id, created_at, updated_at
      )
      SELECT id, key, name, description, active_version_id, created_at, updated_at
      FROM v1.prompt_profiles;

      INSERT INTO prompt_versions (
        id, profile_id, version, content, created_at
      )
      SELECT v.id, v.profile_id, v.version, v.content, v.created_at
      FROM v1.prompt_versions v
      JOIN prompt_profiles p ON p.id = v.profile_id;

      INSERT INTO app_settings (key, value, updated_at)
      SELECT key, value, updated_at
      FROM v1.app_settings
      WHERE key IN (
        'deepseekBaseUrl',
        'deepseekModel',
        'autoLaunch',
        'defaultBlockMinutes',
        'dailyStudyWindows',
        'learningStyle'
      )
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;

      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  } finally {
    await target.execute('DETACH DATABASE v1');
  }
}

async function validateBuildingDatabase(client: Client): Promise<Record<string, unknown>> {
  const tablePlaceholders = REQUIRED_V2_TABLES.map(() => '?').join(', ');
  const presentTables = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tablePlaceholders})`,
    args: [...REQUIRED_V2_TABLES]
  });
  if (presentTables.rows.length !== REQUIRED_V2_TABLES.length) {
    const present = new Set(presentTables.rows.map((row) => String(row.name)));
    throw new Error(`V2 is missing required tables: ${REQUIRED_V2_TABLES.filter((name) => !present.has(name)).join(', ')}`);
  }
  const indexPlaceholders = REQUIRED_V2_INDEXES.map(() => '?').join(', ');
  const presentIndexes = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${indexPlaceholders})`,
    args: [...REQUIRED_V2_INDEXES]
  });
  if (presentIndexes.rows.length !== REQUIRED_V2_INDEXES.length) {
    const present = new Set(presentIndexes.rows.map((row) => String(row.name)));
    throw new Error(`V2 is missing required indexes: ${REQUIRED_V2_INDEXES.filter((name) => !present.has(name)).join(', ')}`);
  }

  const integrity = await client.execute('PRAGMA integrity_check');
  const integrityValue = String(integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0] ?? '');
  if (integrityValue.toLowerCase() !== 'ok') {
    throw new Error(`V2 integrity_check failed: ${integrityValue}`);
  }

  const foreignKeys = await client.execute('PRAGMA foreign_key_check');
  if (foreignKeys.rows.length > 0) {
    throw new Error(`V2 foreign_key_check failed with ${foreignKeys.rows.length} violation(s).`);
  }

  const unfinished = await scalarCount(
    client,
    `SELECT COUNT(*) AS count FROM focus_sessions WHERE status IN ('active','paused')`
  );
  if (unfinished > 1) {
    throw new Error('V2 contains more than one unfinished Focus Session.');
  }

  const legacyTables = await client.execute(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND (
        name LIKE 'daily_%'
        OR name IN (
          'task_items',
          'plan_stages',
          'task_dependencies',
          'learning_steps',
          'learning_runtime_states',
          'next_step_decisions',
          'plan_adjustment_proposals',
          'learning_summaries',
          'focus_events',
          'skip_logs',
          'generation_locks'
        )
      )
  `);
  if (legacyTables.rows.length > 0) {
    throw new Error(`V2 contains legacy tables: ${legacyTables.rows.map((row) => row.name).join(', ')}`);
  }

  const schemaVersion = await client.execute({
    sql: `SELECT value FROM app_settings WHERE key = 'schemaVersion' LIMIT 1`,
    args: []
  });
  if (String(schemaVersion.rows[0]?.value ?? '') !== V2_SCHEMA_VERSION) {
    throw new Error('V2 schema version marker is missing or invalid.');
  }

  return {
    integrity: 'ok',
    foreignKeyViolations: 0,
    requiredTables: REQUIRED_V2_TABLES.length,
    requiredIndexes: REQUIRED_V2_INDEXES.length,
    unfinishedSessions: unfinished,
    goals: await scalarCount(client, 'SELECT COUNT(*) AS count FROM goals'),
    tasks: await scalarCount(client, 'SELECT COUNT(*) AS count FROM learning_tasks'),
    submissions: await scalarCount(client, 'SELECT COUNT(*) AS count FROM learning_submissions'),
    evaluations: await scalarCount(client, 'SELECT COUNT(*) AS count FROM learning_evaluations')
  };
}

async function scalarCount(client: Client, sql: string): Promise<number> {
  const result = await client.execute(sql);
  return Number(result.rows[0]?.count ?? 0);
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
