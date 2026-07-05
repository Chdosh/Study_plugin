# AI 与数据规则

## 1. 状态与数据事实源

SQLite 是 durable source of truth。模型是无状态推理服务，不拥有应用状态。

不得依赖一个无限增长的 AI 对话。不得默认将完整聊天和学习历史发送给模型。

每次 AI 调用必须根据操作类型组装必要上下文。工作上下文只包含当前操作需要的少量信息，完整档案保存在数据库。

AI 输出是 untrusted external data。涉及计划、任务、用户画像或学习状态的后果性变化必须先展示 proposal、原因、差异和确认/拒绝操作。

## 2. 数据规则

每次 schema 变更必须使用迁移，不得只靠启动时 ad hoc SQL 改生产结构。

数据更新规则：

* 多记录更新使用事务。
* 创建新 proposal 时保留用户已确认计划。
* 重要计划变化使用版本记录。
* 未经明确批准，不删除表、列或用户数据。
* 需要可恢复时优先软删除或归档。
* 状态转换和时间戳必须清晰。
* 避免无理由在多张表重复保存同一段 AI 文本。
* 派生数据必须可从 durable source records 重建。

必要数据概念尽量映射到现有表，不为了名称一致重复建表。

## 3. 当前学习位置

当前学习位置必须显式保存：

* `activeGoalId`
* `activeStageId`
* `activeDailyTaskId`
* `activeDailyGuideTaskId`
* `activeActionId` 或当前执行位置引用
* `activeQuestionThreadId`
* `sessionStatus`

当前实现仍保留部分旧 `block/step` 字段作为 session 锚点和兼容路径；新流程语义以 `daily_guide_tasks` 主任务为准。打开问题只改变 `activeQuestionThreadId`，不得替换当前主任务或当前执行位置。

问题解决后：

1. 生成解决摘要。
2. 标记分支已解决。
3. 清除 `activeQuestionThreadId`。
4. 恢复当前主任务和执行位置界面。

不能只根据聊天时间或最后一条消息推测当前位置。

## 4. 记忆分层

### L0 用户画像

保存相对稳定的信息：当前基础、偏好的讲解方式、学习速度、常见错误、强项和弱项、每天可用时间。

单次 AI 判断不能直接永久修改用户画像。

### L1 总目标摘要

保存总学习目标、目标结果、时间限制、当前阶段和总体进度。

### L2 当前阶段摘要

保存阶段目标、前置知识、完成标准、已掌握内容和尚未解决的问题。

### L3 今日任务

保存今日可用时间、已确认任务、未完成任务、当前任务和当前任务完成标准。

### L4 当前主任务 / 执行位置

这是最高优先级上下文，至少包含：

* `taskId`
* `objective`
* `scope`
* `currentAction`
* `deliverable`
* `doneWhen`
* `status`
* `attempt` 或 `submissionCount`

### L5 最近步骤摘要

通常只读取最近 2～3 个相关步骤，不读取完整聊天。

每个摘要包含学习结果、用户完成内容、已掌握内容、错误理解、已解决问题和仍需带到下一步的信息。

### L6 当前问题分支

只包含当前问题、当前步骤引用、该问题最近几轮对话、是否已解决和解决摘要。

### L7 按需检索内容

必要时检索用户笔记、过去错误、学习资料、相关步骤摘要和已掌握知识。

检索必须有选择、有边界。

## 5. 上下文组装规则

内容过多时，按照以下顺序保留：

```text
当前用户输入
> 当前主任务 / 执行位置
> 完成标准
> 当前问题分支
> 当前任务
> 当前评估或提交
> 最近步骤摘要
> 当前阶段
> 总目标摘要
> 更早历史
```

必须为模型输出预留空间。上下文长度限制应集中配置，不要散落硬编码。

如果上下文组装失败，不得自动退化成发送完整历史；必须保留当前学习状态，返回结构化错误，允许重试，并记录上下文来源和失败类别，不记录敏感内容。

