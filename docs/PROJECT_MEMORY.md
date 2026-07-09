# 项目记忆

本文件是新对话的短交接入口，不是完整日志。完整早期历史已归档到 `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md`；除非追溯旧决策，否则不要读取归档。

## 当前状态

* 项目是本地优先 Windows 桌面 AI 学习系统，当前 MVP 已收敛为“主动访谈 -> 分层计划 -> 主任务制 Daily Guide -> Focus Session -> 主任务最终提交/评估 -> 按需复盘”的学习闭环。
* 技术栈：Electron + React + TypeScript，SQLite/libSQL + Drizzle ORM，OpenAI-compatible DeepSeek client，Zod runtime validation，typed preload API + narrow IPC。
* SQLite 是 durable source of truth。Drizzle schema 在 `src/main/db/schema.ts`，schema 变更必须使用迁移。
* 默认自动回归使用 fake AI GUI smoke；真实 DeepSeek 合约测试是 opt-in，不作为默认自动 PASS 门槛。

## 当前主流程

```text
AI 主动访谈澄清目标
→ 用户确认目标理解
→ AI 生成长期大纲、前三天短期计划、第一天主任务执行稿
→ 用户在 Today 查看进度、知识库并管理今日计划
→ 用户在 Study 开始当前主任务并开启 Focus Session
→ Action / Checkpoint 本地记录执行进度
→ 主任务最终提交并同步结束当前计时
→ local 任务走本地验证器，ai 任务最多调用一次 evaluate_submission
→ 本地状态机决定完成、继续修改、保存进度或进入下一任务
→ 用户进入 Review 复盘，并由用户确认调整建议
```

当前新闭环使用 `goal_intakes`、`roadmap_stages`、`short_plan_days`、`daily_guides`、`daily_guide_tasks`、`daily_guide_actions` 保存访谈、长期大纲、短期计划、今日主任务和执行动作。`daily_plan_blocks` / `daily_guide_blocks` 暂时保留为旧版兼容和 session 锚点，不再代表固定 10 分钟任务块，不能直接删除。

## 上下文管理

`src/main/services/context-builder.ts` 是 AI 上下文入口。它按操作类型读取当前快照，只包含当前 goal/stage/task/block/step、最近最多 3 条步骤摘要、当前问题分支最后几条消息、最新提交/评估/决策和 pending adjustment。

不得退回到“把完整聊天历史发送给模型”的实现。完整历史可以存在数据库中，但模型只接收当前操作需要的工作上下文。

## 关键决策

* AI 输出只是 proposal，验证并在必要时经用户确认后才能影响计划或持久状态。
* Daily Guide 输出少量主任务，不输出固定 Time Block。主任务通常 2～4 个，默认优先 3 个；复杂或时间少时可以只有 1 个。
* 当前实现为真实模型稳定性允许每个主任务至少 1 个 Action；prompt 鼓励 3～6 个 Action。
* 当前 MVP 中 Focus Session 跟随主任务：Study 页开始任务时启动计时，暂停/恢复只改变当前任务计时状态，主任务提交评价通过后同步结束当前计时；不提供独立“结束计时/结束学习”主操作。
* 当前 MVP 不提供独立学习浮窗、托盘学习入口、托盘复盘入口、页面内互跳按钮或 renderer 公开的 `sessions.complete` 控制；页面切换由全局导航负责。
* 主任务是唯一最终提交和评估单位。`evaluationMode=local` 不调用模型；`evaluationMode=ai` 最多调用一次 `evaluate_submission`。
* 当前主流程不再固定调用 `decide_next_step` / `next_step_decision`；本地状态机根据评估结果决定通过、继续修改、保存进度或进入下一任务。
* 复盘按主任务汇总，由用户进入 Review 后生成或查看；同一天如进行综合复盘最多一次。未完成任务可在复盘中建议继续、缩小、拆分、延后或放弃，但必须由用户确认。
* DeepSeek 真实合约测试为 opt-in：`RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts`。

## 最近完成

### 2026-07-06 架构收敛审查高风险修复

根据最新架构收敛审查修复两个高风险断点：初始分层计划写入 `short_plan_days` 时补齐 `roadmap_stage_id`，与首批 `daily_guide_tasks.roadmap_stage_id` 一致，避免初始批次完成后 roadmap 推进链路断裂；`startNextSession()` 在关闭 active guide 前增加任务完成校验，非 UI / IPC 调用也不能提前关闭未完成 guide。

同时收敛一处状态判断重复：`getTodayState()` 在 closed/completed guide 且无可用 pending short plan day 时返回 `plan_exhausted`，TodayPage 改为消费 `todayState === 'plan_exhausted'` 展示“生成下一批任务”，不再自行计算批次耗尽。新增回归测试覆盖首批 short plan day stage 关联和未完成 guide 禁止推进。

