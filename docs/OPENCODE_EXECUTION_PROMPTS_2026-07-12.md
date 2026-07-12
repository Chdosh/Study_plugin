# OpenCode 接力执行提示

状态：ACTIVE  
建立日期：2026-07-12  
用途：供代码能力较弱的 Agent 按小步、可验证、可复审方式继续 `PRODUCT_REVIEW_REMEDIATION_2026-07-12.md`。每段提示必须单独执行；一段完成后停止，等待 Codex 审查，不得连续执行下一段。

## 0. 每次任务都要附带的固定约束

把下面内容放在每个 OpenCode 任务开头：

```text
你正在维护 D:\work\study_plugin。

必须先完整读取 AGENTS.md，并遵守其中事实源、Git 禁令、数据迁移、AI 安全和验证规则。当前工作树很脏，所有既有修改都属于用户或前序 Agent：禁止 git reset/restore/checkout/clean/stash，禁止自动 commit/push，不得覆盖无关改动。

本轮只处理我指定的一个问题，不做顺手重构、批量重命名、依赖升级、框架迁移或视觉翻新。先检查当前代码与相关测试，再给出 5 行以内的“当前事实、目标、最小修改范围、风险、定向验证”，然后实施。

AI 输出只能是 proposal；不得让 AI 直接修改计划、任务状态或长期用户事实。SQLite 是 durable source of truth。涉及 schema 必须新增 migration，并验证空库、旧库、重复启动；不得删除用户数据。

只运行本轮定向测试和 typecheck。除非提示明确要求，不运行全量测试、build 或真实 DeepSeek 测试。测试失败时先诊断，不得通过放宽产品边界、删除断言或恢复旧错误行为来变绿。

完成后立即停止，并报告：修改文件、真实行为变化、运行过的命令与原始结果、未验证内容、需要 Codex 重点审查的位置。不得自行开始下一问题。
```

## 1. PR-09A：验证并修正 Learning Branch 当前半成品

```text
本轮只处理 PR-09A，不处理时间线、知识重试、导入恢复或 Q1。

先读取：
- docs/PRODUCT_REVIEW_REMEDIATION_2026-07-12.md 的 PR-09
- docs/PRODUCT_TRUTH.md 中问题分支与返回主任务原则
- docs/AI_AND_DATA_RULES.md 中 L6 当前问题分支
- src/main/modules/branch/branch.ts
- src/main/modules/branch/branch.test.ts
- src/main/services/app-service.ts 的 askQuestion/createBranch/closeBranch/promoteBranch
- src/renderer/src/components/ai/AiDrawer.tsx
- src/renderer/src/App.tsx 的 onCloseBranch
- preload、IPC、shared branch 类型

当前工作树已经有未验证的 PR-09 修改。先检查 diff，不要重新实现一套。

必须证明并修复以下行为：
1. 用户第一次提问只保存一条真实用户问题，不出现 `Branch: question` 占位消息或重复消息。
2. debug/practice 没有显式首条内容时使用可理解的中文标题。
3. 无 summary 关闭时保存中文可理解摘要，不保存 `Closed`。
4. 仅关闭、提取知识都不改变主任务、Action、Session 和 runtime pointer。
5. propose_fact 只写 inferred 候选，不作为 confirmed 注入 Prompt。
6. promote_task 只能通过显式 promote 方法执行，创建后续正式 Task 后恢复原主任务位置。
7. 分支不存在时返回明确中文错误，不静默成功。

只做必要修正，并补充/修正 branch.test.ts。运行：
- npm run typecheck
- npx vitest run src/main/modules/branch/branch.test.ts src/main/services/app-service.test.ts --pool=forks --maxWorkers=1 --reporter=verbose

不要运行全量测试。完成后停止等待审查。
```

## 2. PR-09B：Branch UI 四种关闭方式验收

必须在 PR-09A 经 Codex 审查通过后执行。

```text
本轮只处理 PR-09B 的 Renderer 交互，不改数据库和主状态机。

读取 AiDrawer、App、相关 CSS、UI_GUIDELINES.md。检查现有半成品，完成以下最小 UI：
1. 展开“关闭分支”后显示分支总结输入。
2. 仅关闭、提取为知识、提议为长期偏好、提升为正式任务四个动作名称清楚。
3. 提议长期偏好在 key 或 summary 为空时禁用，并说明“稍后仍需确认”。
4. 提升正式任务在没有当前 DailyGuideTask 时禁用。
5. 点击任一动作后防止重复提交；成功后关闭选项并刷新学习状态；失败时保留输入供重试。
6. 操作不能改变当前主任务进度；关闭后 Drawer 明确提示已返回原任务。
7. 所有文本使用中文，按钮有键盘焦点和必要 aria-label。

不要重新设计整个 Drawer。优先复用现有按钮和 StatePanel。

运行：
- npm run typecheck
- 如果已有 Renderer 相关测试，只运行直接相关文件；没有合适框架时不要伪造测试，在报告中列出必须由 Codex 做的 Electron 手工检查。

完成后停止等待审查，不得把 PR-09 标记 completed。
```

