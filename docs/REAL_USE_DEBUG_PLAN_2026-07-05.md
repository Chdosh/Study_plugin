# 真实使用测试与 Debug Plan（2026-07-05）

## 测试方式

以普通学习者视角启动开发版 Electron 应用，使用 Windows 桌面窗口实际点击：

1. 启动应用，观察是否弹出独立计时条或浮窗。
2. 查看 Today 首页的进度、学习时长、提示文案和入口可发现性。
3. 进入 Study 页，测试当前任务、暂停、继续、提交结果。
4. 提交一段普通测试文本，观察任务推进、计时结束和 AI 抽屉状态。
5. 返回 Today，检查进度和学习时长同步。
6. 进入 Review，检查复盘统计是否与 Today / Study 一致。
7. 进入 Settings，检查是否还有浮窗、计时提醒、自动复盘等残留控制。

测试中提交的文本：

```text
测试提交：已完成 Node.js 和 npm 检查，初始化 Loop 项目，并启动开发服务器。浏览器能正常打开页面，控制台暂无阻塞错误。
```

## 总体结论

上轮清理有效：启动后没有再出现独立浮窗或 5 小时计时条；Settings 页没有看到浮窗、计时提醒、自动进入复盘等残留控制；提交通过后也没有强制跳转到 Review。

但主流程仍有几处用户可见的不一致，尤其是 Review 统计与 Today 统计口径不一致、暂停恢复记录会改写开始时间、同一页面仍有重复控制，以及 AI 抽屉暴露内部枚举值。

## 测试过程与观察

### 1. 启动应用

观察：

* 启动后直接进入 Today，没有弹出独立浮窗或长计时条。
* Today 提示“今日执行稿已确认。开始、暂停、提交都在‘学习’页完成。”

不合理点：

* 作为用户，提示告诉我去“学习”页，但页面内没有直接入口，只能理解左侧图标导航。产品边界是对的，但新用户可发现性偏弱。

### 2. 从 Today 进入 Study

观察：

* 用可见坐标点击左侧“学习”可以进入 Study。
* 进入后显示当前任务已经完成 3 个步骤，处于“等待提交当前结果”。
* 顶部计时约 04:33，右侧记录显示“开始学习 10:25”。
* Today 此前显示学习时长 18 分钟。

疑似问题：

* Today 的累计时长、Study 顶部当前 session 计时、右侧“开始学习”记录不是同一个口径。用户会怀疑计时又分裂了。
* 如果 04:33 是当前恢复 session 的计时，Today 的 18 分钟应说明是累计已落库时长，不应和运行中 session 看起来矛盾。

疑似代码位置：

* `src/renderer/src/pages/TodayPage.tsx`：`totalElapsed` 只汇总 `task.totalElapsedMinutes`。
* `src/renderer/src/pages/StudyPage.tsx`：顶部计时来自 `activeSession.startedAt + durationMinutes`。
* `src/main/services/store.ts`：`updateDailyGuideTaskElapsed()` 只在 pause/complete 后更新任务累计时长。

### 3. 暂停和继续

观察：

* 点击暂停后顶部按钮变为“继续”，底部固定操作条也出现“继续学习”。
* 同一个恢复动作在同一页出现两个入口。
* 点击“继续学习”后右侧记录中的“开始学习”时间从 10:25 变成 10:30。

疑似问题：

* 同一页面内仍存在重复控制：顶部“继续”和底部“继续学习”；顶部“暂停”和底部“暂停”同理。
* 恢复暂停 session 时，右侧“开始学习”时间被改写，像是覆盖了首次开始时间。对于用户来说，这会让历史记录失真。

疑似代码位置：

* `src/renderer/src/pages/StudyPage.tsx`：顶部 session bar 和底部 action bar 都渲染 pause/resume。
* `src/main/services/store.ts`：`startSession()` 恢复 paused session 时将 `startedAt` 更新为 `resumedAt`。
* `src/renderer/src/pages/StudyPage.tsx`：学习记录直接展示 `activeSession.startedAt.slice(11, 16)`。

### 4. 提交结果

观察：

* 点击“提交当前结果”后打开右侧 AI 学习助手抽屉，没有强制跳 Review。
* 输入测试文本后，视觉上“提交并评估”按钮变为绿色可点。
* 无障碍树仍标记该按钮为 disabled，但实际点击成功。
* 提交通过后主页面推进到第二个任务，状态为“未开始”，计时归零。
* AI 抽屉仍停留在提交页，输入框清空，但按钮仍保持绿色视觉。
* 抽屉里显示 `评估：passed · 掌握度 100` 和 `下一步：complete_task`。

