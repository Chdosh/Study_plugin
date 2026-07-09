# 项目记忆

本文件是新对话的短交接入口。完整历史已归档到 `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md`，除非需要追溯旧决策，否则不要读取归档文件。

## 当前状态

* 项目是本地优先 Windows 桌面 AI 学习系统，当前 MVP 已收敛到“主动访谈 + 分层计划 + 主任务制今日执行稿”的渐进式 AI 学习导师闭环。
* 当前实现使用 Electron + React + TypeScript，主进程服务编排业务，Renderer 通过 typed preload API 调用 IPC。
* 持久化使用本地 SQLite/libSQL 文件：`app.getPath('userData')/study-supervisor.db`，Drizzle schema 在 `src/main/db/schema.ts`。
* AI 调用使用 OpenAI-compatible DeepSeek 配置，所有结构化输出必须经过 Zod/schema 校验。
* 默认自动回归使用 fake AI GUI smoke；完整真实 `--real-ai` GUI 流程是非阻塞人工验收，不作为自动 PASS 门槛。

## 当前主流程

```text
AI 主动访谈澄清目标
→ 用户确认目标理解
→ AI 依次生成长期大纲、前三天短期计划、第一天主任务执行稿
→ 用户确认今日执行稿
→ Today 聚焦当前主任务，其他主任务默认折叠
→ 开始 Focus Session
→ 后续接入提问、主任务最终提交、一次评估、复盘调整
```

当前新闭环使用 `goal_intakes`、`roadmap_stages`、`short_plan_days`、`daily_guides`、`daily_guide_tasks`、`daily_guide_actions` 保存访谈、长期大纲、短期计划、今日主任务和执行动作。`daily_plan_blocks` / `daily_guide_blocks` 暂时保留为旧版兼容和 session 锚点，不再代表固定 10 分钟任务块。

## 上下文管理

`src/main/services/context-builder.ts` 是 AI 上下文入口。它按操作类型读取当前快照，只包含当前 goal/stage/task/block/step、最近最多 3 条步骤摘要、当前问题分支最后几条消息、最新提交/评估/决策和 pending adjustment。

不得退回到“把完整聊天历史发送给模型”的实现。完整历史可以存在数据库中，但模型只接收当前操作需要的工作上下文。

## 关键决策

* SQLite 是 durable source of truth；schema 变更必须使用迁移。
* AI 输出只是 proposal，验证并在必要时经用户确认后才能影响计划或持久状态。
* 问题分支不能替换当前学习步骤；解决后必须能回到原步骤。
* 用户提交主任务最终结果后必须先评估；当前主流程不再固定调用 `next_step_decision`，而是由本地状态机根据一次 `evaluate_submission` 输出决定通过、继续修改、保存进度或进入下一任务。
* DeepSeek 真实合约测试为 opt-in：`RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts`。
* 不根据单次真实模型输出继续修改测试答案、schema 或业务 prompt。

## 最近完成

### 2026-07-04 主任务制每日计划与计时流程

每日执行稿从固定 10 分钟 block 改为“任务决定时长”的主任务结构。`daily_guide` 现在输出 2～4 个主任务，每个任务包含动态 `estimatedMinutes.min/target/max`、3～6 个 Action、本地 Checkpoint、最终 deliverable、doneWhen、evaluationMode、submissionPolicy 和 carryoverAllowed。新增 `daily_guide_tasks`、`daily_guide_actions` 表和迁移；旧 `daily_plan_blocks` / `daily_guide_blocks` 不删除，作为 legacy session 锚点继续兼容悬浮窗和现有计时路径。

关键决策：Focus Session 的开始、暂停、恢复、结束和超时只写本地记录，不触发 AI。主任务最终提交后，`evaluationMode=ai` 只调用一次 `evaluate_submission`，`evaluationMode=local` 走本地验证器；不再固定调用 `decide_next_step`。评估通过时本地状态机标记任务完成，未通过时保留当前任务为 needs_revision 并保存 nextStartPoint。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：29 passed，1 skipped。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 主闭环完成主动访谈、生成主任务执行稿、确认并开始、结束 Focus Session 和重启恢复；结束 Focus Session 后任务保持 active，不自动完成。