## 3. PR-10A：设计统一 History 事件投影，只做主进程与测试

```text
本轮只处理 PR-10A：建立统一学习时间线数据投影，不修改 Review UI。

读取：
- PR-10 验收标准
- docs/PRODUCT_TRUTH.md 历史记录原则
- src/main/modules/history 目录
- Store 中 Session、Submission、Evaluation、Review、plan_versions、question_threads 查询
- shared types 与现有 History 测试

先定义一个小而稳定的 History Module Interface，例如按 goalId 返回按时间排序的 discriminated union 事件。事件至少覆盖：
- task_completed / task_skipped
- session_started / session_paused / session_completed
- submission_created
- evaluation_completed
- review_generated
- plan_changed
- branch_opened / branch_resolved

每个事件必须有 id、type、occurredAt、goalId、可选 taskId、中文 title、可展示 detail、sourceId。不要新建 timeline 表；这些事件应从 durable source records 投影得到。不要把完整 AI 文本或聊天历史复制到事件。

要求：
1. 排序确定，相同时间使用稳定次序。
2. 缺失可选关联记录时仍能返回其余事件。
3. 不跨 goal 泄漏事件。
4. Interface 和测试使用同一 seam。
5. 只增加一个 typed IPC/preload 读取入口，不增加写入口。

先写失败测试，再实现。运行 typecheck 和新增/相关 History 测试。不要修改 ReviewPage。完成后停止等待审查。
```

## 4. PR-10B：把统一事件投影接入 Review

必须在 PR-10A 经 Codex 审查通过后执行。

```text
本轮只把已经通过测试的 History 事件投影接入 ReviewPage，不修改主进程投影规则。

要求：
1. Review 按 occurredAt 展示事件，不再用 guideTasks 临时拼“时间线”。
2. 不同事件使用现有 lucide 图标和中文标签，不创造新图标系统。
3. 默认展示最近事件，长列表提供简单“查看更多”，不一次渲染全部历史。
4. loading、empty、error 三种状态明确。
5. Plan Change 能显示 changeSummary；Evaluation 显示结果而不暴露内部 JSON。
6. 点击有来源详情的事件时，只展开可理解摘要；不要新建复杂页面。
7. 保留计划版本卡片，不重复显示同一内容。

运行 typecheck。若没有 Renderer 测试，列出 Electron 手工验收步骤，不得声称 UI 已验收。完成后停止等待审查。
```

## 5. PR-11A：知识补录持久重试队列

```text
本轮只处理 PR-11A，不改知识库视觉。

先追踪 submit → evaluate → processEvaluationResult → recordKnowledgeItems 的真实调用链。设计持久重试时必须遵守：评价成功不能因为知识写入失败而回滚；重启后可以补录；同一 evaluation 重试不能重复增加 occurrenceCount。

推荐使用现有 evaluation/source evidence 作为幂等键。只有现有表无法表达 pending/failed 时才新增最小 queue 表；若新增 schema，必须新增 migration，禁止启动 ad hoc SQL。

状态至少包含 pending/processing/failed/completed、evaluationId、attemptCount、lastErrorCategory、updatedAt。不得保存 API key、完整 prompt 或无关历史。

需要测试：
1. knowledge 写入失败后 Evaluation/Submission 仍为 applied。
2. queue 保留 failed，可重启读取。
3. 重试成功后 completed。
4. 同一 evaluation 多次重试只产生一份 evidence，不重复 occurrenceCount。
5. 并发重试不会重复写。

只运行 schema/迁移、Store、AppService 相关定向测试和 typecheck。完成后停止等待审查。
```

## 6. PR-11B：知识来源详情与待处理入口

```text
本轮只处理 PR-11B UI/读取链。

要求：
1. 知识项来源显示任务名称、提交时间、评价结果和证据摘要，而不是裸 source ID。
2. 点击来源只读展开，不修改任务完成状态。
3. Today 待处理中心显示知识补录失败数量和“重试补录”入口。
4. 重试按钮有 processing/disabled/success/failure 就地反馈。
5. 知识项只影响未来 proposal，不直接改变 mastered 或计划。

不得新增复杂知识图谱、RAG 或新页面。运行 typecheck 和直接相关测试，完成后停止等待审查。
```

## 7. PR-12A：只设计并实现导入校验，不写数据库

这是高风险任务，必须先完成只读阶段并让 Codex 审查。

