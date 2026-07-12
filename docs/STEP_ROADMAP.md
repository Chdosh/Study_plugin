# 项目 Step 推进计划

状态：ACTIVE  
更新日期：2026-07-11（P0 文档同步）
用途：把“长期学习 Agent Runtime”方向拆成可逐步实现、独立验收的开发步骤。  
约束：本文件服从 `docs/PRODUCT_TRUTH.md`、`docs/MVP_SPEC.md` 和仓库当前代码；完成状态以代码、测试和 `docs/PROJECT_MEMORY.md` 为准。

## 1. 推进目标

项目主线不是增加 Agent 数量，而是为无状态、概率性的 LLM 建立一个确定、可持久化、可校验、可恢复的学习运行时。

推进顺序固定为：

```text
可靠学习闭环
→ 统一 AI 事务边界
→ Operation-scoped ContextBuilder
→ 可审计计划变更
→ 证据型知识演化
→ 长期使用体验与兼容收敛
```

每个 Step 必须同时处理：数据事实源、状态变化、失败行为、恢复入口、UI 反馈和测试证据。不得只完成成功路径。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| `pending` | 尚未开始 |
| `in_progress` | 当前正在实现 |
| `blocked` | 存在必须先解决的外部阻塞 |
| `completed` | 行为、失败路径和验证全部完成 |

同一时间只应有一个主要 Step 处于 `in_progress`。发现代码已经部分实现时，应先核对实际行为，再决定补齐或标记完成，不能按旧文档重复开发。

## 3. 当前基线

已经具备的基础能力：

- 主任务制 Daily Guide、Focus Session、问题分支、最终提交、评价和复盘。
- SQLite 持久化运行状态与确定性执行状态机。
- AI JSON 提取、normalize、Zod 校验和一次 repair。
- AI 调用记录、traceId、token/延迟指标和错误分类。
- Daily Guide 持久生成锁，以及用户消息、提问和提交的请求级去重。
- ContextBuilder 已有字段白名单、字段截断、来源 ID 和操作级 token 硬预算；完整 operation 接入和来源状态仍在 C1/C3 收敛。
- 计划调整 Proposal/Apply 基础、知识证据闭环（K1/K2/K3 已完成）和复习触发。
- 上下文冲突仲裁和摘要来源追踪已有基础实现，但通用仲裁与摘要失败生命周期尚未完成。
- 待处理中心（U1）和知识库筛选（U3）已有基础；完整学习时间线（U2）及数据恢复（U4）尚未完成。

当前主要风险：

- 提交评价记录事务和恢复入口已完成；Evaluation 应用结果与状态推进仍需在 T1 收敛为可证明的持久 Saga。
- 计划快照已有写入，`getPlanVersionsForGoal` 已实现，但 IPC 通道和 UI 展示仍缺失。
- 旧 block/step 数据仍承担部分 Session 兼容职责，Q1 尚未收敛。
- 知识项已具备证据、聚合、复习候选和重新验证基础，长期掌握度策略仍可继续深化。
- `LearningRuntimeModule` 已统一 Session、Action、Task skip 和结束本次学习的运行时入口。
- `PlanningModule` 已统一 Daily Guide 生成/恢复、滚动计划、学习日关闭、Review 容错和下一单元推进。
- 模块迁入（Planning/Runtime/Context/Branch/History）已完成，AppService 现为业务 Adapter 层。
- 迁移噪声已消除（Q2 已完成），duplicate-column 日志不再出现。

## 4. Step 清单

### Phase R：可靠学习闭环

#### R1 提交评价可恢复

状态：`completed`

目标：用户提交一旦保存，即使 AI 失败或应用退出，也能复用同一条 Submission 完成评价。

实现范围：

1. Store 能查询当前任务最近的 `waiting` / `failed` Submission。
2. AppService 提供“获取待处理评价”和“重试评价”能力。
3. 重试复用原 Submission，不再创建新记录。
4. 评价成功后保存 Evaluation、Decision，并由本地状态机推进。
5. Study UI 显示待评价或评价失败状态，并提供重试入口。
6. 重复点击重试只触发一次模型调用。

验收：

- AI 失败后用户提交仍可读取。
- 重启后能发现原 Submission。
- 重试前后 Submission ID 不变。
- 重复重试不会产生重复 Evaluation。
- 未评价成功前任务不会被标记完成。

#### R2 Daily Guide 生成失败恢复

状态：`completed`

目标：目标学习日激活后，生成失败不会跳日、覆盖历史或退回访谈。

完成结果：生成 AI 前事务创建 `sessionStatus=draft` 的空任务 Guide；失败、退出和重启后直接从持久 draft 恢复。重试原位填充同一个 Guide ID 并切换为 active，不跳 ShortPlanDay、不覆盖历史、不产生双 Guide。

实现范围：

