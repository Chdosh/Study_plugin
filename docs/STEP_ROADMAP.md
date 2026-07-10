# 项目 Step 推进计划

状态：ACTIVE  
更新日期：2026-07-10  
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
- ContextBuilder 已有字段白名单、字段截断和来源 ID；稳定的 operation token 硬预算仍需在 C1 补齐。
- 计划调整、计划快照和知识项的部分基础能力。

当前主要风险：

- 提交评价恢复入口已完成；Evaluation、Decision 和状态推进仍需在 T1 收敛为完整事务边界。
- Daily Guide 失败状态和 UI 重试已完成，R2 还需补显式 draft Guide 持久态。
- 学习日日期已统一为本地日期；后续日期相关改动必须继续复用共享函数。
- 计划快照已有写入，但版本读取、差异展示和完整审计不足。
- 上下文冲突主要是检测，仲裁规则不完整。
- 知识项已具备证据、聚合、复习候选和重新验证基础，长期掌握度策略仍可继续深化。
- 旧 block/step 数据仍承担部分 Session 兼容职责。
- 测试初始化存在 migration duplicate-column 跳过日志，迁移事实源需要收敛。

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

状态：`in_progress`

目标：目标学习日激活后，生成失败不会跳日、覆盖历史或退回访谈。

当前进展：已修复“active ShortPlanDay + 无新 Guide”被误判为 `plan_exhausted` 的问题；Today 会展示 `generation_failed` 和显式重试入口，重启后显式重试会清理旧进程遗留的生成锁并复用原学习单元。剩余工作是把待生成状态显式落到 draft Guide，而不只依赖 active ShortPlanDay + 失败 AI Review 推导。

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

状态：`pending`

目标：应用启动时识别并安全处理 runtime、Session、Task、Action 和 Guide 的不一致。

实现范围：

1. 检查持久化运行指针和正式数据是否一致。
2. 仅自动修复可以唯一推导的指针。
3. 无法推导时返回结构化冲突，不删除或推进学习数据。
4. UI 提供明确恢复选择。

验收：代表性中断状态均能恢复或给出明确阻断原因。

### Phase T：AI 事务边界

#### T1 核心 AI 操作生命周期统一

状态：`pending`

目标：逐步让核心 AI 操作遵循 `prepare → context → invoke → normalize → validate → review → propose/apply` 生命周期，不建立庞大 Orchestrator。

验收：核心操作使用统一错误语义、trace、prompt/schema 版本和上下文来源记录。

#### T2 计划变更 Proposal / Apply 分离

状态：`pending`

目标：AI 只能提出计划变化，用户确认后才能事务应用。

验收：拒绝 proposal 不改变正式计划；接受时保存来源、原因、before/after 快照和影响范围。

#### T3 计划版本读取与已执行内容锁定

状态：`pending`

目标：补齐 `plan_versions` 读取和变更审计，保证已执行学习日不可覆盖。

验收：可以查看计划变更历史；locked 或已执行 ShortPlanDay 不被后续生成修改。

### Phase C：有界上下文

#### C1 全核心操作上下文规格

状态：`pending`

目标：为 Roadmap、Short Plan、Daily Guide、教学、答疑、评价、复盘和滚动计划分别定义必须、可选和禁止字段。

验收：Prompt 大小不随完整历史无限增长，每次调用可解释读取来源。

#### C2 上下文冲突仲裁

状态：`pending`

目标：从“检测冲突”推进到确定性仲裁。

默认规则：

- 用户最后一次明确确认优先。
- 实际提交和连续评价优先于旧画像。
- 单次 AI 判断不能永久改变用户能力事实。
- 无法安全仲裁时显式保留冲突，不静默选择。

#### C3 摘要失败和来源追踪

状态：`pending`

目标：摘要失败时保留原始数据并标记 pending/failed，不退化为发送完整历史。

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

状态：`pending`

目标：Today 集中展示待评价、待重试生成和待确认计划调整。

#### U2 学习时间线和计划差异

状态：`pending`

目标：Review 可查看任务、Session、提交、评价、复盘及计划调整前后差异。

#### U3 知识库使用体验

状态：`pending`

目标：支持按目标、状态、类型和出现次数查看知识项及来源证据。

#### U4 本地数据导出和恢复说明

状态：`pending`

目标：提供可理解的本地数据导出、备份边界和恢复说明。

### Phase Q：兼容收敛与发布质量

#### Q1 Session 锚点收敛

状态：`pending`

目标：新 Session 完全以 `daily_guide_tasks` 为正式锚点，旧 block 仅用于历史兼容。

#### Q2 旧数据迁移和 migration 噪声治理

状态：`pending`

目标：在不删除用户数据的前提下验证旧库迁移，并消除 bootstrap 与 migration 重复产生的跳过噪声。

#### Q3 端到端与真实模型验收

状态：`pending`

覆盖：短目标、长目标、失败重试、应用重启、跨日推进和等待评价恢复。真实 DeepSeek 合约测试保持 opt-in。

## 5. 推荐执行顺序

```text
R1 → R2 → R3 → R4
→ T1 → T2 → T3
→ C1 → C2 → C3
→ K1 → K2 → K3
→ U1 → U2 → U3 → U4
→ Q1 → Q2 → Q3
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