验证：`npm run typecheck` 通过；`npm test` 通过（73 passed, 6 skipped）；`npm run build` 通过。测试日志仍有已知 migration duplicate column 跳过噪声，未在本轮处理。

### 2026-07-06 修复下一学习日推进与复盘显示

修复第一轮代码审核发现的状态流问题：`listTodayGuide()` 现在返回完整 `TodayGuideState.todayState`；`startNextSession()` 在 guide 已关闭时也会复用或生成复盘，再生成下一学习日；下一学习日选择改为按 Product Truth 使用 `date === null` 且 `dayIndex` 最小的 pending short plan day，激活时写入实际日期，避免误选已有 guide 的 short plan day 并触发唯一约束错误。

Renderer 侧改为读取 `roadmap_stages.status` 渲染学习路径状态，新增 `reviews.getLatest` IPC 用于恢复最近复盘；开启下一天后保留旧 guide snapshot 给 Review 页面，避免旧复盘摘要和新 guide 任务统计混显示。新增 app-service 测试覆盖“closed guide -> 自动复盘 -> 新 daily guide active -> 最新复盘可读取”。

修改范围：`src/main/services/app-service.ts`、`src/main/services/store.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/shared/ipc.ts`、`src/shared/types.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/pages/TodayPage.tsx`、`src/renderer/src/pages/ReviewPage.tsx`、`src/main/services/app-service.test.ts`。

验证：`npm run typecheck` 通过；`npx vitest run src/main/services/app-service.test.ts` 通过（14 passed）；`npm test` 通过（63 passed, 6 skipped）；`npm run build` 通过。

### 2026-07-06 落地 Phase 1 Step 1.3：错误分类 + UI 差异化文案

新增 `src/main/ai/categorized-error.ts`，定义 `CategorizedError` 与 `AppErrorCategory`（`user_input_error` / `ai_failure` / `schema_violation` / `db_error` / `missing_config` / `validation_error`）。`AiClient` 所有抛错路径统一抛 `CategorizedError`，`AiCallMetrics.errorCategory` 类型放宽为 `AppErrorCategory`。`agents.ts` 不感知，由 `ai-client` 自动包装。`app-service.ts` 各 AI 调用入口（`sendOnboardingMessage`、`generateLayeredPlan`、`askStepQuestion`、`submitLearningResult`）catch 后按分类重抛 `CategorizedError`，保持分类贯穿到 Renderer。`ai_reviews.error_category` enum 扩展为 6 个值。`App.tsx.toUserErrorMessage` 重写为按分类给出不同文案（missing_config 提示去设置页、schema_violation 提示格式问题、ai_failure 提示重试、user_input_error 直接显示原消息等）。

首次有可视变化的应用层修改：不同类别的 AI 错误在 UI 上显示不同的友好提示，不再是统一的"生成失败"。

修改范围：`src/main/ai/categorized-error.ts`、`src/main/ai/ai-client.ts`、`src/main/services/app-service.ts`、`src/main/db/schema.ts`、`src/renderer/src/App.tsx`。

验证：typecheck / test (62 passed, 6 skipped) / build 均通过。

### 2026-07-06 落地 Phase 2 Step 2.2：持久化 generationLock

新增 `generation_locks` 表（`lock_key` / `locked_at`），对应 migration `202607060003_generation_locks`。`store.acquireGenerationLock` 先清理过期锁（默认 TTL 120s），再通过 INSERT 原子抢锁；返回 false 表示已被占用。`store.releaseGenerationLock` 删除行。`AppService.prepareCurrentLearningDay` 改为双层锁：先内存 Map 快速路径，再调 `store.acquireGenerationLock` 跨进程保护；未获锁时返回 `{ todayState: 'generating' }`。finally 中同时释放内存锁和 DB 锁。

修改范围：`src/main/db/schema.ts`、`src/main/db/migrations.ts`、`src/main/services/store.ts`、`src/main/services/app-service.ts`。

验证：typecheck / test (62 passed, 6 skipped) / build 均通过。

### 2026-07-06 继续落地 Phase 2 Step 2.1：提交评价状态显式落库

在 `learning_submissions` 表增加 `evaluation_status` 列（`waiting` / `completed` / `failed`，默认 `completed` 兼容旧数据）。新增对应 bootstrap 列定义与 drizzle 迁移（`202607060002_learning_submissions_eval_status`）。`store.createSubmission` 写入时标记 `waiting`；`store.saveEvaluationAndDecision` 成功时标记 `completed`；Agent 异常 propagate 后保留 `waiting` 状态供后续恢复。新增 `store.markSubmissionEvaluation(submissionId, status)` 工具方法可外部调用。`mapSubmission` / `mapSubmissionOld` 增加对新列的映射，缺省值 `completed`。