如果摘要生成失败，保留原始记录，将摘要标记为 pending 或 failed，不丢失已完成学习工作，不虚假推进任务。

## 6. 不同操作的上下文

主动目标访谈读取：当前 intake 的最近访谈消息、已知目标理解和用户最新输入；不得读取完整学习历史。

生成长期大纲读取：已确认目标理解、用户基础、可用时间和现实限制；只输出阶段和方向。

生成短期计划读取：已确认目标理解和长期大纲；只输出第一周重点和前三天安排。

生成今日执行稿读取：已确认目标理解、长期大纲、短期计划、今日可用时间。必须指定目标 `dayIndex` 和对应的 `ShortPlanDay`，不得在 prompt 内硬编码 `dayIndex === 1`。AI 只展开目标学习日的主任务、执行动作和本地检查点。若存在前一日完成情况（submission evaluation、review 结果），作为可选上下文输入。任务决定时长，不预先切成固定 10 分钟块。

生成阶段大纲读取：用户目标、用户基础、可用时间、已确认的大纲。

生成今日任务读取：总目标摘要、当前阶段、最近几天摘要、未完成任务、今日可用时间。

当前任务教学读取：当前阶段简述、当前主任务、当前执行动作、最近 2～3 条相关摘要、必要学习资料。

回答问题读取：当前主任务和执行位置、当前问题分支、相关资料、必要的最近摘要。不得改变当前主任务。

评估提交读取：当前主任务目标、完成标准、用户最终提交、当前任务之前的尝试、相关常见错误。Action 完成状态、Checkpoint、暂停、恢复和 Focus Session 不触发 AI 评估。

决定下一步读取：当前主任务目标、评估结果、最近摘要、剩余时间。当前主流程不再在每次提交后固定调用 `decide_next_step`；提交后由本地状态机根据 `evaluate_submission` 输出决定通过、继续修改、保存进度或进入下一任务。`decide_next_step` 仅作为兼容或用户明确请求的按需能力保留。

总结步骤、任务或天时，优先读取下级结构化摘要，不默认重放全部原始消息。

## 7. AI 操作与输出

不同操作必须使用不同 prompt 和结构化输出，不得使用一个通用聊天 prompt 处理全部流程。

### `generate_stage_outline`

输出总目标摘要、阶段列表、每阶段目标、前置条件和完成标准。

不得输出全部详细学习步骤。

### `goal_intake`

输出 `status: need_more_info | ready`、自然语言回复、缺失信息列表和可确认的目标理解。用户说“直接开始”或“先生成计划”时，必须基于已有信息输出 best-effort 目标理解。

### `generate_roadmap`

输出长期目标摘要和阶段列表。只包含阶段、方向和成功标准，不展开每日细节。

### `generate_short_plan`

输出第一周重点和前三天安排。第 2、3 天只给可执行摘要，不展开到分钟。

### `generate_daily_guide`

输出目标学习日执行稿。每次调用必须明确指定目标 `dayIndex` 和对应的 `ShortPlanDay`（包含 `title`、`focus`、`tasks`、`expectedOutput`、`successCriteria`），不得默认取 `dayIndex === 1`。若存在前一日完成情况（submission evaluation、review 结果），作为可选上下文输入。

输出内容包括今天总目标、明确产物、不要做的事、结束验收、明天动作和 2～4 个主任务。默认优先 3 个主任务，按当天可用时间和任务复杂度动态调整数量，并预留约 10%～15% 缓冲时间。

每个主任务输出 `title`、`objective`、`scope`、`estimatedMinutes.min/target/max`、`actions`、`deliverable`、`doneWhen`、`quickHint`、`evaluationMode`、`submissionPolicy` 和 `carryoverAllowed`。prompt 应鼓励每个主任务内部包含 3～6 个 Action；当前 schema 为真实模型稳定性允许至少 1 个 Action，不能因为少量 Action 直接阻断主流程。Action 和 Checkpoint 只用于执行引导和本地进度记录，不能作为独立 AI 评估单位。

