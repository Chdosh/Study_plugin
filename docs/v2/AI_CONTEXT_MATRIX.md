# V2 AI Context Matrix

> 只读审计，冻结于 2026-07-05。列出所有真实 AI 调用的完整上下文链路。
> 限制 150 行。

## 当前 AI 调用全景

共 8 个 Agent 类，其中 7 个在主流程中调用，1 个（NextStepDecisionAgent）为死代码。

### 1. GoalIntakeAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.sendOnboardingMessage()` [app-service.ts](src/main/services/app-service.ts:57) | AI Task: `goal_intake` |
| 上下文来源 | 当前 intake 的全部消息（GoalIntakeMessage[]） | Event 流中 intake 相关消息 |
| 读取聊天记录 | 是：intake 内全部消息 | V2 按最近 N 条截断 |
| 输出 Schema | `goalIntakeAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:146) | 复用 |
| 输出写入 | `goal_intakes.briefJson` + 新 assistant 消息 | Artifact（GoalBrief）+ Event（消息） |
| Prompt | `buildGoalIntakePrompt()` [agent-prompts.ts](src/main/ai/agent-prompts.ts:23) | 归入 AI Task profile |
| 失败策略 | 异常冒泡到 renderer，不落库 | 保持 |

### 2. RoadmapAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.generateLayeredPlan()` 第一步 [app-service.ts](src/main/services/app-service.ts:93) | AI Task: `generate_roadmap` |
| 上下文来源 | goal + brief（GoalBrief）+ promptProfile | Journey 快照 + Artifact(brief) |
| 读取聊天记录 | 否：只读取结构化 brief | — |
| 输出 Schema | `roadmapAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:157) | 复用 |
| 输出写入 | `roadmap_stages` 表 | Artifact（Roadmap） |
| Prompt | `buildRoadmapPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡，不保存部分结果 | 保持 |

### 3. ShortPlanAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.generateLayeredPlan()` 第二步 [app-service.ts](src/main/services/app-service.ts:109) | AI Task: `generate_short_plan` |
| 上下文来源 | goal + brief + 上一步 roadmap 输出 | Artifact(brief) + Artifact(roadmap) |
| 读取聊天记录 | 否 | — |
| 输出 Schema | `shortPlanAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:168) | 复用 |
| 输出写入 | `short_plan_days` 表 | Artifact（ShortPlan） |
| Prompt | `buildShortPlanPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡（roadmap 已保存，不回滚） | V2 需事务化 |

### 4. DailyGuideAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `generateLayeredPlan()` 第三步 [app-service.ts](src/main/services/app-service.ts:131) + `doPrepareCurrentLearningDay()` [app-service.ts](src/main/services/app-service.ts:197) | AI Task: `generate_daily_guide` |
| 上下文来源 | goal + brief + roadmap + targetDay(ShortPlanDay) + previousDayResult + studyWindows | Artifact(brief+roadmap+shortPlan) + 前一日 Event(evaluation+review) |
| 读取聊天记录 | 否：只读取结构化前一日摘要 | — |
| 输出 Schema | `dailyGuideAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:187) | 复用 |
| 输出写入 | `daily_guides` + `daily_guide_tasks` + `daily_guide_actions` | Artifact（DailyGuide） |
| Prompt | `buildDailyGuidePrompt()` | 归入 AI Task |
| 失败策略 | 写入 ai_reviews(status=failed)；保留 shortPlanDay.date 已激活状态；允许手动重试 | 保持。V2 应保留为 Artifact draft |

### 5. TeachStepAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.teachCurrentStep()` [app-service.ts](src/main/services/app-service.ts:233) | AI Task: `teach_step` |
| 上下文来源 | ContextBuilder.build('teach_step') → snapshot（goal/stage/task/block/step + recentStepSummaries） | Artifact(当前 task/action) + 最近 Event |
| 读取聊天记录 | 否：仅读取最近 3 条 step summary | — |
| 输出 Schema | `teachStepAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:241) | 复用 |
| 输出写入 | 更新 `learning_steps` 行（旧 step 模型） | V2 应写入 Event（teaching event）而非覆盖 Artifact |
| Prompt | `buildTeachStepPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡 | 保持 |

### 6. StepQuestionAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.askStepQuestion()` [app-service.ts](src/main/services/app-service.ts:252) | AI Task: `answer_question` |
| 上下文来源 | ContextBuilder.build('answer_step_question') + 用户问题文本 | Artifact(当前 task/action) + Event(最近消息) |
| 读取聊天记录 | 是：当前问题分支最近 4 条消息 | V2 归入 Event 流 |
| 输出 Schema | `answerStepQuestionAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:254) | 复用 |
| 输出写入 | `question_messages`（assistant 消息）+ `question_threads`（状态更新） | Event（消息） |
| Prompt | `buildAnswerStepQuestionPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡 | 保持 |

