# V2 Legacy Map

> 只读审计，冻结于 2026-07-05。标记每个模块的可复用性、转换需求、隔离判断。
> 限制 250 行。

## 一、模块职责矩阵

### goals / goal_intakes / goal_intake_messages

| 维度 | 说明 |
|------|------|
| 职责 | 学习目标 CRUD、主动访谈对话、目标理解（GoalBrief）确认 |
| 位置 | `goals`、`goal_intakes`、`goal_intake_messages` 表 [schema.ts](src/main/db/schema.ts:25) |
| 对应 V2 概念 | **Artifact**（目标理解快照）+ **Event**（访谈消息） |
| 判定 | **可复用**：GoalIntake 流程完整、数据隔离清晰。V2 将 intake 消息归入 Event 流，brief 归入 Artifact 版本链 |

### roadmap_stages / short_plan_days

| 维度 | 说明 |
|------|------|
| 职责 | AI 生成的长期阶段和前三天的短期计划 |
| 位置 | `roadmap_stages`、`short_plan_days` 表 [schema.ts](src/main/db/schema.ts:92) |
| 对应 V2 概念 | **Artifact**（roadmap/shortPlan） |
| 判定 | **可复用**：直接映射为 V2 Artifact。shortPlanDays 的 `date` 字段表达"当前进行到哪一天"，是 Journey 快照的关键部分 |

### daily_guides / daily_guide_tasks / daily_guide_actions

| 维度 | 说明 |
|------|------|
| 职责 | 每日执行稿：今日目标 + 主任务 + 执行动作。当前主流程核心 |
| 位置 | `daily_guides`、`daily_guide_tasks`、`daily_guide_actions` 表 [schema.ts](src/main/db/schema.ts:150) |
| 对应 V2 概念 | **Artifact**（dailyGuide 版本）+ **Action**（dispatchLearningAction 入口目标） |
| 判定 | **可复用**：daily_guide_tasks 是 V2 的核心工作单元。actions 是 V2 Action 的直接前身。需统一 action 执行路径为 dispatchLearningAction |

### daily_plans / daily_plan_blocks（旧）

| 维度 | 说明 |
|------|------|
| 职责 | 旧版固定时间块计划。当前仅作为 study_sessions 的 blockId 锚点 |
| 位置 | `daily_plans`、`daily_plan_blocks` 表 [schema.ts](src/main/db/schema.ts:123) |
| 对应 V2 概念 | 无直接对应 — 旧 Time Block 概念已废弃 |
| 判定 | **必须隔离**：不得进入 V2 主链。session 锚点需迁移到 guideTaskId 或独立 session 标识 |

### daily_guide_blocks（桥接表）

| 维度 | 说明 |
|------|------|
| 职责 | daily_guides 与 daily_plan_blocks 的多对多映射 |
| 判定 | **必须隔离**：纯冗余中间层，V2 无此需求 |

### study_sessions

| 维度 | 说明 |
|------|------|
| 职责 | Focus Session 开始/暂停/恢复/完成记录，含 blockId 锚点 |
| 位置 | `study_sessions` 表 [schema.ts](src/main/db/schema.ts:207) |
| 对应 V2 概念 | **Event**（session 生命周期事件） |
| 判定 | **可复用**：需将 blockId 替换为 guideTaskId 或 journeyId |

### learning_runtime_states

| 维度 | 说明 |
|------|------|
| 职责 | 单例运行时指针（activeGoalId/activeStageId/activeDailyTaskId/activeStepId/activeQuestionThreadId/sessionStatus） |
| 位置 | `learning_runtime_states` 表 [schema.ts](src/main/db/schema.ts:253) |
| 对应 V2 概念 | **Journey 快照**的一部分 |
| 判定 | **需要转换**：当前字段混用新旧概念（activeDailyTaskId 指向 dailyPlanBlocks 而非 dailyGuideTasks）。V2 应统一到 guideTaskId + actionId |

### learning_steps（旧）

| 维度 | 说明 |
|------|------|
| 职责 | 旧步骤模型，通过 blockId 关联旧 plan blocks |
| 位置 | `learning_steps` 表 [schema.ts](src/main/db/schema.ts:230) |
| 对应 V2 概念 | 被 daily_guide_actions 取代 |
| 判定 | **必须隔离**：不得进入 V2。context-builder 仍读取它构建快照，V2 需替换上下文来源 |

### question_threads / question_messages

| 维度 | 说明 |
|------|------|
| 职责 | 问题分支：打开/追问/解决 |
| 位置 | `question_threads`、`question_messages` 表 [schema.ts](src/main/db/schema.ts:269) |
| 对应 V2 概念 | **Event**（提问事件）+ **Artifact**（问题摘要） |
| 判定 | **可复用**：数据模型合理，需将 stepId 锚点改为 taskId/actionId |

### learning_submissions / learning_evaluations / next_step_decisions

| 维度 | 说明 |
|------|------|
| 职责 | 主任务最终提交 + AI 评估 + 下一步决策 |
| 位置 | `learning_submissions`、`learning_evaluations`、`next_step_decisions` 表 [schema.ts](src/main/db/schema.ts:288) |
| 对应 V2 概念 | **Event**（提交）+ **Artifact**（评估结果）+ **Action**（下一步决策执行） |
| 判定 | **可复用**：submission + evaluation 是核心数据。next_step_decisions 当前由本地函数生成而非 AI，V2 可保留为 Artifact |