关键决策：列默认 `completed` 保证旧提交不被纳入等待恢复检查；只在 `saveEvaluationAndDecision` 路径统一改 `completed`，不依赖上层调用方；AI 失败时不主动更新状态，保留 `waiting` 供恢复入口识别。

修改范围：`src/main/db/schema.ts`、`src/main/db/migrations.ts`、`src/main/services/store.ts`、`src/shared/types.ts`、`src/renderer/src/bridge/mock-api.ts`。

验证：`npm run typecheck` 通过；`npm test`（62 passed, 6 skipped）通过；`npm run build` 通过。

### 2026-07-06 落地 Phase 1 Step 1.1 + 1.2：AI 调用可观测性埋点

按 `docs/v2/ANALYSIS_vs_goal.md` 的 Phase 1，在 `ai_reviews` 表中新增五个 nullable 列（`input_tokens`、`output_tokens`、`latency_ms`、`error_category`、`trace_id`），新增对应 bootstrap 列定义与 drizzle 迁移（`202607060001_ai_reviews_observability`）。`AiClient.generateJson` 接口增加 `traceId` / `onMetrics` 回调；每次调用前后记录耗时、解析输出中的 usage（如有）、按错误类型打 `error_category`（`user_input_error` / `ai_failure` / `schema_violation`）。`agents.ts` 中所有 8 个 Agent 的 `run()` 方法增加 `AgentRunExtras`（`traceId?` / `onMetrics?`）透传到 `ai.generateJson()`。`app-service.ts` 在每个 AI 调用入口生成 `ta_` 前缀的 traceId，通过 onMetrics 收集指标，传入 `store.saveAiReview`。`store.saveAiReview` 入参增加 `metrics?: AiCallMetrics`，写入 ai_reviews 对应列。

关键决策：不改变 AiClient 返回类型，通过 onMetrics 回调把指标从 AppService 传回 store；error_category 纯客户端推断（基于错误消息正则），不依赖模型输出；新列全部 nullable 保证旧库文件兼容。

修改范围：`src/main/db/schema.ts`、`src/main/db/bootstrap.ts`、`src/main/db/migrations.ts`、`src/main/ai/ai-client.ts`、`src/main/ai/agents.ts`、`src/main/services/app-service.ts`、`src/main/services/store.ts`。

验证：`npm run typecheck` 通过；`npm test`（62 passed, 6 skipped）通过；`npm run build` 通过。迁移因 bootstrap 表已含新列按既定兼容逻辑自动跳过，未报错。

待做：Phase 2 Step 2.3（重复提交防护）、Phase 3（上下文裁剪）。

### 2026-07-05 删除独立浮窗与公开结束计时通道

继续排查启动后弹出长时间计时条、复盘页疑似开始按钮和多页面互跳问题。删除独立学习浮窗的主进程窗口、renderer 入口、样式、preload `floatApp`、`float:*` IPC、浮窗位置持久化、托盘“开始当前学习块/生成今日复盘”入口，以及 `navigate:toPage` 强制导航通道。设置页删除浮窗、计时提醒、自动进入复盘等未落到真实主流程的假控制。

主任务提交评价通过后，现在由 `AppService.submitLearningResult()` 在服务层同步结束当前 Focus Session；renderer 不再暴露或调用 `sessions.complete`。Review 页删除底部“返回总览/查看全部历史”按钮，Study 页删除“返回总览/回到今日”页面互跳按钮，页面内部只保留本页职责内操作。

验证：本轮完成后已运行 typecheck、测试和 build，结果见最终回复。

### 2026-07-05 收敛页面职责并移除独立结算/结束计时

按最新要求重新划分页面职责：Today 只展示今日进度、知识库和计划管理，不再开始/暂停/继续学习，也不自动跳转 Study；Study 负责开始当前任务、暂停/继续、完成步骤、提问和提交结果；Review 只作为侧边导航中的复盘页，不再由学习流程强制弹出。

移除非导航 `settlement` View、`SettlementView` 组件和 `LocalSettlement` 类型。Study 页删除“结束计时/结束学习”入口；主任务提交评价通过后同步结束当前 Focus Session，使计时跟随任务完成，而不是成为另一条流程。更新 `docs/MVP_SPEC.md` 和 `docs/UI_GUIDELINES.md`，撤销 Today 启动任务、主动结束学习触发复盘等旧口径。

验证：本轮完成后已运行 typecheck 和相关测试，结果见最终回复。

### 2026-07-05 收敛 Focus Session 与主任务流程状态

