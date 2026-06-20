# Task

## Task ID
TASK-000-R2

## Objective
修复 TASK-000-R1 审核发现的协议审计缺陷，使 Agent 交接证据、报告和最终 Git 状态一致，并补齐 build 验证证据。

## Background
TASK-000-R1 的审核结论为 CHANGES_REQUESTED。主要问题：
1. `.gitignore` 被修改，但不在 TASK-000-R1 Allowed Scope 中。
2. REPORT.md 声称任务开始前工作区干净，但 `pre-status.txt` 显示 `M AGENTS.md`。
3. post 状态捕获早于部分 evidence 文件创建，不能代表最终状态。
4. REPORT.md 声称修改 AGENTS 和 `.opencode` 文件，但当前 diff 未显示这些变更。
5. 缺少 `npm run build` 的原始日志和退出码证据。

## Allowed Scope
- `.gitignore`（仅允许处理 `.agent/evidence/**/*.log` 审计证据跟踪规则，并必须在 REPORT.md 中说明原因）
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
- 不得修改 `package.json`、`package-lock.json`、`tsconfig*.json`、`drizzle.config.ts`、`electron.vite.config.ts`、`vitest.config.ts`
- 不得安装、升级或删除依赖
- 不得提交或推送 Git
- 不得删除现有文件
- 不得伪造、改写或虚构命令结果

## Requirements
1. 重新读取 AGENTS.md、TASK.md、REVIEW.md、STATUS.json 和 R1 evidence，确认 R2 的修复范围。
2. 创建 `.agent/evidence/TASK-000-R2/`，保存 R2 的完整证据。
3. 在执行前保存：
   - `pre-status.txt`：`git status --short --untracked-files=all`
   - `pre-untracked.txt`：`git ls-files --others --exclude-standard`
4. 准确识别并在 REPORT.md 中列出 pre-existing changes，不能把已有修改写成工作区干净。
5. 修复协议文档中的证据顺序要求：最终 `post-status.txt`、`post-untracked.txt`、`diff-name-status.txt`、`diff-stat.txt` 必须在所有修改、验证命令和 manifest 准备完成后捕获；如 manifest 创建后会改变最终未跟踪文件列表，需再次捕获最终状态或在报告中明确说明。
6. 处理 `.gitignore` 的 evidence log 跟踪规则：保留或调整均可，但必须在 Allowed Scope 内说明必要性，并确保最终 `git status` 能审计 `.log` 文件。
7. 运行并保存以下命令的完整 stdout/stderr 与 exit code：
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
8. 创建或更新 `evidence-manifest.json`，必须包含 taskId、startedAt、finishedAt、workingDirectory、commands、evidenceFiles、executor，并与实际 evidence 文件一致。
9. 更新 `.agent/REPORT.md`，必须逐项引用 R2 evidence，且内容不得与 evidence 冲突。
10. 更新 `.agent/STATUS.json`：
   - `taskId` 为 `TASK-000-R2`
   - `phase` 为 `waiting_review`
   - `updatedBy` 为 `executor`
   - `needsHumanDecision` 根据实际情况设置

## Acceptance Criteria
- 没有业务代码修改。
- `.gitignore` 如有修改，已在 R2 Allowed Scope 和 REPORT.md 中明确说明。
- REPORT.md 中的 pre/post Git 状态与 `.agent/evidence/TASK-000-R2/` 文件一致。
- 未跟踪文件在 REPORT.md、post-status、post-untracked 中完整记录。
- `npm run typecheck`、`npm test`、`npm run build` 均有 `.log` 和 `.exitcode` 证据；任何失败都不得报告为通过。
- `evidence-manifest.json` 与实际 evidence 文件清单一致。
- STATUS.json 正确处于 `waiting_review`。
- 不提交 Git，不推送 GitHub。

## Required Tests
- `npm run typecheck`
- `npm test`
- `npm run build`

每个命令必须保存原始输出和退出码到 `.agent/evidence/TASK-000-R2/`。

## Required Report
按照修订后的 `.agent/REPORT.md` 结构输出。报告必须明确：
- R2 执行前 Git 状态
- R2 执行后最终 Git 状态
- pre-existing changes
- 本轮实际修改文件
- 未跟踪文件列表
- 三个验证命令的日志文件、退出码和结果
- R1 审核问题如何逐项处理