```text
本轮只实现 JSON 导入的“读取 + runtime schema 校验 + 版本检查 + 影响预览”，绝对不能写入数据库。

读取 exportGoalData 的真实结构、Zod 使用模式、SECURITY_AND_PRIVACY.md、TESTING_AND_MIGRATIONS.md。

要求：
1. 为导出格式增加明确 formatVersion、exportedAt、appVersion（不得改变旧数据）。
2. Zod 校验所有必需实体和引用字段。
3. 返回 ImportPreview：是否合法、版本是否支持、各实体数量、目标标题、冲突摘要、warnings/errors。
4. 非法 JSON、未知版本、缺引用、重复 ID、跨目标引用必须失败。
5. 本轮不得新增任何 insert/update/delete，不得提供 confirmImport。
6. Renderer 只允许选择文件并展示预览；不得出现会真正恢复的按钮。

写失败测试并运行导入校验定向测试、typecheck。完成后停止，明确写出“尚未写入数据库”。
```

## 8. PR-12B：事务导入（必须经 Codex 审查 PR-12A 后）

```text
本轮实现已审查 ImportPreview 对应的确认导入。

硬性规则：
1. 用户必须在 UI 明确确认。
2. 整个导入使用一个数据库事务；任一实体失败全部回滚。
3. 不覆盖现有 ID；冲突时默认拒绝，不做自动 merge。
4. 不删除现有用户数据。
5. 导入后运行 foreign_key_check 和 runtime consistency audit。
6. 保存导入来源和 formatVersion，但不保存原始文件中的 secret。
7. 失败返回中文结构化错误。

必须测试空库成功、重复导入拒绝、半途失败回滚、旧版本拒绝、引用损坏拒绝、现有数据保持不变。运行定向迁移/导入测试和 typecheck，完成后停止。不要运行用户真实数据库。
```

## 9. PR-13：只准备 Electron 验收清单，不自行宣称通过

```text
本轮先不大改 UI。根据 PR-13 和 UI_GUIDELINES.md 建立真实 Electron 验收清单，覆盖 Goal → Today → Study → Branch → Submit → Review → Stage Confirm → Settings Context → Export/Import Preview。

逐项记录：入口、前置数据、操作、期望状态、禁用状态、局部反馈、恢复方式、需要截图的位置。额外覆盖窄窗口、键盘 Tab/Enter/Escape、焦点可见性、中文错误和无 preload 启动错误。

如果当前环境能可靠启动 Electron，可以按清单执行并保存截图证据；不能可靠执行时只提交清单和已发现问题，禁止声称 PR-13 完成。视觉问题按 P0/P1/P2 排序，不要当场做全站重构。完成后停止等待 Codex 审查。
```

## 10. PR-14A：Q1 兼容审计，只读，不删列

```text
本轮只做 Q1 只读审计和测试设计，不删除列、不改 schema。

使用 rg 列出所有 study_sessions.blockId、旧 task_items id、daily_plan_blocks、skipBlock、getAccumulatedSeconds 读写路径，并分类：新写路径、旧数据只读兼容、测试夹具、可删除死代码。

输出调用映射和迁移前置条件，并新增测试证明：
1. 新 Session 只写 DailyGuideTask taskId。
2. 历史 block session 仍可读取。
3. 累计时长使用 task anchor。
4. skip 不再写旧 block。
5. 空库和典型旧库数据数量可比较。

本轮不允许删除字段或 migration。完成后停止等待 Codex 审查。
```

## 11. PR-14B：Q1 迁移（必须经 Codex 审查 PR-14A 后）

```text
严格按已审查的 Q1 映射执行 migration。不得删除用户数据；若 SQLite 需要重建表，先建新表、复制并验证、再交换，保留无法映射记录的兼容读取或冲突报告。

必须通过：全新空库、典型旧库、已升级库重复启动、foreign_key_check、关键记录数比对、历史 Session 可读、新 Session 不写旧 anchor。任何样本无法安全映射时停止并报告，不要猜测映射。

只运行迁移和 Session 相关定向测试及 typecheck。完成后停止等待 Codex 审查。
```

## 12. PR-15：不要交给 OpenCode 自动执行

```text
PR-15 包含真实 DeepSeek、真实桌面和 14 天/30 Session 连续使用，不是普通编码任务。OpenCode 只能整理验收表、日志模板和指标查询，不能自行运行真实 DeepSeek、不能使用或打印 API Key、不能宣称连续使用完成。等待用户和 Codex 明确指令。
```

## 13. 每次交回 Codex 的固定报告模板

```text
任务编号：PR-xxA/PR-xxB

完成行为：
- 

修改文件：
- 

没有修改：
- 明确列出刻意未触碰的模块/数据库/产品行为

验证命令与真实结果：
- 命令：
- 结果：

未验证：
- 

风险/需要 Codex 重点检查：
- 

下一任务：未开始，等待审查。
```