1. 失败时保留目标 `ShortPlanDay.date`。
2. 对应 Daily Guide 保持 `draft` / 待生成状态。
3. Today 展示失败原因和手动重试。
4. 重试继续使用同一目标 dayIndex 和持久 generation lock。
5. 不修改已完成 Guide，不跳过当前 ShortPlanDay。

验收：schema 失败、超时和应用重启后均能安全重试，最终只产生一个有效 Guide。

#### R3 本地学习日和跨日推进

状态：`completed`

目标：所有学习日判断使用一致的本地时区规则。

实现范围：

1. 建立集中的学习日日期函数。
2. 替换散落的 UTC `toISOString().slice(0, 10)`。
3. 明确同日第二次推进和午夜跨日行为。
4. 增加本地时区、午夜、跨日和多日未打开测试。

验收：Daily Guide 日期与 Windows 本地日期一致，已完成日不会因时区错误被重新激活。

#### R4 启动一致性审计

状态：`completed`

目标：应用启动时识别并安全处理 runtime、Session、Task、Action 和 Guide 的不一致。

实现范围：

1. 检查持久化运行指针和正式数据是否一致。
2. 仅自动修复可以唯一推导的指针。
3. 无法推导时返回结构化冲突，不删除或推进学习数据。
4. UI 提供明确恢复选择。

验收：代表性中断状态均能恢复或给出明确阻断原因。

完成结果：主进程创建窗口前执行审计并缓存结构化结果；唯一可推导的 Goal/Stage/Task/Action/Session 指针自动修复，多 Session、跨 Goal 或关闭 Guide 等歧义只报告。Renderer 提供重新检查或保留数据稍后处理，不静默推进和删除数据。

### Phase T：AI 事务边界

#### T1 核心 AI 操作生命周期统一

状态：`completed`

目标：逐步让核心 AI 操作遵循 `prepare → context → invoke → normalize → validate → review → propose/apply` 生命周期。

完成结果：Evaluation、Decision 和 Submission 评价状态事务写入；Submission 另存 pending/applied/failed 应用生命周期。Action、Task、Focus Session、Guide 和 Runtime 通过持久 Saga 幂等推进；启动只重放 pending/failed，缺失 Decision/Action/Task 保留冲突，同一 Submission 不重复调用 AI 或重复应用。

验收：核心操作使用统一错误语义、trace、prompt/schema 版本和上下文来源记录。

#### T2 计划变更 Proposal / Apply 分离

状态：`completed`

目标：AI 只能提出计划变化，用户确认后才能事务应用。

完成结果：Review 的 AI 调整只通过 PlanningModule 的 proposal/confirm Interface 应用；用户点击采纳即显式确认，拒绝和重复确认保持幂等；旧 `reviews:applyAdjustments` IPC、preload 和 AppService 直写入口已删除，Store 更新方法仅作为 confirmProposal 内部实现。

验收：拒绝 proposal 不改变正式计划；接受时保存来源、原因、before/after 快照和影响范围。

#### T3 计划版本读取与已执行内容锁定

状态：`completed`

目标：补齐 `plan_versions` 读取和变更审计，保证已执行学习日不可覆盖。

完成结果：`getPlanVersionsForGoal` 已实现；ReviewPage"计划变更历史"卡片展示版本列表；locked ShortPlanDay 不被覆盖。

验收：可以查看计划变更历史；locked 或已执行 ShortPlanDay 不被后续生成修改。

### Phase C：有界上下文

#### C1 全核心操作上下文规格

状态：`completed`

目标：为 Roadmap、Short Plan、Daily Guide、教学、答疑、评价、复盘和滚动计划分别定义必须、可选和禁止字段。

完成结果：Roadmap、Short Plan、Daily Guide、教学、答疑、评价、Review 和 Rolling Plan 均通过 ContextBuilder 读取确认事实和冲突结果；extra 使用 operation 白名单；全部字段追加后执行 `OPERATION_BUDGET_TOKENS = 4000` 整体硬上限；实际来源 ID 写入 AI Review 调用证据。

验收：Prompt 大小不随完整历史无限增长，每次调用可解释读取来源。

#### C2 上下文冲突仲裁

状态：`completed`

目标：从"检测冲突"推进到确定性仲裁。

完成结果：确认事实、连续评价、旧目标描述和单次评价按确定性优先级仲裁；同键冲突显式输出采用值与原因。全局事实跨目标共享，目标事实隔离，任务事实通过 `task_id` 只影响绑定的 DailyGuideTask；无法绑定的任务事实拒绝保存。

默认规则：

- 用户最后一次明确确认优先。
- 实际提交和连续评价优先于旧画像。
- 单次 AI 判断不能永久改变用户能力事实。
- 无法安全仲裁时显式保留冲突，不静默选择。

#### C3 摘要失败和来源追踪

