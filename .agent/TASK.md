# Task

## Task ID
TASK-000-R1

## Objective
修复并重新验证 Agent 协作协议，解决 TASK-000 审核中发现的全部协议问题。

## Background
TASK-000 的 Codex 审核结果为 CHANGES_REQUESTED，发现以下协议缺陷：
1. 协议文件未纳入 Git，git diff 无法审计未跟踪文件。
2. "工作区必须干净"与协议文件持续更新冲突。
3. REPORT.md 未完整记录未跟踪文件。
4. 测试报告无原始输出、执行时间和退出码证据。
5. Codex 无法独立判断命令是否真实执行。

## Allowed Scope
- `AGENTS.md`
- `.agent/TASK.md`
- `.agent/REPORT.md`
- `.agent/REVIEW.md`
- `.agent/STATUS.json`
- `.agent/history/`
- `.agent/evidence/`
- `.opencode/agents/`
- `.opencode/commands/`

## Forbidden Scope
- 不得修改任何业务代码（`src/`、`scripts/`、`design-prototype/`、`docs/` 等）
- 不得修改 `package.json`、`tsconfig*.json`、`drizzle.config.ts`、`electron.vite.config.ts`、`vitest.config.ts`
- 不得安装、升级或删除依赖
- 不得提交或推送 Git
- 不得删除现有文件

## Requirements
1. 修订 AGENTS.md，增加 Git 工作区基线规则，替代"绝对干净"要求。
2. 修订 executor.md，增加证据目录、基线记录、命令输出保存等规范。
3. 修订 execute-task.md，增加 pre/post 状态捕获、证据保存步骤。
4. 修订 REPORT.md 模板，增加 Started At、Finished At、Pre/Post Git Status、Evidence Directory、Exact Commands、Exit Codes 等字段。
5. 创建 `.agent/evidence/.gitkeep` 目录。
6. 更新 STATUS.json 为 TASK-000-R1。
7. 验证所有 Markdown 和 JSON 格式正确。

## Acceptance Criteria
- 协议文件可以被 Git 审计（已纳入版本管理或明确记录为基础设施文件）。
- 未跟踪文件被完整记录在 REPORT.md 中。
- 测试原始输出和退出码可以通过 evidence 目录保存和验证。
- 执行前后 Git 状态可以对比。
- 不修改业务代码。
- 不安装依赖。
- 不自动提交 Git。

## Required Tests
- 运行 `npm run typecheck` 并保存原始输出和退出码到 evidence 目录。
- 运行 `npm test` 并保存原始输出和退出码到 evidence 目录。

## Required Report
按照修订后的 `.agent/REPORT.md` 模板输出，必须包含所有新增字段。