排查并收敛主流程状态分叉：`getActiveSession()` 现在把 active 和 paused Focus Session 都视为当前可恢复会话，避免暂停后刷新或导航时主界面误判为“未开始”。主窗口收到任意 session 状态事件后都会刷新 Today Guide 与 Learning Runtime，确保状态同步到主界面。

随后一轮已继续删除 Study 页的独立“结束计时/结束学习”入口，主任务完成仍必须走“完成当前步骤/提交当前结果/评价”的主流程。同时修复 StudyPage 在无 guide 早退前后 Hook 数量变化的风险。

验证：`npm run typecheck` 通过；相关 AppService、Store、执行状态机与计时工具测试通过。

### 2026-07-05 验证标准按变更风险分级，去除自动冒烟测试

`AGENTS.md` 第 8 节验证标准从统一"跑全部检查"改为按变更类型分级的矩阵，避免改一个 CSS 也触发全量测试和冒烟。同时清除 `docs/PROJECT_MEMORY.md` 中所有 `scripts/electron-gui-smoke.mjs` 历史引用，并新增规则禁止 Agent 以历史模式自动执行已删除的脚本。

验证：`npm.cmd run typecheck` 通过。

### 2026-07-05 修复重新开始后访谈无响应

修复“重新开始新计划”后点击“发送”或“直接开始”看起来无响应、页面又回到同一开场提示的问题。根因是 `getCurrentGoalIntake()` 的兼容逻辑会把只有一条开场白的新访谈误判为空，并回退到旧的 confirmed 目标访谈，导致用户消息和 AI 回复写入旧会话，刷新后当前页面仍显示新访谈开场白。

关键决策：保留旧兼容逻辑，但只允许“更新时间不早于空访谈创建时间”的 confirmed 目标接管空访谈；显式重新开始创建的新访谈更新，必须保持为当前入口。补充 AppService 回归测试覆盖归档重启后继续发送消息。

验证：`npm.cmd test -- src/main/services/app-service.test.ts -t "archives today guide"` 先复现失败后通过；`npm.cmd test -- src/main/services/app-service.test.ts`、`npm.cmd run typecheck`、`npm.cmd run build` 均通过。

### 2026-07-05 Today 新增重新开始新计划入口

在 Today 右侧“计划管理”中新增“重新开始新计划”入口，点击后先弹窗确认，再复用现有 `guides.archiveTodayAndRestart()` 能力：归档当前今日计划、暂停正在进行的 session，并回到新的目标访谈入口。学习历史保留，不删除用户数据。

关键决策：本轮只补 UI 入口与确认弹窗，复用既有 IPC / AppService / Store 归档逻辑，不新增 schema、迁移或 AI 行为。

验证：`npm.cmd run typecheck`、`npm.cmd test -- src/main/services/app-service.test.ts`、`npm.cmd run build` 均通过。

### 2026-07-05 冗余文档与重复类型清理

按 `docs/recovery/PRODUCT_TRUTH.md` 收敛产品口径：普通今日主任务可直接开始、修改或重新生成；复盘由主任务、阶段或用户主动结束学习触发，同一天综合复盘最多一次。删除被 Product Truth、Product Spec、Architecture、AI/Data、Security、UI Guidelines 吸收的旧 V1 范围、信息架构、用户流程、线框、UI demo、旧审计、旧基线和展示原型。

代码侧删除 `schemas.ts` 中与 shared 类型重复的 `GoalBrief` 导出，把 renderer `Window` 全局声明统一到 `vite-env.d.ts`，并让 AppService 的本地提交决策复用领域状态机的 `isPassingEvaluation`。`StudyStore.completeCurrentAction` 和主任务提交后的 Daily Guide 任务推进已改为调用 `execution-state-machine`，删除 store 内重复的 Action 进度计算、Action 全完成判断和下一主任务激活函数。

验证：`npm.cmd run typecheck`、`npm.cmd test`（41 passed, 1 skipped）、`npm.cmd run build` 均通过。按用户最新要求未运行 Electron 冒烟。

### 2026-07-05 清理 renderer 层旧 block 数据结构依赖

清除 renderer UI 层对 `DailyPlanBlock` / `DailyGuideBlock` 的直接依赖。`guide-selection.ts` 不再返回 block 对象、不再依赖 block 类型；`TodayPage.tsx` 移除 `guide.blocks` 回退计算和 `otherBlocks` 无用变量；`StudyPage.tsx` 移除 `getBlockSuccessCriteria`、block 查找逻辑和 `displayBlock` 回退，改用 `task.quickHint` 替代 block fallback；`App.tsx` 移除未使用的 block 类型导入；mock 数据中 `createGuideTasks` 不再依赖 `guideBlocks` 参数。