### 2026-07-04 窗口化响应式排版修复

修复窗口化应用中左侧导航文字与图标挤压、栏目不能随窗口宽度调整、主动访谈对话框占比过大的问题。新增 renderer 末尾窗口化稳定覆盖层：1439px 以下侧栏固定为窄图标栏并强制隐藏品牌/导航文字；1280px 以下主动访谈从主区 + 摘要双列切换为单列；访谈聊天面板高度和气泡宽度改为 viewport clamp，避免空对话框占据整屏。

关键决策：本轮只修改 `src/renderer/src/styles.css` 的响应式覆盖，不修改 React 组件结构、业务逻辑、IPC、SQLite schema 或 AI 数据流。保留参考图视觉语言，但优先保证窗口化可读性和无横向溢出。

验证：

* `npm.cmd run build` 通过。
* `npm.cmd test` 通过：29 passed，1 skipped。
* `node scripts/electron-gui-smoke.mjs` 通过。
* Electron/CDP 临时检查：1418px 宽度下侧栏 82px、品牌文字 `display: none`、导航文字 `font-size: 0px`、无横向溢出；主动访谈为 908px + 320px 双列，聊天面板高约 520px；1180px 和 900px 下自动单列且无横向溢出。

### 2026-07-04 参考图 UI 全方位复刻

基于用户最新提供的 Today、主动访谈、学习、复盘和悬浮窗 5 张参考图，对当前业务 UI 做进一步视觉复刻和交互对齐。Today 强化“当前任务”唯一视觉中心，右侧辅助栏聚焦进度、验收、边界；主动访谈改为更接近参考图的对话工作区、底部固定输入和右侧目标理解摘要；学习页收敛为顶部 session bar、当前步骤主面板、步骤列表和右侧 AI 助手；复盘页按“完成情况 -> 结果概览 -> AI 评估 -> 调整建议 -> 明日预告”组织；悬浮窗按约 420x56 / 420x300 复刻并持久化展开状态。

关键决策：参考图中的说明箭头、虚线和标注属于设计讲解，不进入生产 UI。用户可见界面复用现有真实数据流和 typed preload API，不创建静态 mock，不修改 SQLite schema、AI schema、IPC 通道或底层学习流程。本轮仅为 smoke 补充等待“确认并开始”按钮实际渲染的条件，避免 React 刷新时序造成误报。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：29 passed，1 skipped。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 主闭环完成主动访谈、生成执行稿、确认并开始、进入学习、结束当前块和重启恢复。
* 已新增 `design-qa.md` 记录参考图、实现截图路径、视觉差异和 QA 结论。

### 2026-07-04 字体层级与窗口适配修复

针对窗口化后左侧导航栏品牌文案被挤压成竖排、全局字号偏大、字重层级不统一、学习页长文本在中窄窗口下显得拥挤的问题，新增 renderer 末尾覆盖样式。统一将基础字号收敛到 11/12/13/15/17/21/28px 层级，字重收敛到 500/600/650/700；中窄窗口下侧栏只保留图标并隐藏品牌文字，主内容与右侧辅助栏在 1180px 以下改为单列，任务详情在 960px 以下自动堆叠，避免文本强行挤在三列中。

关键决策：本轮只修改 CSS 响应式和 typography token，不修改 React 业务逻辑、IPC、SQLite schema、AI schema 或计划/session 数据流。`docs/UI_GUIDELINES.md` 继续作为当前业务 UI 和交互重构的活跃专题文档。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：29 passed，1 skipped。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过。
* 临时 Electron viewport 检查 1080px：侧栏品牌文字 `display: none`，导航文字字号 `0px`，页面标题 `28px`，无水平溢出。

### 2026-07-04 主界面 UI 重绘落地

