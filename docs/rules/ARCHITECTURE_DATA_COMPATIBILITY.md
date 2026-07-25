# 架构、数据与兼容规则

状态：CURRENT
生效日期：2026-07-23
适用范围：架构、IPC、Module、Store、数据库、迁移、AI 上下文、安全边界和旧命名任务。
失效条件：技术栈、主链 owner、V2 数据模型或切库策略经用户确认发生变化。

## 1. 当前架构

技术栈以 `package.json`、lockfile 和当前代码为准：

- Electron + React + TypeScript
- SQLite/libSQL + Drizzle ORM
- OpenAI-compatible DeepSeek client
- Zod runtime validation
- typed preload API + narrow IPC
- Vitest

调用方向：

```text
Renderer
→ typed preload / narrow IPC
→ AppService
→ Agent Loop / Runtime / Planning / Context / Branch modules
→ StudyStore facade / persistence owners
→ SQLite V2
```

Renderer 只展示状态并提交用户显式操作。AppService 只做应用层适配、Electron 行为和错误映射。业务 Module 负责用例，持久化 owner 负责事务和正式状态，任何一层都不得复制另一套状态机。

## 2. V2 正式事实源

正常 Runtime 只允许使用以下 V2 表：

```text
goals
goal_intakes / goal_intake_messages
roadmap_stages
near_term_plan_items / plan_versions
learning_guides
learning_tasks / learning_actions
focus_sessions
current_learning_context
conversation_threads / conversation_messages
learning_submissions / learning_evaluations
ai_reviews / pending_interactions
learner_facts
knowledge_items / knowledge_item_evidence
prompt_profiles / prompt_versions
app_settings
```

V2 不包含 `task_items`、`daily_plans`、`daily_plan_blocks`、`daily_guide_blocks`、`learning_steps`、`learning_runtime_states`、`next_step_decisions`、`plan_adjustment_proposals`、`focus_events`、`generation_locks` 等 V1 事实源。旧名只能存在于隔离迁移器、迁移测试或明确的 UI DTO 兼容边界，不能出现在 Runtime SQL 或正常查询链。

## 3. 状态所有权

| 事实 | 唯一写入 owner | 约束 |
| --- | --- | --- |
| Task 状态与 closureKind | ExecutionRuntime | Evaluation 不修改；CommandGateway 只能调用 Runtime 命令 |
| Action 状态 | ExecutionRuntime | Renderer 不推导或回写 |
| Focus Session 状态与 duration_seconds | Runtime | 全库最多一个 active/paused；结束 Task 不结束 Session |
| Current Context | CurrentLearningContextPersistence | 只保存 Goal/Guide/Task/Action 导航指针和版本 |
| Submission 原文 | EvaluationPersistence | 先落库再调用 AI，不保存评价状态副本 |
| Evaluation 与 Recommendation | EvaluationPersistence | accepted 与 applied 分离；不直接推进其他业务对象 |
| Recommendation 应用 | CommandGateway | 先校验命令和目标，再调用对应业务 owner |
| Agent Run / tool call | OpsPersistence | 统一落在 ai_reviews，不保存隐藏推理 |
| ask_user 暂停 | OpsPersistence | pending_interactions 只保存恢复所需结构化意图，不复制 Current Context |

Task/Guide 的关闭、暂缓或切换如果影响导航指针，业务命令与 Current Context 必须在同一数据库事务内完成。Current Context 不是业务状态事实源；指针失效时只回退到可唯一确定的 Goal 入口并提示用户选择，不猜测 Task 或 Action。

Goal 的 `due_date` 与 Roadmap Stage 的 `target_date` 是进度参照事实。Near-term Plan 和 Learning Guide 的 `suggested_date` 在正常 Runtime 中保持为空，不参与选择、恢复或推进；当前日期只允许派生只读进度提示，不得产生漏学计数、每日实例或自动计划变更。

## 4. Evaluation 与 Recommendation

- `learning_evaluations.kind=submission` 必须关联 Submission；Goal 可由 Submission 链确定，也可为空。
- `kind=goal_review` 必须关联 Goal，不伪装成 Submission Evaluation。
- Recommendation 为空时，`recommendation_decision`、`application_status`、`application_error`、`applied_at` 必须全部为空。
- 多条或冲突 Decision 不选择第一条，也不生成可执行 Recommendation。
- `accepted` 只记录用户决定；只有 CommandGateway 成功执行后才写 `applied`。
- Evaluation、Self-Note 和知识派生都不能直接修改 Task、Action、Session、Guide 或计划。

## 5. 统一 Agent Loop

全部 AI 教学、规划和复盘能力通过一个 Agent Loop 和 Tool Registry 运行。新增能力时新增工具，不新增独立 Agent。`ask_user` 在同一个持久化 Run 内进入 `waiting_user`，回答后恢复原 Run 和结构化工具上下文。

每次 AI 操作必须有明确输入、输出 schema、上下文来源、失败状态和重试语义。Submission 必须先持久化。Agent Run、工具调用、暂停、恢复和失败统一写入 `ai_reviews`；`pending_interactions` 不保存正式业务状态副本。

## 6. V1 → V2 独立升级

升级器源码位于 `src/migration-v1-v2/`，只能通过手动升级命令运行：

```text
npm run db:upgrade-v2 -- <应用数据目录>
npm run db:restore-v1 -- <应用数据目录>
```

升级顺序：

```text
识别 V1
→ VACUUM INTO 生成永久 V1 归档
→ 创建 study-supervisor-v2.building.db
→ 仅复制白名单且可唯一映射的数据
→ 完成 integrity/FK/schema/Session/旧表核对
→ 生成外部迁移报告
→ 原子切换为 study-supervisor-v2.db
```

规则：

- 迁移器不进入 Store、Runtime、正常启动、正常查询或主运行 bundle。
- V1 归档永久保留；无法唯一映射的数据只留在归档和外部报告。
- 不双写、不双读，不为 V1 字段建立永久兼容层。
- 消息按 Goal → Task → Action 的可确定层级迁移；下级无法确定时置空，不丢弃已经确定 Goal 的原文。只迁移部分消息的 Thread 标记为 partial。
- 多条 Decision 冲突时不生成 Recommendation。独立 Proposal 不迁移；已经形成正式计划结果时只迁移最终 Plan Version。
- V1 中 accepted 但未 applied 的建议不恢复成待执行命令。
- 重复运行发现正式 V2 已存在时返回 `not_needed`，不得覆盖。
- Runtime 只打开完成核对的 `study-supervisor-v2.db`，忽略 `.building`、`.ready`、归档和报告文件。
- 回退是重新启用已验证的 V1 归档，不执行 V2 → V1 反向数据合并。

## 7. 后续 V2 Schema 迁移

V2 正常运行后的 schema 变化必须使用版本化迁移，并附可执行 `rollbackSql`。迁移前后至少验证：

- `PRAGMA integrity_check`
- `PRAGMA foreign_key_check`
- schemaVersion
- 关键唯一索引和状态约束
- 受影响业务事实的行数与可恢复路径

未经用户明确批准，不删除 V2 表、列或用户数据。

## 8. Electron 与安全边界

- Renderer 不直接访问 SQLite、Node 文件系统、API key、safeStorage 或系统监控 API。
- IPC 必须窄、类型化并校验输入，不暴露通用 shell、文件系统或动态 IPC。
- secret 不进入日志、错误、AI 审计或数据库快照。
- 不自动执行 AI 生成的代码或命令。
- 不实现截图、录屏、键盘记录、剪贴板监听、麦克风/摄像头采集、完整浏览历史、私信收集、强制锁屏或隐藏监控。
