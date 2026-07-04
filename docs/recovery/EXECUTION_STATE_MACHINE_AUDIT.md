# 学习执行状态机审计

## 1. 当前业务实体

目标：`goals.status`、runtime `activeGoalId`。Guide：`daily_guides.status`，任务在 `daily_guide_tasks`，legacy 锚点在 `daily_plan_blocks`。主任务：`daily_guide_tasks.status/progressPercent/currentActionId/nextStartPoint/totalElapsedMinutes/legacyPlanBlockId`，还同步 block、`task_items.status`。行动步骤：`daily_guide_actions.status/completedAt/progressNote`；执行层 `learning_steps.status/position/blockId`。Session：`study_sessions.status/blockId/taskId/time/duration/notes`，runtime `sessionStatus`。提交：`learning_submissions.stepId/sessionId/content`。评价：`learning_evaluations.result/recommendedAction`、`next_step_decisions.decision/taskCompleted`。复盘：`ai_reviews.kind=reflection`，`getDaySnapshot` 聚合。

## 2. 当前状态事实源

当前主任务：`activeSession.blockId`、`step.blockId`、`activeDailyTaskId`、task `legacyPlanBlockId/status`、renderer 回退；`activeDailyTaskId` 实存 block id。当前行动步骤：`currentActionId/actions.status`、`activeStepId/learning_steps.status/position`、renderer `stepIndex`。当前 Session：`study_sessions.status='active'`、renderer `activeSession`、runtime `sessionStatus`。主任务完成：guide task/block/task item/learning step/decision 五处。今日完成：无单字段，由 tasks 或 blocks done 派生。重启：读 runtime、active session、today guide，再 renderer 回退。冲突事实源共 5 组。

## 3. 当前状态转换表

格式：转换：入口 | 读 | 写 | 持久/刷新 | 缺陷。DB=写库，UI=set/refresh。

- 选择当前任务：getCurrentGuideTaskSelection | session/runtime/task/block | 无 | 无DB/render | UI自选，可回done。
- 开始 Session：sessions.start | block | session/block/runtime active | DB/UI | blockId启动。
- 暂停 Session：sessions.pause | session | session paused/duration、runtime paused | DB/UI | 改学习态。
- 恢复 Session：sessions.start(activeSession.blockId) | paused session | session/runtime active | DB/UI | 只能按block。
- 完成普通行动步骤：completeCurrentAction | runtime/step/task/actions | action done、task progress、旧step done、新step active | DB/UI | 双推进。
- 完成最后行动步骤：同上 | 同上 | currentActionId=null、progress 100、task active | DB/UI | 无awaiting_result。
- 提交当前结果：submitResult | step/session/task | submission/evaluation/decision | DB/AI/UI | 对象是step。
- AI 评价未通过：saveEvaluationAndDecision | evaluation/decision | step needs_revision、task active | DB/UI | 修订归属不清。
- AI 评价通过：同上 | step/block | step done、task/block/taskItem done、激活下一任务 | DB/UI | 通过和推进耦合。
- 完成普通主任务：activateNextDailyGuideTask | guideTasks | next task/step、runtime next block | DB/UI | 旧session未处理。
- 完成最后主任务：同上 | guideTasks | runtime仍指旧block/step、sessionStatus=completed | DB/UI | 无日终态。
- 保存进度并结束 Session：sessions.complete | active session | session completed/duration/notes、runtime completed | DB/settlement | 改学习态。
- 应用重启恢复：refresh/syncActiveSession | runtime/session/guide | 无 | UI回退 | 掩盖错误。

## 4. 冲突和重复逻辑

renderer 选任务/步骤；store 推进 action、评价、下一任务；app-service 在 Session start/pause/complete 时改 runtime，并把评价映射为完成/修订。`activeSession.blockId`、`step.blockId`、`activeDailyTaskId`、task status 可冲突。最后任务完成后未清 active 指针。Session 结束本应只记时间，却影响 runtime。fallback 掩盖错误。

## 5. 建议的目标状态机

主任务：`planned -> active -> awaiting_result -> needs_revision -> done`，`skipped/deferred` 为旁路。行动步骤：`pending -> active -> done`。Session：`active/paused/completed`，只记录执行。

最后 action 完成后进入 `awaiting_result`。AI 通过后主任务 `done`；有下一任务则下一任务和首 action `active`，runtime 指向它；无下一任务则 active task/step 为空，今日完成由全 done 派生。AI 未通过后主任务 `needs_revision` 并进修订 step。Session 结束不得改主任务、action、step、评价或 Guide。重启优先恢复 active session 的未完成任务；否则恢复 runtime 中未完成 active/awaiting_result/needs_revision；若指向 done，则找首个未完成任务或展示今日完成。

## 6. 修复策略判断

选择 B：集中重构执行状态转换层，保留现有数据结构、IPC 和 UI。现有表能表达任务、步骤、Session、提交、评价；问题是转换分散、命名误导、终态缺失。

## 7. 下一轮最小实施范围

一个阶段：集中改 `src/main/services/store.ts` 与薄封装 `app-service.ts`；保留 IPC、preload、类型和 UI 外形。renderer 当前任务/步骤选择移出，只消费 store 快照；store 做唯一入口。保留 action 保存、local/ai 单次评价、Session 计时、legacy block 兼容。移除 renderer 回退 done、app-service 在 Session end 后重写 runtime、store 重复推进分支。测试覆盖普通任务进下一任务、最后任务进今日完成、Session complete 不改任务进度、重启 done 指针恢复到未完成任务或完成态。