### 7. SubmissionEvaluationAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.submitLearningResult()` [app-service.ts](src/main/services/app-service.ts:303) — 仅在 evaluationMode=ai 时调用 | AI Task: `evaluate_submission` |
| 上下文来源 | ContextBuilder.build('evaluate_submission') → snapshot（提交内容 + goal/stage/task/block/step + latestSubmission/Evaluation/Decision） | Artifact(task.doneWhen) + Event(submission) |
| 读取聊天记录 | 否 | — |
| 输出 Schema | `submissionEvaluationAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:298) | 复用 |
| 输出写入 | `learning_evaluations` + `next_step_decisions`（本地函数生成） | Artifact（Evaluation） |
| Prompt | `buildEvaluateSubmissionPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡 | 保持 |

### 8. ReflectionAgent

| 维度 | 当前实现 | V2 对应 |
|------|----------|---------|
| 调用入口 | `AppService.generateReview()` [app-service.ts](src/main/services/app-service.ts:211) | AI Task: `generate_review` |
| 上下文来源 | `store.getDaySnapshot(date)` — 当日全量快照（guide + tasks + blocks + sessions + submissions + evaluations + decisions） | Artifact(当日所有) + Event(当日所有) |
| 读取聊天记录 | 否：只读取结构化快照 | — |
| 输出 Schema | `reviewAgentOutputSchema` [schemas.ts](src/shared/schemas.ts:113) | 复用 |
| 输出写入 | `ai_reviews` 表（outputJson 字段） | Artifact（Review） |
| Prompt | `buildReviewPrompt()` | 归入 AI Task |
| 失败策略 | 异常冒泡 | 保持 |

## 上下文组装器判定

`ContextBuilder` [context-builder.ts](src/main/services/context-builder.ts:18) 是当前所有 teach/evaluate/question 调用的上下文入口。

| 维度 | 判定 |
|------|------|
| 可复用性 | **核心复用**：按操作类型组装上下文的模式正确 |
| 需要转换 | `LearningRuntimeSnapshot` 来源是旧 `learning_runtime_states` + `learning_steps`；V2 应从 Journey 快照 + Event 流组装 |
| 需要转换 | `recentStepSummaries` 来自 `learning_summaries` 表（L5 摘要），该摘要机制未真正落地（仅有 schema，无生成逻辑） |
| 需要转换 | `block` / `step` 字段使用旧模型；V2 应替换为 task / action |

## V2 AI Task 映射汇总

| V2 AI Task | 当前 Agent | Prompt 文件 | Schema 文件 | 上下文配方 |
|------------|-----------|------------|------------|-----------|
| `goal_intake` | GoalIntakeAgent | buildGoalIntakePrompt | goalIntakeAgentOutputSchema | Event(最近消息) |
| `generate_roadmap` | RoadmapAgent | buildRoadmapPrompt | roadmapAgentOutputSchema | Artifact(brief) |
| `generate_short_plan` | ShortPlanAgent | buildShortPlanPrompt | shortPlanAgentOutputSchema | Artifact(brief+roadmap) |
| `generate_daily_guide` | DailyGuideAgent | buildDailyGuidePrompt | dailyGuideAgentOutputSchema | Artifact(brief+roadmap+shortPlan) + Event(前日) |
| `teach_step` | TeachStepAgent | buildTeachStepPrompt | teachStepAgentOutputSchema | Artifact(task+action) + Event(最近) |
| `answer_question` | StepQuestionAgent | buildAnswerStepQuestionPrompt | answerStepQuestionAgentOutputSchema | Artifact(task+action) + Event(消息) |
| `evaluate_submission` | SubmissionEvaluationAgent | buildEvaluateSubmissionPrompt | submissionEvaluationAgentOutputSchema | Artifact(task.doneWhen) + Event(submission) |
| `generate_review` | ReflectionAgent | buildReviewPrompt | reviewAgentOutputSchema | Artifact(当日) + Event(当日) |

## AI Client 判定

`AiClient` [ai-client.ts](src/main/ai/ai-client.ts:13)：OpenAI-compatible → DeepSeek，含自动 JSON 解析 + 一次修复重试。

**可复用**：V2 直接复用，只需配接新的 AI Task 上下文配方格式。
