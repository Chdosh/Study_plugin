# 架构、数据与兼容规则

状态：CURRENT
生效日期：2026-07-13
适用范围：架构、IPC、Module、Store、数据库、迁移、AI、上下文、安全和旧命名任务。
失效条件：技术栈、主链 owner 或数据模型经用户确认发生变化。

## 1. 技术栈和依赖方向

当前技术栈以 `package.json`、lockfile 和代码为准：

* Electron + React + TypeScript
* SQLite/libSQL + Drizzle ORM
* OpenAI-compatible DeepSeek client
* Zod runtime validation
* typed preload API + narrow IPC
* Vitest

推荐依赖方向：

```text
Renderer
→ typed preload / narrow IPC
→ AppService
→ Runtime / Planning / Context / Branch modules
→ StudyStore facade / persistence modules
→ CurrentLearningContextPersistence
→ SQLite
```

## 2. 职责边界

* Renderer：展示状态、收集操作，不编排持久化流程。
* AppService：应用层适配、Electron 行为、AI 协调和错误映射，不复制 Store 状态机。
* Runtime module：Session、Action、Task 执行命令。
* Planning module：学习单元准备、计划推进、生成失败恢复和计划版本。
* Context module / ContextBuilder：按操作构建最小 AI 上下文、处理学习事实和知识结果，不能推进学习位置。
* Branch module：问题分支打开、追加、解决和返回主线。
* Store persistence：事务、查询和持久状态变化。
* CurrentLearningContextPersistence：当前学习位置解析、冲突候选和可唯一推导的恢复。

同一用例出现多个入口时先确定 owner，其他层只做薄适配。禁止在 Renderer、AppService、Module 和 Store 各维护相似编排。

## 3. 当前主流程数据

新增功能优先映射到：

```text
goals
goal_intakes / goal_intake_messages
roadmap_stages
short_plan_days
daily_guides
daily_guide_tasks
daily_guide_actions
study_sessions
learning_runtime_states
question_threads / question_messages
learning_submissions / learning_evaluations
knowledge_items / learner_facts
plan_adjustment_proposals / plan_versions
ai_reviews
```

不要为了名称理想化重复建表。

## 4. 历史兼容结构

以下结构仍可能被 schema、导出、迁移或兼容路径引用，但不能重新成为新流程中心：

```text
task_items
plan_stages
daily_plans
daily_plan_blocks
daily_guide_blocks
learning_steps
旧 block/step 锚点字段
```

* 新 Task/Action/Session 功能不得重新使用旧 block/step 产品语义。
* 删除旧结构前必须区分兼容写入、导出、迁移和实际主链。
* 清理必须包含读写者清单、历史数据迁移、回滚和验证方案。
* `defaultBlockMinutes`、`getAccumulatedSeconds` 等旧名称不能作为恢复固定 Time Block 的理由。

## 5. 当前命名债

* `TodayPage.tsx` 当前导出 `OverviewPage`；旧文件名不代表恢复 Today 页面。
* `ReviewResult` 和 review service 是业务能力；复盘由记录体系承载，不代表需要全局 Review 页面。
* `today.css`、`review.css`、`layout-v2.css` 等文件名不是信息架构事实源。
* `StudyStore` 是兼容门面；新持久化逻辑进入实际 owner 模块，不继续扩大门面。
* `CurrentLearningContextPersistence` 是 Goal、Guide、Task、Action 和可恢复 Session 的统一解析 seam；其他模块不得重新按时间或局部指针推导 Current Guide。

不做孤立的机械重命名。重命名必须同时更新调用、类型、测试和必要兼容说明。

## 6. 数据和迁移

* SQLite 是 durable source of truth。
* schema 修改必须使用迁移，不得只靠启动时 ad hoc SQL。
* 未经用户明确批准，不删除表、列或用户数据。
* 真实数据修复前先备份，并说明状态变化。
* 自动修复只处理可唯一推导状态；多种合理选择必须保留数据并让用户选择。
* 计划、提交、评价和历史必须可追溯，不能静默覆盖。
* 核心动作必须处理双击、IPC 重复、网络重试、应用中断和启动恢复。

## 7. AI 和上下文

每个 AI 操作必须有明确输入、输出 schema、上下文来源、预算、失败状态和重试策略。

* 不发送完整用户历史。
* 只发送当前操作必要的目标、计划、Task、Action、最近证据和相关知识。
* 用户确认、系统实际行为和原始提交高于摘要与 AI 推断。
* 结构化输出使用 Zod 或等价运行时校验。
* 不通过放宽必填字段或编造关键字段掩盖模型失败。
* AI 请求不长时间占用数据库事务。
* 提交先保存；评价成功后再事务性应用业务状态。

## 8. Electron 和隐私

* Renderer 不直接访问数据库、Node 文件系统、safeStorage、API key 或监控 API。
* IPC 必须窄、可枚举、类型化并校验输入。
* 不暴露通用 shell、通用文件系统或动态 IPC。
* secret 不进入日志、错误、AI 审计或数据库快照。
* 不自动执行 AI 代码或命令。
* 不实现截图、录屏、键盘记录、剪贴板监听、麦克风/摄像头采集、完整浏览历史、私信收集、强制锁屏或隐藏监控。