底层 `daily_plan_blocks` 表、IPC 类型签名（`StudyAppApi.sessions.getActive` 等）和 `DailyGuide.blocks` 字段保留未动——它们是 session 锚点和 Store 数据映射的必需部分，不属于 renderer 依赖清理范围。

修改文件：
- `src/renderer/src/domain/guide-selection.ts` — 移除 block 类型、`getCurrentGuideBlock`、返回 type 中的 block
- `src/renderer/src/pages/TodayPage.tsx` — 移除 block 回退进度/总数计算和无用变量
- `src/renderer/src/pages/StudyPage.tsx` — 移除 block 查找、getBlockSuccessCriteria、displayBlock 回退
- `src/renderer/src/App.tsx` — 移除未使用的 block 类型导入
- `src/renderer/src/bridge/mock-data.ts` — createGuideTasks 改为不依赖 blocks

验证：`npm.cmd run typecheck`、`npm.cmd test`（26 passed, 1 skipped）、`npm.cmd run build` 均通过。

### 2026-07-04 新参考图四页面 UI 复刻与 CSS 清理

根据最新四张参考图，重绘 Today、Study、Review、Settings 四个页面的桌面布局。侧栏恢复品牌信息与底部学习者入口；Today 聚焦今日目标、任务列表、今日进度与最近学习；Study 聚焦会话条、当前步骤、右侧任务大纲/记录/进度与底部操作栏；Review 聚焦三项统计、学习总结、时间线、最近 7 天与问题建议；Settings 去掉已废弃的时间拆分/学习时间窗模块和提示词编辑卡。

关键决策：本轮只调整 renderer UI、拆分 CSS 和 GUI smoke 脚本，不修改数据库 schema、IPC、AI schema 或业务状态机。通过重写 `tokens/layout/components/today/study/review/settings` 样式文件减少旧层叠覆盖，构建产物主 CSS 约 63.62KB。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 均通过；修复浏览器预览初始路由后，分别截取并查看 Today、Study、Review、Settings 四页截图，确认不再重复截同一页面，截图位于 `output/playwright/*-redesign.png`。

### 2026-07-04 Today/Study 页信息职责重构

重构 TodayPage 和 StudyPage 的信息职责，统一数据层级为 DayGoal > Task > Step，用户界面只使用术语：今日目标、任务、步骤、完成标准。移除 Action、Checkpoint、产出、结束验收等重复概念。

TodayPage 只负责：展示今日目标/预计时间/任务数量、任务摘要列表、唯一的"开始学习"入口。点击"开始学习"后直接进入进行中状态并开始计时，StudyPage 不再出现第二个"开始"按钮。

StudyPage 只负责展示当前步骤：当前任务名称、步骤进度（如 1/4）、当前步骤标题、操作说明、完成标准、"遇到问题"和"完成此步骤"两个操作。默认移除 StudyPage 右侧 AI 面板，用户点击"遇到问题"时以抽屉形式打开 AI 助手（AiDrawer 组件）。

关键技术决策：
- 删除 `LegacyTodayView`、`TodayAiPanel`、`StudyAiPanel` 未使用组件
- 创建 `AiDrawer` 组件替代 `StudyAiPanel`，API 未配置提示只出现在抽屉内部
- 统一术语：AI 输出 schema 中的 `actions` 对应 UI 中"步骤"，`checkpoints` 对应"完成标准"
- StudyPage 主内容最大宽度 820px，每页最多一个主要卡片容器
- 步骤列表使用分割线，不使用多层卡片嵌套