疑似问题：

* 提交后抽屉没有明确的“已完成，已进入下一任务”状态，用户会看到空提交框和已完成结果混在一起。
* `passed`、`complete_task` 是内部枚举，不应该直接展示给用户。
* 按钮视觉状态和 accessibility disabled 状态可能不同步，需要核实是否影响键盘/辅助技术用户。

疑似代码位置：

* `src/renderer/src/components/ai/AiDrawer.tsx`：直接渲染 `latestEvaluation.result` 和 `latestDecision.decision`。
* `src/renderer/src/components/ai/AiDrawer.tsx`：提交后 `setSubmission('')`，但仍停留在同一表单视图。

### 5. 返回 Today

观察：

* Today 同步为 1/2、50%、23 分钟。
* “最近学习”仍显示“计划已生成 2 个任务 · 75 分钟”，没有展示刚完成的提交或任务。

疑似问题：

* Today 主进度已经拿到任务完成状态，但最近学习列表没有接到真实完成/提交记录。
* 知识库仍显示“暂无积累，开始学习后自动记录”，即使已经完成一次提交。

疑似代码位置：

* `src/renderer/src/pages/TodayPage.tsx`：最近学习依赖 `learningState.recentStepSummaries`；如果为空就 fallback 到“计划已生成”。
* `src/main/services/store.ts`：需要确认 `saveStepSummary()` / `saveTaskSummaryAndAdjustment()` 产出的 summary 是否被 `getLearningRuntimeSnapshot()` 读出。

### 6. 进入 Review

观察：

* Review 显示学习时长 23 分钟。
* 但 Review 显示今日完成 0/2、完成率 0%。
* Today 同时显示 1/2、50%。
* Review 的“本次学习总结”标签仍出现“掌握基础分支操作”“需继续练习冲突处理”等与当前 Loop Engineering 任务不相关的硬编码内容。
* Review 有“调整建议”，并出现“采纳建议 / 保持原计划”，但当前只是本地检查通过一个主任务，用户不清楚为什么需要调整计划。

疑似问题：

* Review 完成数不应从 AI review 的 `completionScore` 推断。没有生成 review 时，应该基于 Today Guide 的 task status 计算。
* Review 存在与当前任务无关的硬编码文案。
* pending adjustment 的出现条件需要更严格，至少需要解释来源，否则会让用户误以为完成任务导致计划要调整。

疑似代码位置：

* `src/renderer/src/pages/ReviewPage.tsx`：`tasksDone` 来自 `completionScore`，不是 `guide.tasks.filter(status === 'done')`。
* `src/renderer/src/pages/ReviewPage.tsx`：review tag row 存在固定标签文案。
* `src/main/services/store.ts`：`saveTaskSummaryAndAdjustment()` 可能在 `complete_task` 场景也创建 pending adjustment，需核实。

### 7. Settings

观察：

* 没有看到浮窗、计时提醒、自动复盘等残留控件。
* Settings 只剩 AI 助手、学习偏好、账户与版本、数据与记录。

结论：

* 设置页职责已明显收敛。

## 问题分级

### P0 / 高优先级

1. Review 与 Today 任务完成统计不一致。
   * 复现：完成第 1 个主任务后 Today 显示 1/2、50%；Review 显示 0/2、0%。
   * 风险：用户会认为主流程仍有多套状态源。

2. 暂停恢复会改写“开始学习”时间。
   * 复现：暂停前记录 10:25，恢复后变为 10:30。
   * 风险：学习记录不可信，计时历史像被重置。

### P1 / 中高优先级

3. Study 页同一动作有重复控制。
   * 暂停状态同时有顶部“继续”和底部“继续学习”。
   * active 状态同时有顶部“暂停”和底部“暂停”。

4. AI 抽屉展示内部枚举值。
   * `passed`、`complete_task` 应转为中文用户语言。

5. Today 最近学习/知识库没有反映刚完成的任务。
   * 主进度正确，但最近学习仍 fallback 到“计划已生成”。

### P2 / 中优先级

6. Today 到 Study 的入口可发现性偏弱。
   * 当前边界正确，但只有一句提示，没有明确“通过左侧学习页继续”的提示或当前任务状态入口。

