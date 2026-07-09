# Testing and Migrations

## 1. 测试要求

Test domain logic separately from UI.

Prioritize tests for:

* plan parsing
* plan validation
* task-status transitions
* plan versioning
* session start, pause, resume, and end
* monitoring-event aggregation
* AI-output validation
* failed AI requests
* user confirmation and rejection
* database migrations
* IPC input validation

Critical end-to-end flows:

1. Create or import a goal.
2. Generate a proposed plan.
3. Confirm the plan.
4. Start a study session.
5. Record session events.
6. End and review the session.
7. Generate an adjustment proposal.
8. Confirm or reject the adjustment.
9. Restart the application and verify data persistence.

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

Use database migrations for every schema change. Never modify an existing production database schema only through ad hoc SQL executed at application startup.

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