验证：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd test` 均通过（31 passed, 1 skipped）。

### 2026-07-04 修复过度简化并恢复完整业务闭环

上一轮重构过度简化了功能（页面空白过多，删除了历史记录、暂停、完成步骤、结束学习等必要功能）。本轮修复数据层级、恢复学习状态与操作、重构桌面布局。

关键修复：
- 修复 StudyPage 数据层级：步骤进度改为使用当前任务内步骤数（如 1/4），不使用今日任务数；`StudyView` 接收 `todayGuide` prop 以获取 `DailyGuideTask` 及步骤列表
- 恢复学习状态与按钮逻辑：支持 not_started/in_progress/paused/completed 状态；按钮规则：未开始→开始任务+返回今日，进行中→完成当前步骤+暂停+结束学习，已暂停→继续学习+结束学习
- 重构 TodayPage 为双栏布局：左侧今日目标卡片+任务列表（显示步骤数、完成进度、当前任务标识）；右侧今日进度（完成任务数、学习时间）+最近学习（最多3条，提供"查看全部"进入复盘）
- 重构 StudyPage 为双栏布局：主工作区（800px）+右侧上下文栏（280px），间距24px；窗口变窄时切换为单栏（≤1100px）
- StudyPage 顶部放置学习会话状态栏（当前任务名称、步骤进度、计时器、暂停/继续按钮）
- StudyPage 右侧上下文栏显示：当前任务大纲（仅步骤标题和完成状态，当前步骤高亮）+本次学习记录（开始、完成步骤、暂停等最近事件）
- StudyPage 底部添加固定操作栏：左侧"结束学习"（中性次要样式）；右侧"暂停/继续"+"完成当前步骤"（主按钮样式）+"遇到问题"（打开AI抽屉）
- 结束学习时显示确认弹窗："当前进度将被保留，你可以稍后继续"；按钮为"继续学习"和"保存进度并结束"
- AI 助手仍然使用抽屉形式（AiDrawer 组件），点击"遇到问题"时打开

视觉调整：
- 允许一个主卡片和多个轻量辅助模块，不再限制每页只有一个卡片
- 主区域使用中性边框，青绿色仅用于主操作、进度和当前状态
- 不删除任何已有业务功能；不适合常驻的功能移至右侧上下文栏或抽屉，而不是删除
- TodayPage 和 StudyPage 内容最大宽度设为 1160px，在侧边导航右侧区域内水平居中

修改文件：
- `src/renderer/src/main.tsx` - 修复数据层级、添加双栏布局、恢复按钮逻辑、添加确认弹窗、添加右侧上下文面板
- `src/renderer/src/styles.css` - 更新 .today-v2 和 .study-layout 为双栏、添加 .study-context-panel、.study-fixed-action-bar、.today-context-panel、.progress-stats、.recent-list 等样式类

验证：`npm run typecheck`（通过）、`npm test`（31 passed, 1 skipped）、`npm run build`（成功）。

### 2026-07-04 Study 页专注执行面板去重

根据最新截图反馈，Study 页不再重复展示 Today 页已有的主任务目标、进度说明和学习提示。主内容区收束为当前 Action、Checkpoint、产出和折叠提示，右侧 AI 面板只保留提问与提交结果入口，去掉“当前上下文”等重复说明。

关键决策：Study 页定位为 Focus Session 执行界面，不再承担今日计划概览；今日计划、其他任务和边界信息继续留在 Today 页。此次仅调整 renderer UI 与 GUI smoke 断言，不修改数据库、IPC、AI schema 或业务状态机。

验证：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd test` 均通过。

### 2026-07-04 UI 可读性与 Markdown 渲染优化

修复窗口缩小时全页面文字挤在左侧窄列、输入框占比过大、Today/Study 标题和内容重复的问题。Today 顶部目标区改为“总目标 + 元信息标签 + 主按钮”，面包屑去除相邻重复项；当前任务详情把执行动作和完成标准改为结构化列表；Study 顶部使用短标题，主面板标题改为任务说明，避免长标题在 session bar 和内容卡中重复。

关键决策：AI 返回文本用 renderer 轻量 Markdown 渲染处理标题、段落、无序/有序列表和代码块，不新增 Markdown 依赖，不改变 AI 输出 schema、业务服务、IPC 或数据库结构。

