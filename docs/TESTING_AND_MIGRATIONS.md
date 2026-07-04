# Testing and Migrations

## 1. 测试要求

Test domain logic separately from UI.

Prioritize tests for:

* plan parsing
* plan validation
* Daily Guide 主任务和 Action schema validation
* task-status transitions
* plan versioning
* Focus Session start, pause, resume, and end
* Action / Checkpoint local progress persistence
* one-submit-per-main-task evaluation flow
* local evaluation tasks not calling AI
* monitoring-event aggregation
* AI-output validation
* failed AI requests
* user confirmation and rejection
* database migrations
* IPC input validation

Critical end-to-end flows:

1. Create or import a goal.
2. Complete AI goal intake and confirm goal understanding.
3. Generate roadmap, short plan, and first-day Daily Guide.
4. Confirm the Daily Guide.
5. Start a Focus Session for the current main task.
6. Pause, resume, and end Focus Session without triggering AI.
7. Record Action / Checkpoint progress locally.
8. Submit the main task final deliverable once and evaluate it.
9. Generate one task-level daily reflection.
10. Restart the application and verify data persistence.

Before completing a task, inspect `package.json` and run the relevant available commands, such as:

* lint
* typecheck
* unit tests
* relevant integration tests
* production build

Do not claim a test passed unless it was actually run.

If a command cannot run, report:

* the command
* the failure
* the likely cause
* whether the failure was introduced by the current change

## 2. 数据库与迁移安全

Before modifying schema:

1. Inspect existing migrations.
2. Inspect current repository types and queries.
3. Determine whether the change is backward compatible.
4. Create a migration.
5. Verify migration on a clean database.
6. Verify migration on representative existing data where possible.

Do not:

* reset the user's local database automatically
* delete the database to fix a migration problem
* reuse an existing migration for a different schema change
* silently discard invalid records
* alter confirmed plans without preserving a previous version
* delete legacy block tables before their session-anchor responsibilities are migrated

Use database migrations for every schema change. Never modify an existing production database schema only through ad hoc SQL executed at application startup.

When changing the Daily Guide or timer model, verify both clean databases and representative existing data with legacy `daily_plan_blocks` / `daily_guide_blocks`. Legacy blocks should be migrated or interpreted as Focus Session anchors / historical records, not silently discarded.

## 3. 完成标准

A development task is complete only when:

* the requested behavior is implemented
* the relevant UI states are handled
* data persists correctly where required
* AI output is validated where required
* user confirmation rules are preserved
* relevant tests or manual checks have been performed
* no unrelated functionality was intentionally changed
* documentation or project memory is updated when appropriate

At the end of each meaningful task, report in Chinese:

* 完成内容
* 修改文件
* 关键实现
* 验证方式和结果
* 未解决问题
* 潜在风险
* 是否更新了 `docs/PROJECT_MEMORY.md`

Do not report speculative or unverified work as complete.
