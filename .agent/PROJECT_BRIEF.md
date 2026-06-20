# Agent Runner Project Brief

本项目新增的 `tools/agent-runner/` 是一个最小可运行的双 Agent 自动开发调度器。

旧的 `.agent/TASK.md`、`.agent/REPORT.md`、`.agent/REVIEW.md` 交接协议保留为 legacy，不再作为新调度器的主流程输入。

新调度器只使用：

- `.agent/PROJECT_BRIEF.md`
- `.agent/state.json`
- `.agent/runs/<runId>/`
- `tools/agent-runner/schemas/*.schema.json`

核心边界：

- 用户输入一次需求。
- Codex 负责生成结构化任务规格和产品/功能验收结论。
- OpenCode 负责执行开发任务和返工。
- 调度器独立执行 typecheck、test、build、capture，并保存完整证据。
- Codex 验收阶段只读取当前 run 的验收包，不主动扫描整个仓库。
- 不自动 `git commit`，不自动 `git push`。
- 不执行 `git reset --hard`、`git clean` 或其他破坏性 Git 操作。

