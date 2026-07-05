# V2 Feature Ledger

> 只读审计，冻结于 2026-07-05。本文件不得用于驱动代码修改。
> 限制 200 行。

## 用户可见功能清单

| # | 功能 | 入口 | 是否正常 | 是否重复 | 必须迁移 | V2 阶段 |
|---|------|------|----------|----------|----------|---------|
| 1 | AI 主动目标访谈 | Today 页 intake panel → sendMessage [IPC](src/main/ipc.ts:15) | 正常 | 否 | 是 | Phase 1 |
| 2 | 目标理解编辑与确认 | Today 页 GoalBriefEditor → confirmGoal [IPC](src/main/ipc.ts:18) | 正常 | 否 | 是 | Phase 1 |
| 3 | 生成分层计划（roadmap+shortPlan+dailyGuide） | Today 页"确认并生成计划"→ generateLayeredPlan [IPC](src/main/ipc.ts:22) | 正常 | 否 | 是 | Phase 1 |
| 4 | 确认今日执行稿 | Today 页"确认今日执行稿"→ confirmDailyGuide [IPC](src/main/ipc.ts:24) | 正常 | 否 | 是 | Phase 1 |
| 5 | 首页 Today 进度总览 | Today 页，展示今日任务列表+进度环+最近学习 [TodayPage](src/renderer/src/pages/TodayPage.tsx:1) | 正常 | 否 | 是 | Phase 1 |
| 6 | Study 页开始/暂停/恢复学习 | Study 页底部操作栏 → startSession/pauseSession [IPC](src/main/ipc.ts:29) | 正常 | 否 | 是 | Phase 1 |
| 7 | 完成当前行动步骤（本地） | Study 页"完成当前步骤"→ completeCurrentAction [IPC](src/main/ipc.ts:36) | 正常 | 否 | 是 | Phase 1 |
| 8 | AI 展开当前步骤讲解 | AiDrawer → teachCurrentStep [IPC](src/main/ipc.ts:34) | 正常 | 否 | 是 | Phase 1 |
| 9 | 向 AI 提问（问题分支） | AiDrawer 提问 tab → askQuestion [IPC](src/main/ipc.ts:38) | 正常 | 否 | 是 | Phase 1 |
| 10 | 解决/收束问题分支 | AiDrawer → resolveQuestion [IPC](src/main/ipc.ts:41) | 正常 | 否 | 是 | Phase 1 |
| 11 | 提交主任务最终结果 | AiDrawer 提交 tab → submitResult [IPC](src/main/ipc.ts:43) | 正常 | 否 | 是 | Phase 1 |
| 12 | AI 评估提交（evaluate_submission） | submitResult 内部调用 [app-service.ts](src/main/services/app-service.ts:303) | 正常 | 否 | 是 | Phase 1 |
| 13 | 本地评估提交（evaluationMode=local） | submitResult 内部 local 路径 [app-service.ts](src/main/services/app-service.ts:307) | 正常 | 否 | 是 | Phase 1 |
| 14 | 本地状态机决定完成/继续/修改 | submitResult 后调用 buildLocalDecision [app-service.ts](src/main/services/app-service.ts:321) | 正常 | 否 | 是 | Phase 1 |
| 15 | AI 复盘生成 | Review 页"生成 AI 复盘"→ generateReview [IPC](src/main/ipc.ts:48) | 正常 | 否 | 是 | Phase 1 |
| 16 | Review 页统计总览 | Review 页 stats cards [ReviewPage](src/renderer/src/pages/ReviewPage.tsx:1) | 正常 | 否 | 是 | Phase 1 |
| 17 | 计划调整建议确认/拒绝 | Review 页 decideAdjustment [IPC](src/main/ipc.ts:45) | 正常 | 否 | 是 | Phase 1 |
| 18 | 归档今日计划并重新开始 | Today 页"重新开始新计划"→ archiveTodayAndRestart [IPC](src/main/ipc.ts:25) | 正常 | 否 | 是 | Phase 1 |
| 19 | 历史会话浏览 | Today 页 HistoryPanel → listAll/getById [IPC](src/main/ipc.ts:52) | 正常 | 否 | 是 | Phase 1 |
| 20 | 设置页：API Key/模型/URL | Settings 页 [SettingsPage](src/renderer/src/pages/SettingsPage.tsx:1) | 正常 | 否 | 是 | Phase 1 |
| 21 | 设置页：默认专注时长 | Settings 页 | 正常 | 否 | 否（V2 由 Action 时长取代） | Phase 2 |
| 22 | Prompt Profile 管理 | prompts list/update [IPC](src/main/ipc.ts:49) | 正常 | 否 | 是 | Phase 2 |
| 23 | Focus Monitor（前台窗口监控） | 主进程后台 15s 轮询 [focus-monitor.ts](src/main/services/focus-monitor.ts:1) | 正常 | 否 | 否（V2 评估是否需要） | Phase 3 |
| 24 | Session 推送事件 | main→renderer push [ipc.ts](src/main/ipc.ts:54) | 正常 | 否 | 是 | Phase 1 |
| 25 | 系统托盘 | main/index.ts tray [index.ts](src/main/index.ts:55) | 正常 | 否 | 否（低优先级） | Phase 3 |
| 26 | 学习时间累积查询 | getAccumulatedSeconds [app-service.ts](src/main/services/app-service.ts:228) | 正常 | 否 | 是 | Phase 1 |
| 27 | 数据导出/清空缓存按钮 | Settings 页（UI 占位，后端未实现） | 未实现 | 否 | 否（V2 按需） | Phase 3 |
| 28 | 知识库展示 | Today 页右侧知识库卡片（占位，无后端） | 未实现 | 否 | 否（V2 中后期） | Phase 3 |

