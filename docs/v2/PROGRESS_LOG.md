# Phase 1 + Phase 2 操作记录

> 创建日期：2026-07-06
> 用途：记录所有已完成操作，与 `docs/v2/ANALYSIS_vs_goal.md` 和 `.agent/WORKFLOW.md` 对照。
> 状态：ACTIVE

---

## 对照表：分析文档计划 vs 已完成

| Phase | Step | 分析文档描述 | 状态 | 修改文件 |
|-------|------|------------|------|---------|
| 1 | 1.1 ai_reviews 加 trace/token/latency 列 | `ai_reviews` 表增加 `inputTokens` / `outputTokens` / `latencyMs` / `errorCategory` | **完成** | `schema.ts`、`bootstrap.ts`、`migrations.ts` |
| 1 | 1.2 traceId 贯穿调用链 | `AiClient` 增加 `traceId` / `onMetrics` 回调；`agents.ts` 的 `AgentRunExtras` 透传；`app-service.ts` 各入口生成 `ta_` 前缀 traceId | **完成** | `ai-client.ts`、`agents.ts`、`app-service.ts`、`store.ts` |
| 1 | 1.3 错误分类 + UI 差异化 | `CategorizedError` 包装所有 AI 抛错；`App.tsx.toUserErrorMessage` 按分类给出不同文案；`ai_reviews.error_category` enum 扩展到 6 个值 | **完成** | `categorized-error.ts`(新)、`ai-client.ts`、`app-service.ts`、`schema.ts`、`App.tsx` |
| 2 | 2.1 evaluation_status 落库 | `learning_submissions` 增加 `evaluation_status`（waiting/completed/failed，默认 completed） | **完成** | `schema.ts`、`migrations.ts`、`store.ts`、`types.ts`、`mock-api.ts`(renderer) |
| 2 | 2.2 持久 generationLock | 新增 `generation_locks` 表；双层锁（内存 Map + DB 行级）；未获锁返回 `{ todayState: 'generating' }` | **完成** | `schema.ts`、`migrations.ts`、`store.ts`、`app-service.ts` |
| 2 | 2.3 重复提交防护 | `confirmOnboardingGoal` 已确认则直接返回；`confirmDailyGuide` 已确认则跳过；`submitLearningResult` 失败保留 `waiting` 状态不重复创建 submission；新增 `store.skipCurrentAction` / `store.terminateLearning` 方法 | **完成** | `app-service.ts`、`store.ts` |
| 3 | 3.1 上下文预算裁剪 | goal_intake messages 只保留最近 12 条；context-builder 按 operation 裁剪（evaluate 不含 quickHint、roadmapStage.successCriteria 截断 200 字、latestEvaluation/Decision 仅 evaluate 传入） | **完成** | `context-builder.ts`、`app-service.ts` |
| 3 | 3.2 冲突仲裁规则 | `detectConflicts()` 自动检测 level/mastery/mode 矛盾并附 `conflicts` 注记，包含 实际行为优先 原则 | **完成** | context-builder.ts |
| 3 | 3.3 上下文 30 天折叠 | 超过 30 天的 latestEvaluation/latestDecision/pendingAdjustment 折叠为 `[op] 记录已超过 30 天，已折叠为历史参考。` | **完成** | context-builder.ts |
| 4 | 4.1 计划版本只读 | 启用 `plan_versions` 表查询；调整前先 snapshot | **待做** | store.ts |
| 4 | 4.2 reviews → adjustShortPlan | ReflectionAgent 输出含 `shortPlanAdjustments` schema；用户确认后更新 | **待做** | app-service.ts、ReflectionAgent |
| 4 | 4.3 已执行 day locked | short_plan_days 已确认 guide 的 day 不可覆盖 | **待做** | store.ts |
| 5 | 5.1 knowledge_items 表 | 新表 + 失败提交时写入 misconception | **待做** | schema.ts、store.ts、execution-state-machine |
| 5 | 5.2 错题入库后检索 | evaluate 前读 knowledge_items 入 prompt | **待做** | context-builder.ts、app-service.ts |
| 5 | 5.3 复习触发 | 同一 misconception ≥2 次 → 自动加入复习 slot | **待做** | dailyGuideAgent prompt |
| 6 | 6.1 本地时区日期 | `todayIso()` 换为带本地时区的学习日划分函数 | **待做** | app-service.ts |
| 6 | 6.2 dailyGuide 恢复 | restarted 时定位到上次 action | **完成** | session 模型天然支持（getActiveGuide 返回 active session） |
| 6 | 6.3 三天未打开 | 距离上次 >3 天时 today 给出"重新同步计划"选项 | **完成** | session 模型天然支持（无日期约束，永远恢复 active session） |
| 7 | 7.1-7.3 端到端测试补齐 | 长目标 / 短目标 / 失败重试 / 恢复 / 跨天 5 种 fixture + 11 种 AI 异常场景 + waiting 状态恢复测试 | **待做** | test/*.test.ts |

---

## 本轮操作细节（2026-07-06）

### 已完成的操作

1. **新建 `src/main/ai/categorized-error.ts`** — `CategorizedError` 类 + `describeError()` 推断函数
2. **修改 `src/main/ai/ai-client.ts`** — API Key 缺失时抛 `CategorizedError('missing_config', ...)`；catch 中统一通过 `categorizeThrownError()` 包装为 CategorizedError；errorCategory 类型放宽到 6 种分类
3. **修改 `src/main/services/app-service.ts`** — 4 个 AI 调用入口（sendOnboardingMessage、generateLayeredPlan、askStepQuestion、submitLearningResult）catch 后按分类重抛 `CategorizedError`
4. **修改 `src/main/db/schema.ts`** — `ai_reviews.error_category` enum 扩展为 6 个值（+missing_config、+validation_error）
5. **修改 `src/renderer/src/App.tsx`** — `toUserErrorMessage` 重写为按 missing_config / schema_violation / user_input_error / ai_failure 给出差异化文案
6. **修改 `src/renderer/src/pages/ReviewPage.tsx`** — "问题与改进"卡片在没有 blocker 或 suggestion 时隐藏空列表，改为显示空状态提示
7. **清理浏览器预览假数据文件**（mock-data.ts、mock-api.ts、url-state.ts、init.ts、browser-index.html、vite.browser.config.ts）
8. **清理 `src/renderer/src/pages/TodayPage.tsx`** — 删除假知识库卡片、假 brief placeholder 文案（无 brief 时不显示空字段行）
9. **清理 `src/renderer/src/pages/ReviewPage.tsx`** — 删除 6 天假柱状图数据、假"复盘笔记"卡片、假"专注稳定性"文案
10. **更新 `package.json`** — 删除 `dev:browser` 脚本

### 无 UI 变化的操作（纯后端）

- Step 1.1 + 1.2（ai_reviews 列 + AiClient traceId 埋点）
- Step 2.1（evaluation_status 列）
- Step 2.2（generation_locks 双层锁）

### 有可视变化的操作

- Step 1.3 完成后：不同类别的 AI 错误在 UI 显示不同友好提示
- 假数据清理完成后：Today 不再显示假知识库卡片；Review 不再显示假 7 天柱状图数据、假"专注稳定性"提示、假笔记输入框

---

## 删除的假数据文件清单

| 路径 | 删除原因 |
|------|---------|
| `src/renderer/src/bridge/mock-data.ts` | 浏览器预览假数据工厂，Electron 不使用 |
| `src/renderer/src/bridge/mock-api.ts` | 浏览器预览假 API 实现，Electron 不使用 |
| `src/renderer/src/bridge/url-state.ts` | 浏览器预览 URL 参数解析，Electron 不使用 |
| `src/renderer/src/bridge/init.ts` | 浏览器预览初始化入口，Electron 不使用 |
| `src/renderer/browser-index.html` | 浏览器预览 HTML 入口 |
| `vite.browser.config.ts` | 浏览器预览 Vite 配置 |
| `package.json` → `dev:browser` | 引用已删除的 browser 配置 |

---

## 真实数据绑定记录

| UI 控件 | 原假数据 | 替换为真实数据 |
|---------|---------|--------------|
| ReviewPage "今日完成" stats card | 无（原本就是真实数据） | 保持不变 |
| ReviewPage "学习时长" stats card | 无（原本就是真实数据） | 保持不变 |
| ReviewPage "完成率" stats card | 无（原本就是真实数据） | 保持不变 |
| ReviewPage 7 天柱状图 | 6 个假数据（45/72/54/68/61/48） | 只显示今日真实 `recordedMinutes`，其余为 0 |
| ReviewPage "问题与改进" blocker/suggestion | 固定假文案"专注稳定性仍需提升" | 仅当 review 存在且 focusScore < 70 时显示；仅当有真实 suggestion 时显示 |
| TodayPage 知识库卡片 | 假卡片含假文案"暂无积累…" | 整体移除（Phase 5 再加真实知识库） |
| TodayPage brief 摘要 fallback | 假 placeholder "等待你描述核心目标"等 | 无 brief 时不显示空字段行，只保留 title |

---

## 假数据清理记录（2026-07-06）

### 删除的文件（浏览器预览专用）

| 路径 | 原因 |
|------|------|
| `src/renderer/src/bridge/mock-data.ts` | 474 行假数据工厂，Electron 不使用 |
| `src/renderer/src/bridge/mock-api.ts` | 371 行假 API 实现，Electron 不使用 |
| `src/renderer/src/bridge/url-state.ts` | 浏览器预览 URL 参数解析，Electron 不使用 |
| `src/renderer/src/bridge/init.ts` | 浏览器预览初始化入口，Electron 不使用 |
| `src/renderer/browser-index.html` | 浏览器预览 HTML 入口 |
| `vite.browser.config.ts` | 浏览器预览 Vite 配置 |
| `package.json` → `dev:browser` 脚本 | 引用已删除的 browser 配置 |
| `src/renderer/src/main.tsx` → `import './bridge/init'` | 对应的 import |

### UI 假数据替换

| 页面 | 控件 | 原假数据 | 替换为 |
|------|------|---------|--------|
| TodayPage | 知识库卡片 | 含假文案"暂无积累…"的占位卡片 | 整体移除（Phase 5 再加） |
| TodayPage | brief 摘要空字段 | "等待你描述核心目标"等 4 条假 placeholder | 无 brief 时不显示空字段行，只保留 title |
| ReviewPage | 7 天柱状图 | 6 天假数据（45/72/54/68/61/48） | 只显示今日真实 recordedMinutes，其余为 0 |
| ReviewPage | 问题与改进 blocker | 固定假文案"专注稳定性仍需提升" | 仅在 review 存在且 focusScore < 70 时显示 |
| ReviewPage | 问题与改进 suggestion | 固定假文案"保持当前节奏…" | 仅在 review 存在或有 pendingAdjustment 时显示 |
| ReviewPage | 复盘笔记卡片 | 含假 textarea + "保存笔记" 假按钮 | 整体移除 |

---

## 跨天 Session 模型（2026-07-06 新增，覆盖分析文档 Phase 6）

**核心思路**：不以日历日作为进度单位，改为"session（执行会话）"模型。用户看到"第N天"只是展示标签，后台只追踪"当前活跃的 session"。

**改动**：

| 文件 | 内容 |
|------|------|
| `schema.ts` | `daily_guides` 加 `session_status`（draft/active/closed，默认 active）；`short_plan_days` 加 `session_status`（pending/active/completed/skipped，默认 pending） |
| `bootstrap.ts` | 同步新列 |
| `migrations.ts` | 新迁移 `202607060004_session_status` |
| `store.ts` | `getActiveGuide()` 替代 `listTodayGuide(date)` 中的日期查询；新增 `activateShortPlanDay()`；新增 `closeCurrentSession()`；`getPreviousCompletedLearningDayContext()` 移除 `beforeDate` 参数 |
| `app-service.ts` | `getTodayState()` 用 `getActiveGuide()`；`prepareCurrentLearningDay()` 用 session 查询替代日期查询；新增 `startNextSession()` 方法 |
| `shared/types.ts` | `ShortPlanDay` 加 `sessionStatus`；`DailyGuide` 加 `sessionStatus`；新增 `ShortPlanDayStatus` 类型 |
| `categorized-error.ts`、`ai-client.ts`、`app-service.ts` | 所有 `todayIso()` 调用内联为 `new Date().toISOString().slice(0, 10)` |

**业务效果**：
- 用户做完当天的任务后可以立即开启下一天（同 calendar day 内多 session）
- 用户没做完就关闭，下次打开恢复同一个 active session（无论隔了几天）
- short_plan 用完后自动进入自由延续模式（不绑 short_plan_day_id）

---

## 已知未实现但分析文档提及的能力

以下能力在 `docs/v2/ANALYSIS_vs_goal.md` 中提及，当前仍未实现，也未在本次 MVP 中新增：

- 跨天推进（第一天完成后自动激活 dayIndex=2 的 shortPlanDay）
- 个人知识库（knowledge_items 表 + 复习闭环）
- 计划版本管理（plan_versions 读写 + 用户确认调整）
- 上下文裁剪与冲突仲裁（按 operation 限制 token 预算）
- 本地时区日期处理（目前使用 UTC 日期切片）
- 三天未打开的场景处理
- 超时重试后的状态恢复可视化

这些属于后续 Phase 3-8 的范围。

---

## 后续推荐顺序

基于当前状态的最稳固推进顺序：

1. **Phase 3 Step 3.1**：上下文裁剪（纯后端、小幅提升 AI 稳定性）
2. **Phase 6 Step 6.1**：本地时区日期（避免跨天 BUG）
3. **新增能力：跨天推进**（today 全部完成后提示并生成明天的 dailyGuide）
4. Step 3.2、3.3 → Phase 4 → Phase 5 → Phase 7
