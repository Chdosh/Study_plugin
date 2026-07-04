# 项目记忆

本文件是新对话的短交接入口，不是完整日志。完整早期历史已归档到 `docs/archive/PROJECT_MEMORY_FULL_2026-07-03.md`；除非追溯旧决策，否则不要读取归档。

## 当前状态

* 项目是本地优先 Windows 桌面 AI 学习系统，当前 MVP 已收敛为“主动访谈 -> 分层计划 -> 主任务制 Daily Guide -> Focus Session -> 主任务最终提交/评估 -> 日终复盘”的学习闭环。
* 技术栈：Electron + React + TypeScript，SQLite/libSQL + Drizzle ORM，OpenAI-compatible DeepSeek client，Zod runtime validation，typed preload API + narrow IPC。
* SQLite 是 durable source of truth。Drizzle schema 在 `src/main/db/schema.ts`，schema 变更必须使用迁移。
* 默认自动回归使用 fake AI GUI smoke；真实 DeepSeek 合约测试是 opt-in，不作为默认自动 PASS 门槛。

## 当前主流程

```text
AI 主动访谈澄清目标
→ 用户确认目标理解
→ AI 生成长期大纲、前三天短期计划、第一天主任务执行稿
→ 用户确认今日执行稿
→ Today 聚焦当前主任务，其他主任务折叠
→ 用户围绕主任务开启一个或多个 Focus Session
→ Action / Checkpoint 本地记录执行进度
→ 主任务最终提交
→ local 任务走本地验证器，ai 任务最多调用一次 evaluate_submission
→ 本地状态机决定完成、继续修改、保存进度或进入下一任务
→ 每天最多一次综合复盘，并由用户确认调整建议
```

当前新闭环使用 `goal_intakes`、`roadmap_stages`、`short_plan_days`、`daily_guides`、`daily_guide_tasks`、`daily_guide_actions` 保存访谈、长期大纲、短期计划、今日主任务和执行动作。`daily_plan_blocks` / `daily_guide_blocks` 暂时保留为旧版兼容和 session 锚点，不再代表固定 10 分钟任务块，不能直接删除。

## 上下文管理

`src/main/services/context-builder.ts` 是 AI 上下文入口。它按操作类型读取当前快照，只包含当前 goal/stage/task/block/step、最近最多 3 条步骤摘要、当前问题分支最后几条消息、最新提交/评估/决策和 pending adjustment。

不得退回到“把完整聊天历史发送给模型”的实现。完整历史可以存在数据库中，但模型只接收当前操作需要的工作上下文。

## 关键决策

* AI 输出只是 proposal，验证并在必要时经用户确认后才能影响计划或持久状态。
* Daily Guide 输出少量主任务，不输出固定 Time Block。主任务通常 2～4 个，默认优先 3 个；复杂或时间少时可以只有 1 个。
* 当前实现为真实模型稳定性允许每个主任务至少 1 个 Action；prompt 鼓励 3～6 个 Action。
* Focus Session 的开始、暂停、恢复、结束和超时只写本地记录，不触发 AI。
* 主任务是唯一最终提交和评估单位。`evaluationMode=local` 不调用模型；`evaluationMode=ai` 最多调用一次 `evaluate_submission`。
* 当前主流程不再固定调用 `decide_next_step` / `next_step_decision`；本地状态机根据评估结果决定通过、继续修改、保存进度或进入下一任务。
* 日终复盘按主任务汇总，每天最多一次；未完成任务可在复盘中建议继续、缩小、拆分、延后或放弃，但必须由用户确认。
* DeepSeek 真实合约测试为 opt-in：`RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts`。

## 最近完成

### 2026-07-04 新参考图四页面 UI 复刻与 CSS 清理

根据最新四张参考图，重绘 Today、Study、Review、Settings 四个页面的桌面布局。侧栏恢复品牌信息与底部学习者入口；Today 聚焦今日目标、任务列表、今日进度与最近学习；Study 聚焦会话条、当前步骤、右侧任务大纲/记录/进度与底部操作栏；Review 聚焦三项统计、学习总结、时间线、最近 7 天与问题建议；Settings 去掉已废弃的时间拆分/学习时间窗模块和提示词编辑卡，仅保留 AI 助手、学习偏好、账户版本、通知浮窗、数据记录。

关键决策：本轮只调整 renderer UI、拆分 CSS 和 GUI smoke 脚本，不修改数据库 schema、IPC、AI schema 或业务状态机。通过重写 `tokens/layout/components/today/study/review/settings` 样式文件减少旧层叠覆盖，构建产物主 CSS 约 63.62KB。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`node scripts/electron-gui-smoke.mjs` 均通过；修复浏览器预览初始路由后，分别截取并查看 Today、Study、Review、Settings 四页截图，确认不再重复截同一页面，截图位于 `output/playwright/*-redesign.png`。

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