### `generate_daily_plan`

输出日期、可用时间、今日任务、每项任务目标、预期产出、完成标准和预计时间。

### `teach_step`

输出当前步骤说明、讲解、用户需要执行的动作、完成标准和是否需要用户提交。

不得直接宣布步骤完成。

### `answer_step_question`

输出直接回答、与当前步骤的关系、必要示例、问题是否已经解决、如何返回当前步骤。

不得改变 `activeStepId`。

### `evaluate_submission`

输出：

* `result: passed | partial | failed | unclear`
* `mastery`
* `evidence`
* `correctParts`
* `misconceptions`
* `missingRequirements`
* `feedback`
* `recommendedAction`

### `decide_next_step`（兼容 / 按需）

当前主任务提交流程不固定调用此操作。只有兼容旧流程、用户明确要求 AI 给下一步建议，或后续重新设计需要二次决策时才按需使用。

输出：

* `decision`
* `reason`
* `taskCompleted`
* `nextStep`
* `remediation`
* `carryForward`

`decision` 必须属于允许的下一步决策：

* `advance`
* `explain_again`
* `remediate`
* `practice`
* `simplify`
* `complete_task`
* `request_user_decision`

### `summarize_step`

输出本步结果、用户完成内容、已掌握内容、错误理解、已解决问题、未解决问题和需要带到下一步的信息。

## 8. 校验规则

所有结构化 AI 输出必须经过运行时 schema 校验。

校验失败时：

* 不改变已确认状态。
* 最多进行有限次数修复或重试。
* 保留安全的原始响应用于排查。
* 返回明确错误。
* 允许用户重试。

不得静默补造缺失的重要字段。

AI 不得直接：

* 覆盖已确认计划。
* 删除用户数据。
* 标记任务完成。
* 永久改变目标。
* 扩大监控范围。
* 修改用户画像事实。
* 执行代码或系统命令。

## 9. AI 调用记录

在条件允许时记录：

* `operation`
* `provider`
* `model`
* `promptVersion`
* `schemaVersion`
* `contextSourceIds`
* `tokenUsage`
* `latency`
* `validationResult`
* `retryCount`
* `errorCategory`

不得记录：

* API Key
* 认证信息
* 无关隐私数据
* 不必要的完整原始监控历史

## 10. RAG 与知识库路线

不要在核心任务、session、review 和 source 数据稳定前实现复杂 RAG。

推荐演进：

1. 稳定任务、会话、复盘和来源数据。
2. SQLite FTS5 关键词搜索。
3. 来源文档 ingestion 和 chunking。
4. 使用 LanceDB 或 `sqlite-vec` 做向量检索。
5. 检索质量评估。
6. 只有检索质量不足时加入 reranking。
7. 只有 ingestion 和多步检索显著复杂后才考虑 LlamaIndex.TS。

RAG 索引是派生产物，必须可重建。

不要把生成摘要当作原始资料。

每个知识项应尽量保留来源、创建方式、关联目标、关联 Focus Session、时间戳、置信度或复核状态。

## 11. Prompt Profiles

Prompt profiles 应可编辑、可版本化。

建议 profile：

* `foundation`: 详细、适合初学者
* `standard`: 讲解和练习平衡
* `advanced`: 简洁并假设已有背景
* `exam`: 偏测验和产出
* `recovery`: 用于 missed session 或低完成度后的恢复

Prompt profile 只能影响教学风格，不能覆盖产品安全、隐私、数据完整性或确认规则。

不要在 UI 组件和服务中硬编码多份不一致 prompt。

## 12. 隐私边界

不要把无关私密内容放入模型上下文。

原始前台窗口标题、监控记录和 secrets 不得进入上下文，除非某个已披露操作明确需要。

存储的上下文快照必须脱敏，绝不能包含 API key 或认证 token。