状态：`completed`

目标：摘要失败时保留原始数据并标记 pending/failed，不退化为发送完整历史。

完成结果：上下文实际使用字段记录 `current/stale` 和来源 ID；AI Review 摘要使用 `learning_summaries` 持久保存 pending/ready/failed 生命周期，失败仅保存错误类别并保留数据库原始学习记录，重试创建新尝试且不发送完整历史。

### Phase K：知识证据闭环

#### K1 知识项来源证据

状态：`completed`

目标：每个 misconception、weakness、insight 和 correction 都能追溯到 Submission、Evaluation、Task 和时间。

#### K2 重复误区聚合与复习触发

状态：`completed`

目标：同类误区累计出现后进入复习候选，并影响后续 Daily Guide。

#### K3 重新验证与掌握状态更新

状态：`completed`

目标：后续提交验证通过后再更新知识状态，不能因一次 AI 判断永久标记 mastered。

### Phase U：长期体验

#### U1 待处理中心

状态：`completed`

目标：Today 集中展示待评价、待重试生成和待确认计划调整。

完成结果：Today 页"待处理"卡片展示 draft Guide / pendingEvaluations / pendingAdjustment，提供快捷跳转。

#### U2 学习时间线和计划差异

状态：`in_progress`

目标：Review 可查看任务、Session、提交、评价、复盘及计划调整前后差异。

当前结果：Review 页已展示任务完成、累计时间和复盘事件；Session、Submission、Evaluation 和 Plan Change 的统一事件投影尚未接入。

#### U3 知识库使用体验

状态：`completed`

目标：支持按目标、状态、类型和出现次数查看知识项及来源证据。

完成结果：Review 页知识库卡片支持状态筛选（活跃/已解决/全部）、类型标签颜色区分、按出现次数排序、来源证据显示、已解决项虚线边框。

#### U4 本地数据导出和恢复说明

状态：`in_progress`

目标：提供可理解的本地数据导出、备份边界和恢复说明。

当前结果：完整 JSON 导出和 Settings 下载已完成；导入校验、版本兼容、冲突处理和恢复演练尚未完成。

### Phase Q：兼容收敛与发布质量

#### Q1 Session 锚点收敛

状态：`pending`

目标：新 Session 完全以 `daily_guide_tasks` 为正式锚点，旧 block 仅用于历史兼容。

#### Q2 旧数据迁移和 migration 噪声治理

状态：`completed`

目标：在不删除用户数据的前提下验证旧库迁移，并消除 bootstrap 与 migration 重复产生的跳过噪声。

完成结果：全新库只预登记 bootstrap 已真实覆盖的 6 个加列 migration，其余历史 migration 正常执行；已有库严格执行缺失 migration，失败不再被吞掉。已建立空库、旧库补最后一版 migration、已升级库重复启动测试，均校验数据保留和 `foreign_key_check`，全量测试不再输出 duplicate-column 日志。

#### Q3 端到端与真实模型验收

状态：`pending`

覆盖：短目标、长目标、失败重试、应用重启、跨日推进和等待评价恢复。真实 DeepSeek 合约测试保持 opt-in。

## 5. 推荐执行顺序

已完成：R1~R4、T3、C1~C3、K1~K3、U1、U3、Q2，以及各 Module 基础迁入。T1、T2、U2、U4 仍按 2026-07-12 产品审查保持 `in_progress`。

剩余：

```text
Q1  Session 锚点收敛（旧 block 数据结构最终清理）
Q3 / P7  14 天/30 Session 真实 DeepSeek 连续验收（opt-in）
→ 旧数据结构最终清理
→ 知识流重试机制
→ promote_task UI 入口补充
```

Q 类测试和迁移检查可以随对应 Step 提前补齐，但不得为了清理旧结构而越过数据兼容设计。

## 6. 每个 Step 的完成协议

一个 Step 只有在以下条件全部满足时才能标记 `completed`：

1. 用户可感知行为已经实现。
2. 数据事实源和状态转换明确。
3. AI 或数据库失败时不会丢失正式数据。
4. 应用重启后存在恢复路径。
5. 重复点击或网络重试不会重复写入。
6. Renderer 仅通过 typed preload API 使用能力。
7. 相关测试、typecheck 和按风险需要的 build 已通过。
8. `docs/PROJECT_MEMORY.md` 已记录有意义的行为或架构变化。

## 7. 暂不推进

- 不为凑数量增加多个自治 Agent。
- 不引入 CrewAI、LangGraph 等 Agent 框架。
- 不在证据数据稳定前引入向量数据库或复杂 RAG。
- 不做脱离真实提交与评价的复杂用户画像。
- 不同时全面重构数据库、业务状态机和 UI。
- 不让 AI 未经确认直接修改正式计划。
- 不在完成迁移验证前删除旧表或用户数据。