验证：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd test`、`node scripts/electron-gui-smoke.mjs` 均通过。

### 2026-07-04 UI 可读性与 Markdown 渲染优化

修复窗口缩小时全页面文字挤在左侧窄列、输入框占比过大、Today/Study 标题和内容重复的问题。Today 顶部目标区改为“总目标 + 元信息标签 + 主按钮”，面包屑去除相邻重复项；当前任务详情把执行动作和完成标准改为结构化列表；Study 顶部使用短标题，主面板标题改为任务说明，避免长标题在 session bar 和内容卡中重复。

关键决策：AI 返回文本用 renderer 轻量 Markdown 渲染处理标题、段落、无序/有序列表和代码块，不新增 Markdown 依赖，不改变 AI 输出 schema、业务服务、IPC 或数据库结构。

验证：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd test`、`node scripts/electron-gui-smoke.mjs` 均通过；Electron/CDP 在 1280px 窗口下截图检查 Today/Study 无横向溢出，Markdown 展开态能保留标题、列表和代码块。

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

验证：文档关键词扫描和内容映射检查通过；本轮仅修改文档，未运行代码 typecheck/test/build。

### 2026-07-04 修复主流程 dailyGuideAgent 持续失败

真实 AI 在 `dailyGuideAgent` 阶段持续失败，根因是 prompt 上下文冗长且 schema 对 `actions` 硬性要求至少 3 个。已精简 `buildDailyGuidePrompt`，移除对 `docs/Example.md` 的隐式引用，给出完整 JSON 示例；`actions` schema 最小数量从 3 放宽到 1，`tasks` 最大数量收紧到 4，并增加 `estimatedMinutes.min <= target <= max` 校验；`DailyGuideAgent` 超时提升到 120 秒；失败写入 `ai_reviews`。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`node scripts/electron-gui-smoke.mjs` 均通过。

### 2026-07-04 历史会话管理与按钮反馈增强

新增历史会话浏览入口，可查看历史目标访谈记录、消息详情并据此重新生成计划。修复“重新生成当日计划”按钮无反馈问题，增加加载遮罩和醒目错误提示。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`node scripts/electron-gui-smoke.mjs` 均通过。

### 2026-07-04 主任务制每日计划与计时流程

每日执行稿从固定 10 分钟 block 改为“任务决定时长”的主任务结构。新增 `daily_guide_tasks`、`daily_guide_actions` 表和迁移；旧 block 表保留为兼容。Focus Session 不判定任务完成；主任务最终提交后只按 `evaluationMode` 走本地验证或一次 AI 评估。

验证：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`node scripts/electron-gui-smoke.mjs` 均通过。

### 2026-07-04 四页面布局与视觉统一重构

参考 UI 示意图统一重构 Today、Study、Review、Settings 四个页面的布局与视觉样式。本轮只调整页面结构、排版和组件样式，未修改业务逻辑、数据结构、状态流转和功能入口。

关键变更：
- 删除主内容区顶部重复的页面大标题与副标题（今日/学习/复盘/设置），由左侧导航表达当前页面
- 重构侧边栏：移除“学习管家”“AI 学习助手”文字，仅保留 Logo；在 Logo 右侧增加折叠/展开按钮；支持手动折叠（仅显示图标），折叠后主内容区自动扩大；当前导航保持明确高亮
- 内容区整体上移，减少顶部空白；页面边距、卡片圆角、按钮高度、内容间距统一
- 普通卡片使用中性浅灰边框，青绿色仅用于当前状态、进度、选中导航和主要操作；降低装饰性阴影/渐变
- Today 页：顶部总目标卡片 + 任务列表（序号、状态徽章、当前标识）+ 右侧今日进度环形图 + 最近学习
- Study 页：顶部会话状态栏（任务名、步骤进度、计时器、暂停/继续）+ 当前步骤卡片（操作说明/完成标准/遇到问题）+ 右侧任务大纲/学习记录/当前进度 + 底部固定操作栏
- Review 页：顶部三项统计卡片 + 本次总结 + 学习记录时间线 + 右侧最近 7 天柱状图 + 问题与改进 + 底部“开始下一次学习/查看全部历史”
- Settings 页：改为三栏卡片网格（AI 助手、学习偏好、账户与版本、通知与浮窗、数据与记录、提示词档位），保留原有字段与保存逻辑

修改文件：
- `src/renderer/src/main.tsx` - 重构 Sidebar/App（折叠状态、移除 TopBar）、TodayView、StudyView、ReviewView、SettingsView JSX
- `src/renderer/src/styles.css` - 在文件末尾追加统一布局与视觉样式块，覆盖侧边栏、四页面卡片、响应式行为

验证：`npm run typecheck`（通过）、`npm test`（31 passed, 1 skipped）、`npm run build`（成功）。

## 当前风险

* 真实 DeepSeek 完整主流程仍需人工验收一次，确认当前 daily guide prompt 在真实模型下稳定。
* 底层旧 plan/block 数据结构仍是 session 复用路径的一部分；后续清理必须先替换 `daily_guide_block -> daily_plan_block` 的执行映射。
* 提问、主任务最终提交、复盘调整等入口已按新主任务制规划，但仍需持续检查是否还有旧 block/step 语义遗留。
* `docs/` 中保留历史产品/UI 文档，可能包含旧“当前块”“10 分钟块”等表述；默认不作为当前规范。

## 推荐下一步

1. 用真实 DeepSeek API 验收一次完整分层计划生成。
2. 检查提问、提交评估、复盘调整是否完全接到当前 `daily_guide_tasks` 主流程。
3. 设计替换旧 block/session 锚点的最小迁移方案，再清理旧 plan 结构。
4. 新功能开发前读取 `AGENTS.md`、本文件和对应专题文档。