验证：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd test` 均通过；Electron/CDP 在 1280px 窗口下截图检查 Today/Study 无横向溢出，Markdown 展开态能保留标题、列表和代码块。

### 2026-07-04 CSS 技术债审计与拆分清理

对 `src/renderer/src/styles.css` 进行全面审计和分阶段清理。原文件为单文件 7642 行 / 143 KB，因多次 UI 重构积累了大量重复选择器、旧实现与未使用类。

根因与修复：
- Today / Study 页面样式修改不生效的根本原因是同一类选择器被重复定义多次（如 `.today-v2` 13 次、`.study-layout` 14 次、`.study-session-bar` 36 次），CSS 层叠规则导致后定义覆盖前定义，靠前位置的修改被覆盖。
- 清理脚本按 `main.tsx` 中实际使用的 className 清单保留样式，删除约 174 个未使用类；对重复选择器按（选择器 + 媒体查询）合并，保留最终层叠效果。
- 拆分后建立按职责划分的 CSS 架构：
  - `src/renderer/src/styles.css` - 入口，使用 `@import` 聚合
  - `src/renderer/src/styles/tokens.css` - 设计变量
  - `src/renderer/src/styles/base.css` - 基础元素重置
  - `src/renderer/src/styles/layout.css` - 侧边栏、导航、工作区布局
  - `src/renderer/src/styles/components.css` - 通用组件（按钮、卡片、模态框、消息内容等）
  - `src/renderer/src/styles/intake.css` - 目标访谈与历史导入
  - `src/renderer/src/styles/today.css` - 今日页面
  - `src/renderer/src/styles/study.css` - 学习页面
  - `src/renderer/src/styles/review.css` - 复盘页面
  - `src/renderer/src/styles/settings.css` - 设置页面
  - `src/renderer/src/styles/utilities.css` - 动画、工具类
- 保留脚本 `scripts/clean-css.mjs` 与 `scripts/extract-jsx-classes.mjs` / `scripts/audit-css.mjs` 作为后续可复用的 CSS 审计工具。

结果：源码行数从 7642 行降至约 3827 行；构建产物 `main-*.css` 从 143 KB 降至约 73 KB。`npm run typecheck`、`npm run test`、`npm run build` 均通过。

### 2026-07-04 文档入口与流程口径整理

更新 `AGENTS.md`，把旧“约 10 分钟粒度每日计划”规则替换为当前主任务制 Daily Guide、Focus Session、本地进度记录、一次提交评估和日终综合复盘口径。整理 docs 入口，压缩本文件，活跃专题文档统一当前流程；旧线框、旧审计、旧 UI demo 保留为历史参考。

验证：文档关键词扫描和内容映射检查通过；本轮仅修改文档，未运行代码 typecheck/test/build。后续已删除被活跃文档吸收的旧线框、旧审计和旧 UI demo。

### 2026-07-04 修复主流程 dailyGuideAgent 持续失败

真实 AI 在 `dailyGuideAgent` 阶段持续失败，根因是 prompt 上下文冗长且 schema 对 `actions` 硬性要求至少 3 个。已精简 `buildDailyGuidePrompt`，移除对 `docs/Example.md` 的隐式引用，给出完整 JSON 示例；`actions` schema 最小数量从 3 放宽到 1，`tasks` 最大数量收紧到 4，并增加 `estimatedMinutes.min <= target <= max` 校验；`DailyGuideAgent` 超时提升到 120 秒；失败写入 `ai_reviews`。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 均通过。

### 2026-07-04 历史会话管理与按钮反馈增强

新增历史会话浏览入口，可查看历史目标访谈记录、消息详情并据此重新生成计划。修复“重新生成当日计划”按钮无反馈问题，增加加载遮罩和醒目错误提示。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 均通过。

### 2026-07-04 主任务制每日计划与计时流程

每日执行稿从固定 10 分钟 block 改为“任务决定时长”的主任务结构。新增 `daily_guide_tasks`、`daily_guide_actions` 表和迁移；旧 block 表保留为兼容。Focus Session 不判定任务完成；主任务最终提交后只按 `evaluationMode` 走本地验证或一次 AI 评估。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build` 均通过。

### 2026-07-04 四页面布局与视觉统一重构

参考 UI 示意图统一重构 Today、Study、Review、Settings 四个页面的布局与视觉样式。本轮只调整页面结构、排版和组件样式，未修改业务逻辑、数据结构、状态流转和功能入口。

关键变更：
- 删除主内容区顶部重复的页面大标题与副标题（今日/学习/复盘/设置），由左侧导航表达当前页面
- 重构侧边栏：移除“学习管家”“AI 学习助手”文字，仅保留 Logo；在 Logo 右侧增加折叠/展开按钮；支持手动折叠（仅显示图标），折叠后主内容区自动扩大；当前导航保持明确高亮
- 内容区整体上移，减少顶部空白；页面边距、卡片圆角、按钮高度、内容间距统一
- 普通卡片使用中性浅灰边框，青绿色仅用于当前状态、进度、选中导航和主要操作；降低装饰性阴影/渐变
- Today 页：顶部总目标卡片 + 任务列表（序号、状态徽章、当前标识）+ 右侧今日进度环形图 + 最近学习
- Study 页：顶部会话状态栏（任务名、步骤进度、计时器、暂停/继续）+ 当前步骤卡片（操作说明/完成标准/遇到问题）+ 右侧任务大纲/学习记录/当前进度 + 底部固定操作栏
- Review 页：顶部三项统计卡片 + 本次总结 + 学习记录时间线 + 右侧最近 7 天柱状图 + 问题与改进
- Settings 页：改为三栏卡片网格（AI 助手、学习偏好、账户与版本、数据记录、提示词档位），保留原有字段与保存逻辑

修改文件：
- `src/renderer/src/main.tsx` - 重构 Sidebar/App（折叠状态、移除 TopBar）、TodayView、StudyView、ReviewView、SettingsView JSX
- `src/renderer/src/styles.css` - 在文件末尾追加统一布局与视觉样式块，覆盖侧边栏、四页面卡片、响应式行为

验证：`npm run typecheck`（通过）、`npm test`（31 passed, 1 skipped）、`npm run build`（成功）。

### 2026-07-06 真实桌面流程阻塞修复