### plan_stages / task_items / plan_adjustment_proposals（旧）

| 维度 | 说明 |
|------|------|
| 职责 | 旧版阶段/任务/调整提案。未被主流程使用 |
| 判定 | **必须隔离**：全部为旧 schema 残留 |

### prompt_profiles / prompt_versions

| 维度 | 说明 |
|------|------|
| 职责 | Prompt 模板版本化管理 |
| 对应 V2 概念 | **AI Task 配方** |
| 判定 | **可复用**：直接映射为 V2 AI Task 的 promptVersion + profile |

### ai_reviews

| 维度 | 说明 |
|------|------|
| 职责 | AI 调用审计日志 |
| 对应 V2 概念 | **Event**（AI 调用事件） |
| 判定 | **可复用**：直接归入 V2 Event 流 |

## 二、表达"当前状态"的全部位置

以下每个位置都独立存储了某种"当前进行到哪"的信息，且部分互相引用、部分独立更新：

| # | 位置 | 表达的状态 | 类型 |
|---|------|-----------|------|
| 1 | `learning_runtime_states.activeGoalId` | 当前学习目标 | 运行时指针 |
| 2 | `learning_runtime_states.activeStageId` | 当前阶段（plan_stages，旧） | 运行时指针 |
| 3 | `learning_runtime_states.activeDailyTaskId` | 当前 daily_plan_block（旧） | 运行时指针 |
| 4 | `learning_runtime_states.activeStepId` | 当前 learning_step（旧） | 运行时指针 |
| 5 | `learning_runtime_states.activeQuestionThreadId` | 当前问题分支 | 运行时指针 |
| 6 | `learning_runtime_states.sessionStatus` | idle/active/paused/completed | 运行时指针 |
| 7 | `goals.status` | active/done/archived | 持久字段 |
| 8 | `goal_intakes.status` | collecting/ready/confirmed | 持久字段 |
| 9 | `short_plan_days.date` | null=未激活 / 有值=已激活到该天 | 持久字段 |
| 10 | `daily_guides.status` | draft/confirmed/completed/archived | 持久字段 |
| 11 | `daily_guide_tasks.status` | planned/active/done/skipped/deferred | 持久字段 |
| 12 | `daily_guide_tasks.currentActionId` | 当前正在执行的 action | 持久字段 |
| 13 | `daily_guide_actions.status` | planned/done/skipped | 持久字段 |
| 14 | `study_sessions.status` | active/paused/completed/skipped | 持久字段 |
| 15 | `plan_stages.status` | proposed/confirmed/active/completed/skipped（旧） | 持久字段 |
| 16 | `task_items.status` | backlog/planned/in_progress/done/skipped（旧） | 持久字段 |
| 17 | App.tsx React state | activeSession / learningState / todayGuide 等 | 内存 |
| 18 | `guide-selection.ts` getCurrentGuideTaskSelection | 从 session+state 推导当前 task | 内存推导 |
| 19 | `execution-state-machine.ts` | 从 guide.tasks + runtime 推导 execution status | 纯函数推导 |

## 三、IPC 通道分类

| 通道组 | 通道数 | 判定 |
|--------|--------|------|
| settings:* | 2 | **可复用** |
| onboarding:* | 3 | **需要转换**：V2 归入 Journey.initiate |
| guides:* | 5 | **需要转换**：核心能力，V2 统一为 dispatchLearningAction |
| history:* | 2 | **可复用** |
| sessions:* | 4 | **需要转换**：session 管理，锚点从 blockId 改为 taskId |
| learning:* | 7 | **需要转换**：V2 统一为 dispatchLearningAction 入口 |
| reviews:* | 1 | **可复用** |
| prompts:* | 2 | **可复用** |
| session:stateChanged | 1 | **可复用** |

## 四、页面职责

| 页面 | 当前职责 | V2 定位 |
|------|----------|---------|
| TodayPage | 目标访谈 + 今日进度总览 + 知识库占位 + 计划管理 | Journey 仪表盘 + Artifact 浏览 |
| StudyPage | Focus Session 执行 + 步骤完成 + 提问 + 提交结果 | Action 执行主界面 |
| ReviewPage | 统计分析 + AI 复盘生成 + 调整建议 | Artifact 复盘浏览 |
| SettingsPage | API Key + 模型 + 学习偏好 | 配置管理 |
| AiDrawer | AI 提问 + 提交结果抽屉 | Action 附属 AI 交互 |

## 五、Store 判定摘要

`StudyStore`（2676 行 [store.ts](src/main/services/store.ts:81)）是单体数据访问层，包含 ~90 个方法。判定：

- **可复用**：CRUD 方法（getGoal, listGoals, getSetting, putSetting…）、数据映射函数（mapTask, mapGoal…）
- **需要转换**：saveLayeredPlan（拆为多个 Artifact 写入）、startSession/completeCurrentAction/saveEvaluationAndDecision（统一为 dispatchLearningAction）
- **必须隔离**：initializeLearningForBlock、createStepForActiveExecutionTask（旧 block/step 路径）、getDaySnapshot（全量快照，V2 按需组装）
