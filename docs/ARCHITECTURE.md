# 应用架构

## 1. 架构原则

不要维护一个永久增长的 AI 会话。应用状态由 SQLite、领域服务和明确的 IPC 边界管理。

Renderer 只负责界面状态和用户操作，不承载核心业务编排，不直接访问数据库、文件系统、系统监控能力或密钥。

AI 是无状态推理服务。每次调用由服务层按操作类型组装必要上下文，返回结构化 proposal，经校验和必要确认后才影响持久状态。

## 2. 事实源与技术约束

现有项目、`package.json`、lockfile、数据库迁移和当前实现，是已经落地技术选择的事实源。

新模块优先沿用当前技术栈：

* Desktop: Electron + electron-vite
* UI: React + TypeScript
* Styling: 现有样式系统
* Database: SQLite + Drizzle ORM
* AI client: OpenAI-compatible client configured for DeepSeek
* Runtime validation: Zod 或等价 schema validator
* Secrets: Electron `safeStorage`
* Packaging: electron-builder
* Logic tests: Vitest

未经用户明确批准，不迁移框架、样式系统、数据库、状态管理或 AI 客户端。

不要因为常见推荐而新增 Tailwind、组件库、状态管理库、LangChain、LlamaIndex 或其他大型依赖。

## 3. 依赖方向

推荐依赖方向：

```text
Renderer
→ typed preload API
→ Electron main application service
→ domain service
→ repository / AI client
→ SQLite
```

IPC 通道必须窄、可枚举、类型化，并校验输入。不要暴露通用 shell、文件系统或动态 IPC 通道。

## 4. 推荐服务职责

优先使用清晰的领域服务，不引入复杂多 Agent 框架。

### `planning-service`

负责目标、阶段大纲、短期计划、主任务制 Daily Guide 生成和计划修订 proposal。

当前主入口优先拆为主动访谈和分层计划：`goal-intake` 负责自然对话澄清目标，`guide-planning` 负责依次生成长期大纲、前三天短期计划和第一天执行稿。旧阶段路线/每日草稿接口可保留为兼容能力，但不再作为主导航路径。

### `learning-runtime-service`

负责：

* 开始和恢复主任务。
* 记录 Focus Session 开始、暂停、恢复和结束。
* 保存 Action / Checkpoint 本地进度。
* 打开和关闭问题分支。
* 接收主任务最终提交。
* 应用评估结果。
* 通过本地状态机决定完成、继续修改、保存进度或进入下一任务。
* 恢复持久化状态。

### `context-builder`

负责：

* 根据 AI 操作读取必要数据。
* 选择正确的记忆层。
* 获取最近 2～3 个相关步骤摘要。
* 加入当前问题分支。
* 控制上下文长度。
* 记录本次使用了哪些数据来源。

它不能直接调用模型，也不能修改学习状态。

### `tutoring-service`

负责当前步骤的讲解、示例、提示、练习和答疑。

它不能自行把步骤标记为完成。

### `evaluation-service`

根据当前步骤完成标准评估用户提交，并返回结构化结果。

### `progression-service`

兼容旧流程或按需根据评估结果决定下一步：

* `advance`
* `explain_again`
* `remediate`
* `practice`
* `simplify`
* `complete_task`
* `request_user_decision`

当前主任务制提交路径不在每次提交后固定调用 `progression-service`；一次 `evaluate_submission` 之后优先由本地状态机处理。

### `summary-service`

生成问题解决摘要、步骤摘要、任务摘要、每日摘要和阶段摘要。

### `retrieval-service`

按需检索用户笔记、历史错误、学习资料、相关步骤摘要和已掌握知识。

## 5. 调用流程

```text
Renderer 操作
→ typed preload API
→ application service
→ domain service
→ context-builder
→ AI service
→ schema validation
→ repository transaction
→ 返回最新状态
```

## 6. 必要数据概念

尽量映射到现有表，不要为了名称一致重复建表：

* `LearningGoal`
* `RoadmapStage`
* `ShortPlanDay`
* `DailyGuide`
* `DailyGuideTask`
* `DailyGuideAction`
* `FocusSession`
* `LearningRuntimeState`
* `QuestionThread`
* `QuestionMessage`
* `Submission`
* `Evaluation`
* `NextStepDecision`（兼容 / 按需）
* `MemorySummary`
* `AiCallRecord`

当前学习位置必须由持久化运行态显式保存，不能只根据聊天时间或最后一条消息推测当前位置。字段和问题分支规则以 `docs/AI_AND_DATA_RULES.md` 为准。

旧 `daily_plan_blocks` / `daily_guide_blocks` 仍可作为 session 锚点和历史兼容结构存在，但不再代表固定时间块；清理前必须先设计迁移方案。

## 7. 架构变更规则

大型架构变更必须先产出设计说明或迁移方案，再修改生产代码。

保持向后兼容，除非用户明确批准破坏性变更。