基于 `docs/UI_GUIDELINES.md` 和 5 张参考图，重绘了当前业务 UI：主动访谈改为左侧聊天工作区 + 右侧目标理解摘要；Today 改为“今日目标 / 当前任务 / 右侧辅助栏”的主辅结构，并将“确认今日执行稿 + 开始”合并为“确认并开始”；学习页改为顶部固定 Session Bar、当前步骤主面板、纵向步骤进度和右侧 AI 提问/提交侧栏；复盘页改为完成情况、AI 评估、调整 proposal、明日预告的流程式布局；悬浮窗改为默认约 420×56 的紧凑状态，展开后显示当前步骤、操作摘要、完成标准和快捷操作。

关键决策：本轮只改 UI 结构、交互入口和 smoke 断言，不修改 SQLite schema、IPC 通道、AI schema 或底层业务服务。`确认并开始` 会先进入学习页再启动 session，避免用户确认计划后停留在无关页面。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：29 passed，1 skipped。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 主闭环完成主动访谈、生成执行稿、确认并开始、进入学习、结束当前块和重启恢复。

### 2026-07-04 UI 指南结构化更新

`docs/UI_GUIDELINES.md` 已整理为当前业务 UI 和交互重构的活跃专题文档，明确其优先级高于历史参考性质的 `docs/UI_SYSTEM.md`。本轮将新的 UI 修改意见合并为正式规范，覆盖当前任务视觉中心、全局布局断点、今日页、学习页、悬浮窗、主动访谈页、Design Token 和 P0/P1/P2 实施顺序。

关键决策：UI 重构优先解决信息层级、页面职责和用户下一步行动，不优先通过配色、圆角、阴影或装饰提升来掩盖结构问题。

验证：已读取 `docs/README.md`、`docs/UI_SYSTEM.md`、`docs/UI_GUIDELINES.md` 和本文件，确认 `UI_GUIDELINES.md` 是活跃专题文档，`UI_SYSTEM.md` 是历史参考文档。本轮未修改产品代码、配置、依赖、数据库、测试代码或业务行为。

### 2026-07-04 今日中途结束与归档重开

Today 当前任务增加“结束本次”按钮，语义为结束本次专注但不判定任务完成，底层复用现有 `pauseSession`，保留当前任务主线。Today 侧栏增加“归档计划，重新开始”，通过新增 `guides.archiveTodayAndRestart()` 将当天 `daily_guides` 和 `daily_plans` 标记为 `archived`，不删除用户数据，并创建新的主动访谈 intake。`listTodayGuide` 现在跳过 archived guide，避免归档后继续显示旧执行稿。

