## 当前任务展示

* UI 入口：Today 的“今日总目标 / 今日任务”，Study 的 Session Bar、当前步骤、任务大纲。
* 调用入口：初始化 `refresh()`、`syncActiveSession()`；Today 通过 `handleTodayPrimaryAction()`进入学习。
* 数据来源：`todayGuide.guide.tasks`、`guide.blocks`、`activeSession`、`learningState`。
* 当前状态：新旧实现并存。
* 证据：Today 用 `currentBlock = getCurrentGuideBlock(guide.blocks, activeSession)`，再用 `legacyPlanBlockId` 找 `currentTask`；Study 同时依赖 `activePlan.blocks`、`todayGuide.guide.tasks`、`learningState.step`。
* 判断：主任务 UI 已存在，但当前任务仍由 legacy block 锚定，任务、步骤、block 语义混用。

## 开始学习

* UI 入口：Today 主按钮“确认并开始 / 开始今日学习”，Study 无独立开始按钮。
* 调用入口：`onStart(currentBlock.planBlockId)` → `window.studyApp.sessions.start(blockId)`。
* 数据来源：`currentBlock.planBlockId`、`activeSession`。
* 当前状态：新旧实现并存。
* 证据：preload 将 `sessions.start(blockId)` 接到 `ipcChannels.sessionsStart`；main IPC 调 `appService.startSession(payload.blockId)`。
* 判断：开始链路存在，但入口仍传 blockId，不是显式主任务 id。

## 暂停与继续

* UI 入口：Study 顶部按钮、底部操作栏“暂停 / 继续学习”。
* 调用入口：暂停 `window.studyApp.sessions.pause(activeSession.id)`；继续 `window.studyApp.sessions.start(activeSession.blockId)`。
* 数据来源：`activeSession.status`、`activeSession.id`、`activeSession.blockId`。
* 当前状态：正常存在。
* 证据：preload 有 `sessions.pause`、`sessions.start`；main IPC 对应 `sessions:pause`、`sessions:start`。
* 判断：Focus Session 的暂停/继续 UI 与调用链存在；继续通过重新 start 同一 block 恢复。

## 暂时结束与完成

* UI 入口：Study “结束学习”弹窗“保存进度并结束”；AI 抽屉“提交结果 / 提交并评估”；结算页“完成本块 / 部分完成 / 跳过”。
* 调用入口：结束本次执行：`onCompleteSession(notes)` → `window.studyApp.sessions.complete(activeSession.id, notes)`；完成当前主任务：`onSubmitResult(value)` → `window.studyApp.learning.submitResult(content)`。
* 数据来源：`activeSession`、`notes`、`learningState.step`、`submissionResult`。
* 当前状态：新旧实现并存。
* 证据：结算页文案写“这里不自动完成整个任务”“学习块完成不等于任务自动完成”；提交评估入口藏在 AI 抽屉，按钮禁用条件是 `!learningState?.step`。
* 判断：结束本次执行与提交评估都存在，也符合“执行记录不等于主任务完成”的产品事实；但“提交主任务成果 / 完成当前主任务”没有清晰主入口，且结算仍按学习块表达，容易重新混淆主任务、行动步骤和 Focus Session。

## 历史记录

* UI 入口：无 guide 时右侧“历史会话”；Review 的“学习记录 / 查看全部历史”。
* 调用入口：`window.studyApp.history.listAll()`、`history.getById(intakeId)`；Review 仅展示 `latestSettlement` / `review`。
* 数据来源：目标访谈历史、当前内存里的 `latestSettlement`、`review`。
* 当前状态：新旧实现并存。
* 证据：HistoryPanel 说明“历史目标访谈记录”；Review timeline 只显示本次开始、完成、复盘。
* 判断：历史入口存在，但从已读代码看，历史会话偏目标访谈，Review 偏本次执行摘要。按产品事实，历史应覆盖目标变化、计划版本、任务进度、执行记录、提交结果和复盘；这些是否已形成统一入口无法确认。

## 最严重的三个断点

1. 当前主任务仍通过 legacy block 选择和启动，主任务事实与执行锚点不一致。
2. “保存进度并结束本次 Focus Session”和“提交主任务成果”分散在结算页与 AI 抽屉，用户路径不清晰。
3. 历史记录分裂为目标访谈历史、Review 本次记录和最近学习摘要，尚未体现产品事实要求的完整历史范围。

## 建议的最小恢复顺序

1. 先统一当前任务展示：Today / Study 都明确显示同一个当前主任务，并把 block 仅视为内部锚点。
2. 再整理 Study 操作：区分“暂停”“保存进度并结束本次 Focus Session”“提交主任务成果”。
3. 最后整理历史入口：先保证任务进度、Focus Session 记录、提交结果和复盘能被用户看见。