根据正式库 + Electron 桌面测试结果修复三类阻塞：
- `重新开始新计划`：归档当前 active goal 下的所有 guide，并清空 runtime 指针，避免刷新/重启后又回到历史 completed guide。
- `开启下一天`：下一学习日选择排除已绑定 `daily_guides.short_plan_day_id` 的 short plan day；计划用尽时返回明确 `short_plan_exhausted` 文案，renderer 全局通知栏会显示错误而不是看起来无反应。
- 复盘与概览：复盘 snapshot 改为按 date 读取对应 guide，避免新旧 guide 混用；概览页对旧数据中 roadmap 全 pending 但 short plan 已完成的情况做展示兼容。

新增回归测试覆盖“归档后不再捡回旧 completed guide”和“所有 short plan day 已使用时返回明确 exhausted 结果”。验证：`npm run typecheck`、`npm test`（65 passed, 6 skipped）、`npm run build` 均通过。测试日志仍有既有 migration duplicate column 跳过噪声，未在本轮处理。

### 2026-07-06 学习单元语义与滚动计划收敛

修复概览页把 `short_plan_days.dayIndex` 展示为“第 N 天”的误导：UI 改为“当前学习单元”，Daily Guide prompt 也改为“当前学习单元 + 内部顺序编号”，避免 AI 和用户都把内部序号理解成日历天数。

修复“生成下一批任务”绕过已有待学单元的问题：`generateRollingPlan` 现在会先复用当前 active roadmap stage 下最早的未绑定、待执行 short plan day；只有当前阶段没有可用待学单元时，才调用 rolling plan AI 续写新学习单元。新增 `listAvailableShortPlanDaysForStage`，并补充两条回归测试覆盖“先复用已有单元”和“单元耗尽后才续写”。

验证：`npm test -- src/main/services/app-service.test.ts`（20 passed）、`npm run typecheck`、`npm test`（76 passed, 6 skipped）、`npm run build` 均通过。正式库只做过只读诊断；历史测试数据中已存在的多个 active guide / active short plan day 未自动清理。

### 2026-07-07 复盘调整建议风险收敛

修复复盘 `planAdjustments` 采纳链路的中高风险问题：`applyReviewPlanAdjustments` 不再把未来学习单元的 `tasksJson` 覆盖为“调整原因”，避免下一轮 Daily Guide 丢失主题任务；当存在 active roadmap stage 时，调整只匹配该阶段下的 pending short plan day，避免同一 `dayIndex` 跨阶段误改。

Review 页采纳调整后增加本地“已应用调整”状态，按钮禁用并更新说明，降低重复点击造成的状态混乱。新增 store 层回归测试覆盖“只改 active stage pending day 且保留任务列表”。

验证：新增回归测试先红后绿；`npm test -- src/main/services/store.test.ts -- -t "applyReviewPlanAdjustments only"`、`npm run typecheck`、`npm test -- src/main/services/app-service.test.ts src/main/services/store.test.ts`（49 passed）、`npm test`（77 passed, 6 skipped）、`npm run build` 均通过。仍存在既有 migration duplicate column 跳过噪声，未在本轮处理。

## 当前风险

* 真实 DeepSeek 完整主流程仍需人工验收一次，确认当前 daily guide prompt 在真实模型下稳定。
* 底层旧 plan/block 数据结构仍是 session 复用路径的一部分；后续清理必须先替换 `daily_guide_block -> daily_plan_block` 的执行映射。
* 提问、主任务最终提交、复盘调整等入口已按新主任务制规划，但仍需持续检查是否还有旧 block/step 语义遗留。
* Renderer 层已不直接依赖 block 类型；session 锚点仍使用 blockId，后续应继续收敛旧 block/step 语义。

## 推荐下一步

1. 落地 Step 1.3：在 `app-service.ts` 中把 `error_category` 字段接进 saveAiReview（失败时写入 errorCategory），并让 renderer 根据错误类别给出差异化的用户提示（用户输入错误 / AI 调用失败 / 输出不合法）。
2. 落地 Phase 2 Step 2.2-2.3：为当前内存 generationLock 增加持久化备份（app_settings 或 generation_locks 表）；为明确幂等操作增加重复提交防护。
3. 落地 Phase 3 Step 3.1-3.3：给 ContextBuilder 增加 operation 级别的上下文预算裁剪，实现冲突仲裁规则（时间限制按最近确认为准），并处理超过 30 天的上下文折叠。
4. 待 1-3 完成后，继续 Phase 4-8 补齐 `docs/v2/ANALYSIS_vs_goal.md` 中的计划版本、知识库、时间规则、测试补齐。
5. 用真实 DeepSeek API 验收一次完整分层计划生成。