## 功能重复分析

以下功能在同一项目中存在多套实现：

| 重复领域 | 实现 A | 实现 B | 说明 |
|----------|--------|--------|------|
| 计划数据模型 | `daily_guides` + `daily_guide_tasks`（当前主流程）| `daily_plans` + `daily_plan_blocks`（旧 block 制） | B 保留为 session 锚点和历史兼容，不再承载业务 |
| 阶段数据模型 | `roadmap_stages`（AI 生成，当前主流程）| `plan_stages`（旧手动管理） | B 未被主流程使用，孤表 |
| 任务模型 | `daily_guide_tasks`（主任务，含 actions/doneWhen/evaluationMode）| `task_items`（旧通用任务） | B 未被主流程使用 |
| 评估决策 | 本地状态机 `buildLocalDecisionFromEvaluation` [app-service.ts](src/main/services/app-service.ts:365) | `NextStepDecisionAgent` [agents.ts](src/main/ai/agents.ts:196) | B 在代码中存在但主流程不再调用 |
| AI 输出 schema | `evaluationAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:106) | `submissionEvaluationAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:298) | 前者死代码（Review Agent 使用 reviewAgentOutputSchema） |
| Block 桥接 | `daily_guide_blocks`（guide→plan_block 映射）| 直接通过 `legacyPlanBlockId` 引用 | guide_blocks 表是冗余中间层 |
| 学习步骤 | `learning_steps`（旧 step 模型，blockId 锚点）| `daily_guide_actions`（新 action 模型，taskId 锚点） | 两者并存，状态机同时操作两套 |

## 不迁移的孤岛功能

以下功能/数据结构确认不进入 V2 主链：

- `rawImports` / ChatGPT 导入：从未落地，表定义残留 [schema.ts](src/main/db/schema.ts:3)
- `taskDependencies` 依赖追踪：从未使用
- `planVersions` 旧计划版本：被 `daily_guides` 取代
- `focusEvents` 前台监控记录：隐私敏感，非核心
- `skipLogs` block 跳过日志：旧 block 制产物
- `evaluationAgentOutputSchema`：死 schema
- `stepSummaryAgentOutputSchema`：死 schema，摘要未实现
- `NextStepDecisionAgent`：被本地状态机取代
- `planAdjustmentProposals` 调整提案：当前唯一引用在 Review 页 pending 状态展示，功能半废弃
