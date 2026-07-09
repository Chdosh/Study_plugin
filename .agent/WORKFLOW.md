# Agent Workflow

## 1. 适用范围

本文件只在使用 Task-ID、`.agent/TASK.md`、`.agent/STATUS.json`、`.agent/DELIVERY.md` 或其他正式任务协议时必读并完整执行。

普通小型交互任务不强制生成完整证据目录，但仍必须遵守危险 Git 操作禁令、不得覆盖用户变更、不得自动提交、不得声称未运行的验证已通过。

## 2. Task-ID

正式任务必须有稳定 Task-ID。若 `.agent/TASK.md` 已提供 Task-ID，使用该值；否则由任务执行者创建清晰、唯一的 Task-ID，例如 `TASK-YYYYMMDD-short-name`。

所有证据保存到 `.agent/evidence/<Task-ID>/`。

## 3. Git Baseline and Evidence Rules

The working tree does NOT need to be absolutely clean before starting a task. Instead:

### Before execution

* Record a complete baseline of the working tree: modified, deleted, added, and untracked files.
* Save `git status --short --untracked-files=all` to `.agent/evidence/<Task-ID>/pre-status.txt`.
* Save `git ls-files --others --exclude-standard` to `.agent/evidence/<Task-ID>/pre-untracked.txt`.
* Identify which changes pre-exist the current task.
* Pre-existing changes must not be overwritten, rolled back, or mixed into the current task's output.

### During execution

* The executor may only produce new changes within Allowed Scope and protocol output files (`.agent/DELIVERY.md`, `.agent/STATUS.json`, `.agent/evidence/`).
* If unknown modifications exist that may conflict with the task, STOP and set `needsHumanDecision=true`.

### After execution

* Save post-execution `git status --short --untracked-files=all` to `.agent/evidence/<Task-ID>/post-status.txt`.
* Save post-execution `git ls-files --others --exclude-standard` to `.agent/evidence/<Task-ID>/post-untracked.txt`.
* Save `git diff --name-status` to `.agent/evidence/<Task-ID>/diff-name-status.txt`.
* Save `git diff --stat` to `.agent/evidence/<Task-ID>/diff-stat.txt`.
* Compare pre and post status to show exactly what changed during this task.

## 4. Forbidden Git Operations

The following operations are forbidden:

* `git reset --hard`
* `git clean`
* `git checkout --`
* `git restore`
* `git stash`
* `git push`

Auto-committing is forbidden.

## 5. Protocol Files and Git

The following files MUST be tracked by Git and must NOT be added to `.gitignore`:

* `AGENTS.md`
* `.agent/TASK.md`
* `.agent/DELIVERY.md`
* `.agent/REVIEW.md`
* `.agent/STATUS.json`
* `.agent/evidence/`
* `.opencode/agents/`
* `.opencode/commands/`

## 6. Verification Evidence

Every verification command must save full stdout and stderr to a `.log` file in `.agent/evidence/<Task-ID>/`.

Every verification command must save its exit code to a `.exitcode` file.

An `evidence-manifest.json` must record:

* `taskId`
* `startedAt`
* `finishedAt`
* `workingDirectory`
* commands with exit codes
* evidence files
* executor

A command that fails must NOT be reported as "passed".

## 7. Delivery

Formal task delivery should include:

* completed work
* changed files
* key implementation decisions
* verification commands and results
* known unresolved issues
* risks
* whether `docs/PROJECT_MEMORY.md` was updated