关键决策：本轮不做“硬删除所有计划”，只做可恢复归档；旧 `daily_plan_blocks` 仍被 session 执行映射依赖，不能直接删除。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test -- src/main/services/app-service.test.ts` 通过：新增归档重开服务测试。
* `npm.cmd test` 通过：29 passed，1 skipped（真实 DeepSeek 合约测试默认跳过）。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 主闭环未被新增按钮打断。

### 2026-07-04 复盘回流与访谈可读性优化

复盘页不再跳转到旧 Plan 页面，底部行动统一回到 Today 执行稿。Renderer 中已移除可访问的 `plan` / `knowledge` 视图、旧 `PlanView` 和旧 `KnowledgeView` 组件；但底层 `plans.*` IPC、旧 `daily_plans` / `daily_plan_blocks` 表和相关服务仍保留，因为当前 `daily_guide_blocks` 仍映射到旧 plan block 来复用 session 计时和完成状态。

主动访谈消息改为对话气泡展示，AI 回复支持逐字出现，等待模型返回时显示三点加载动画；消息内容只做轻量段落和列表排版，不引入完整 Markdown 渲染器或新依赖。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：28 passed，1 skipped（真实 DeepSeek 合约测试默认跳过）。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 下完成主动访谈、生成执行稿、折叠预览、开始/完成当前块和重启恢复。

### 2026-07-03 主动访谈到今日执行稿闭环

新增主动目标访谈、目标理解确认、分层计划生成和 Today 聚焦执行稿。AI 操作拆分为 `goal_intake`、`roadmap`、`short_plan`、`daily_guide`，每一步都有 Zod schema 校验和 `ai_reviews` 记录。新增 `onboarding.*` 与 `guides.*` typed preload API。Today 首屏在没有执行稿时展示自然对话访谈；有执行稿时顶部显示“目标 → 当前阶段 → 本周重点 → 今天 → 当前任务”，当前任务完整展开，其他任务默认只显示时间、标题、状态和预计时长，点击仅临时预览，不切换当前任务。旧 Plan 和 Knowledge 已从主导航移除，但旧代码和旧表本轮未破坏性删除。

验证：

* `npm.cmd run typecheck` 通过。
* `npm.cmd test` 通过：28 passed，1 skipped（真实 DeepSeek 合约测试默认跳过）。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：fake AI 下完成主动访谈、目标确认、分层计划、今日执行稿确认、折叠预览、开始/完成当前块和重启恢复。

### 2026-07-03 文档交接精简

将 `docs/PROJECT_MEMORY.md` 从完整历史日志压缩为当前交接摘要，并把原完整内容归档到 `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md`。新增 `docs/README.md` 作为文档地图，区分活跃专题文档、轻量索引和历史参考文档。`docs/CONTEXT_AND_MEMORY.md` 改为索引，详细上下文规则统一指向 `docs/AI_AND_DATA_RULES.md`。`docs/ARCHITECTURE.md` 中重复的学习运行态字段改为引用 AI/data 文档。

验证：文档结构、文件存在性、行数和 diff stat 已检查；本轮未修改产品代码、配置、依赖、数据库、测试代码或业务行为。

### 2026-07-03 真实 AI 验证边界调整

停止将完整 `--real-ai` Electron 两轮流程作为自动验收门槛。`scripts/electron-gui-smoke.mjs` 保持确定性 fake AI 主回归，并删除针对具体题目和具体答案的硬编码分支。新增独立 DeepSeek 合约测试，默认跳过，只在显式环境变量下调用一次真实 evaluation。

验证：

* `npm.cmd test -- src/main/ai/ai-client.test.ts src/main/ai/deepseek-contract.test.ts src/main/ai/normalize-plan.test.ts src/shared/schemas.test.ts` 通过，真实合约测试默认跳过。
* `npm.cmd run build` 通过。
* `node scripts/electron-gui-smoke.mjs` 通过：两轮 fake AI GUI smoke、完成状态和重启恢复均通过。

### 2026-07-03 两轮 GUI 主流程与重启恢复

默认 fake GUI smoke 覆盖真实 Electron renderer、preload、IPC、AppService、ContextBuilder 和 SQLite 路径：创建目标、生成阶段、确认计划、学习、提问、提交、评估、结算、Review 接受调整、第二轮计划和 session、重启恢复。

## 当前风险

* 真实 DeepSeek 完整两轮 GUI 流程尚未作为自动测试运行；当前策略是先跑单次合约测试，再人工验收完整流程。
* Today 新闭环已接入开始/完成 session，但提问、提交评估、下一步建议、复盘调整和长文本切割尚未接回新 `daily_guide_block` 主流程。
* 旧 Plan 页面 UI 已从 renderer 删除，但底层旧 plan 数据结构仍是 session 复用路径的一部分；后续清理必须先替换 `daily_guide_block -> daily_plan_block` 的执行映射。
* `docs/` 中仍保留若干旧产品/UI设计文档，作为历史参考而非当前默认规范。新任务优先读取 `AGENTS.md` 映射的专题文档。
* `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md` 是完整历史归档，内容可能包含过时测试输出和旧 UI 状态。

## 推荐下一步

1. 下一步优先把提问、提交评估、下一步建议接到当前 `daily_guide_block`，注意问题分支不能替代当前主线。
2. 再接入复盘调整和长文本切割保存。
3. 新功能开发前读取 `AGENTS.md`、本文件和对应专题文档。
4. 完成有意义任务后，只把新的当前事实和关键决策追加到本文件；大段日志放入归档或具体报告，不再膨胀本入口文件。