7. Review 硬编码标签与当前任务不匹配。
   * “基础分支操作”“冲突处理”与 Loop Engineering 当前任务无关。

8. 提交后 AI 抽屉状态不够清晰。
   * 表单清空后仍在提交页，按钮视觉可用，结果在下方，缺少明确完成态。

## Debug Plan

### 第一阶段：统一统计口径

1. 修正 `ReviewPage` 统计来源。
   * `tasksDone = guide.tasks.filter(task.status === 'done').length`
   * `tasksTotal = guide.tasks.length`
   * `completionScore = tasksTotal ? round(tasksDone / tasksTotal * 100) : 0`
   * 有 AI review 时，AI 的 `completionScore` 只作为复盘评分或解释，不覆盖事实统计。

2. 增加回归测试。
   * 构造 todayGuide：2 个任务、1 个 done。
   * 断言 Today 与 Review 都显示 1/2、50%。

3. 核查 `pendingAdjustment` 生成条件。
   * `complete_task` 且没有明确调整建议时，不应生成 pending adjustment。
   * 若必须显示，应在 Review 中说明来源：“基于上次评估建议”。

### 第二阶段：修复 session 时间语义

1. 区分首次开始和最近恢复。
   * 方案 A：Study 记录显示 `createdAt/firstStartedAt`，恢复时不覆盖。
   * 方案 B：保留 `startedAt` 表示本段开始，但右侧记录改为“恢复学习 HH:mm”，不要叫“开始学习”。

2. 修改 `store.startSession()` 恢复 paused session 的行为。
   * 如果继续沿用同一 session，避免把用户可见“开始学习”时间当作首次开始。
   * 若要记录多段 session，建议新增 resume event 或 focus event，不要复用 startedAt 作为两种含义。

3. 明确 Today 学习时长包含什么。
   * 如果只展示已落库累计时长，应标注“已记录时长”。
   * 如果要展示当前运行中时长，应把 active session elapsed 合并进去。

### 第三阶段：收敛 Study 页操作层级

1. 只保留一个暂停/继续入口。
   * 建议顶部 session bar 保留状态展示和计时。
   * 底部 action bar 保留主动作：完成步骤 / 提交当前结果 / 遇到问题。
   * 暂停/继续放顶部，底部不重复。

2. 状态矩阵复核。
   * 未开始：底部主按钮“开始学习”。
   * 进行中：顶部“暂停”，底部“完成当前步骤/提交当前结果”。
   * 暂停：顶部“继续”，底部不再重复继续。
   * 完成任务后：下一任务未开始，只显示“开始学习”。

### 第四阶段：清理 AI 抽屉用户语言

1. 枚举映射中文。
   * `passed` -> “已通过”
   * `partial` -> “部分完成”
   * `failed` -> “未通过”
   * `unclear` -> “需要补充”
   * `complete_task` -> “当前主任务已完成”
   * `remediate` -> “需要修改后再提交”

2. 提交成功后切换为明确结果态。
   * 显示“已提交并完成评估”。
   * 提供“查看下一任务”或“继续提交修改”的上下文动作，但不要强制跳页。

3. 检查按钮 accessibility 状态。
   * 确认输入后 `disabled` 属性和视觉状态一致。
   * 用 keyboard Tab / Enter 验证可达性。

### 第五阶段：修复 Today 最近学习与知识库空态

1. 核查 `recentStepSummaries` 生成与读取。
   * 完成主任务后应至少出现一条“完成任务：xxx”或“提交通过：xxx”。

2. 修改 fallback 逻辑。
   * 只有完全没有执行记录时才显示“计划已生成”。
   * 有提交或 task done 时，优先展示真实记录。

3. 知识库空态根据 summary 数量调整。
   * 已有学习记录但无知识卡片时，文案应为“已有学习记录，知识卡片待整理”，避免说“暂无积累”。

## 建议验证脚本

完成修复后至少验证：

1. `npm run typecheck`
2. `npm test`
3. 手工 GUI 回归：
   * 启动后无浮窗。
   * Today 初始状态无开始按钮。
   * Study 开始、暂停、继续、提交。
   * 提交通过后 Study 进入下一任务未开始。
   * Today 与 Review 均显示 1/2、50%。
   * Review 无硬编码 Git/冲突标签。
   * Settings 无浮窗/计时提醒/自动复盘控制。
