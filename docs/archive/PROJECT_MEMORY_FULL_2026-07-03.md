# 项目记忆

## 2026-07-03 真实 AI 验证边界调整

* 日期
  2026-07-03
* 本次完成
  停止将 `--real-ai` 完整 Electron 两轮流程作为自动验收门槛。`scripts/electron-gui-smoke.mjs` 回到确定性 fake AI 主回归，并删除针对单次真实模型输出逐题调答案的硬编码分支。新增 `src/main/ai/deepseek-contract.test.ts` 作为独立真实 DeepSeek 合约测试入口：默认跳过，只有设置 `RUN_DEEPSEEK_CONTRACT=1` 时才调用一次真实 evaluation，并只输出阶段名、耗时和错误类型。
* 关键决策
  保留有单元测试覆盖的通用修复：`AiClient.generateJson` 在 JSON 解析或 schema 校验失败时只进行一次模型修复请求；真实 API 请求有明确 timeout；AI 输出 schema 对常见真实模型格式做边界归一化，归一化后仍必须通过 schema。完整 `--real-ai` GUI 流程改为人工验收，不再作为自动 PASS 门槛。
* 修改范围
  修改 `scripts/electron-gui-smoke.mjs`、`src/main/ai/ai-client.ts`、`src/main/ai/ai-client.test.ts`、`src/main/ai/normalize-plan.ts`、`src/main/ai/normalize-plan.test.ts`、`src/shared/schemas.ts`、`src/shared/schemas.test.ts`、`docs/PROJECT_MEMORY.md`；新增 `src/main/ai/deepseek-contract.test.ts`。未修改 schema、迁移、IPC、preload 或依赖。
* 验证结果
  `npm.cmd test -- src/main/ai/ai-client.test.ts src/main/ai/deepseek-contract.test.ts src/main/ai/normalize-plan.test.ts src/shared/schemas.test.ts` 通过 9/9，真实合约测试默认跳过 1；`npm.cmd test -- src/main/services/app-service.test.ts` 通过 2/2；`npm.cmd run build` 通过；`node scripts/electron-gui-smoke.mjs` 通过并输出 `GUI_SMOKE_RESULT: ok mode="fake-ai" rounds="2" goal="掌握 no-cache 与 immutable 缓存指令" followUp="跟进：下一次练习为静态资源选择缓存响应头。" status="completed" restored="completed"`。
* 尚未解决
  未再次运行完整真实 DeepSeek 两轮 GUI 流程；该流程现在属于非阻塞人工验收。真实 DeepSeek 合约测试尚未在本轮执行，因为用户要求不要再次连续重跑完整真实 AI 两轮测试，且完成后只要求相关单元测试、build/typecheck 和默认 fake GUI smoke。
* 推荐下一步
  手动验收真实供应商时，先运行 `RUN_DEEPSEEK_CONTRACT=1 npm.cmd test -- src/main/ai/deepseek-contract.test.ts` 验证单次结构化 evaluation 合约，再由人工在应用内观察完整流程，不把单次模型随机输出直接转化为测试答案或业务 prompt 修改。

## 2026-07-03 两轮 GUI 主流程与重启恢复验证

* 日期
  2026-07-03
* 本次完成
  扩展 `scripts/electron-gui-smoke.mjs` 为两轮真实 Electron GUI 主流程：第一轮创建目标、生成并确认阶段路线、生成并确认今日计划、开始学习、展开当前步骤、提问、提交、评估通过、结束 session；随后保存结算进入 Review，确认 pending adjustment，回到 Plan 生成并确认跟进计划，开始第二轮学习并完成；最后杀掉 Electron，用同一个隔离 userData 重启应用，并通过 preload API 验证当前目标、当前步骤和 completed session 状态可恢复。
* 关键决策
  GUI smoke 继续使用本地 OpenAI-compatible 假 AI 服务，只替换外部模型响应，不替换 renderer、preload、IPC、AppService、ContextBuilder、SQLite 和真实页面点击路径。修复 Review/Settlement 之间的异步导航竞态：完成 session 的推送或完成 action 不能在用户已经进入 Review 后把页面重新拉回 Settlement。
* 修改范围
  修改 `src/renderer/src/main.tsx`、`scripts/electron-gui-smoke.mjs`、`docs/PROJECT_MEMORY.md`。未新增依赖，未修改 schema、迁移、IPC、preload 或 AI/data 服务。
* 验证结果
  `npm.cmd test -- src/main/services/app-service.test.ts` 通过 2/2；`npm.cmd test -- src/main/services/store.test.ts` 通过 10/10；`npm.cmd test` 通过 20/20；`npm.cmd run build` 通过；`node scripts/electron-gui-smoke.mjs` 通过并输出 `GUI_SMOKE_RESULT: ok rounds="2" goal="掌握 HTTP 缓存" followUp="跟进：下一次练习为静态资源选择缓存响应头。" status="completed" restored="completed"`。
* 尚未解决
  该 GUI smoke 仍使用确定性假 AI 服务，不等同于真实 DeepSeek 响应质量验证；尚未在真实供应商 API 下连续跑两轮。当前验证证明真实桌面 UI、IPC、服务层、ContextBuilder 和 SQLite 持久化链路可完成两轮结构化主流程并重启恢复。
* 推荐下一步
  在可安全使用 API Key 的环境中执行一次真实 DeepSeek 两轮主流程；若模型输出不稳定，优先调整 prompt 和 schema 错误恢复，而不是放宽结构化状态要求。

## 2026-07-02 GUI 主流程冒烟验证

* 日期
  2026-07-02
* 本次完成
  新增 `scripts/electron-gui-smoke.mjs`，启动隔离 userData 的真实 Electron 应用和本地 OpenAI-compatible 假 AI 服务，通过 CDP 在真实 renderer 中执行最小点击式主流程：设置本地 AI、进入 Plan、创建手动目标、生成并确认阶段路线、生成并确认今日草稿、从计划页开始学习、在 Study 展开当前步骤、提问、提交学习结果、评估通过并结束 session。修复 Plan 页在“手动目标无任务但已有确认阶段”时仍禁用“生成今日草稿”的 UI 条件。
* 关键决策
  GUI smoke 不读取旧证据目录，不使用真实用户数据目录；通过 `STUDY_SUPERVISOR_USER_DATA_DIR` 环境变量把数据库和设置隔离到临时目录。测试只替换外部模型服务，renderer、preload、IPC、AppService、ContextBuilder、SQLite 持久化和页面状态走真实应用路径。
* 修改范围
  修改 `src/main/index.ts`、`src/renderer/src/main.tsx`、`docs/PROJECT_MEMORY.md`；新增 `scripts/electron-gui-smoke.mjs`。未新增依赖、未修改 schema 或迁移。
* 验证结果
  `npm.cmd run build` 通过；`node scripts/electron-gui-smoke.mjs` 通过，输出 `GUI_SMOKE_RESULT: ok goal="掌握 HTTP 缓存" step="当前 Cache-Control 步骤" status="completed"`；`npm.cmd test` 通过 20/20。
* 尚未解决
  该 GUI smoke 使用本地确定性假 AI 服务，不等同于真实 DeepSeek 响应质量验证；尚未连续做两轮 GUI 点击式主流程；尚未覆盖 Review 接受调整后回 Plan 生成跟进计划的渲染层路径。
* 推荐下一步
  扩展 GUI smoke 到第二轮：完成第一轮后进入 Review 接受 pending adjustment，再回 Plan 生成并确认跟进计划、开始第二个 session，并验证重启恢复。

## 2026-07-02 手动目标生成今日任务闭环

* 日期
  2026-07-02
* 本次完成
  修复手动创建学习目标后的规划断点：此前只创建 goal 并确认阶段路线时，如果没有通过导入生成 task，`generatePlan` 会因为没有未完成任务而失败。现在 AppService 在生成今日计划前会在当前目标没有任何任务、且已有已确认/当前阶段时，从该阶段创建一个真实 backlog “阶段起步”任务，再交给既有 planner 生成需用户确认的今日草稿。
* 关键决策
  不新增 AI 操作、不新增表、不绕过用户确认。自动创建的是从用户已确认阶段派生的 backlog 任务，正式日计划仍是 draft，必须由用户确认后才能执行；已有任务的目标不会重复创建阶段起步任务。
* 修改范围
  修改 `src/main/services/store.ts`、`src/main/services/app-service.ts`、`src/main/services/store.test.ts`、`src/main/services/app-service.test.ts`、`docs/PROJECT_MEMORY.md`。未修改 schema、迁移、UI、IPC、preload、依赖或配置。
* 验证结果
  `npm.cmd test -- src/main/services/store.test.ts` 通过 10/10；`npm.cmd test -- src/main/services/app-service.test.ts` 通过 2/2；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 20/20；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未使用真实 DeepSeek API 连续跑通两轮完整主流程；尚未做 GUI 点击式端到端自动化验证。阶段起步任务目前是从已确认阶段确定性派生，不是额外 AI 任务拆解。
* 推荐下一步
  做一次 renderer/preload 到 AppService 的自动化 smoke 或真实桌面点击验证，重点覆盖手动目标路径：创建目标、生成/确认阶段、生成/确认今日草稿、计划页开始学习、Study 展开步骤与提交。

## 2026-07-02 计划页学习块操作补齐

* 日期
  2026-07-02
* 本次完成
  补齐 Plan 页面今日计划时间线的学习块操作入口：确认后的计划块现在可以直接在计划页点击“开始”进入学习，也可以填写原因后“跳过”。草稿计划仍提示先确认，已完成块只展示完成状态，避免用户确认计划后还必须绕到 Today 或 Study 才能启动当前任务。
* 关键决策
  只复用已有 `onStart`、`onSkip`、session IPC 和 store 行为，不新增业务状态、不改数据库、不改变 AI 调用或计划确认规则。跳过仍要求用户输入原因，不做静默跳过。
* 修改范围
  修改 `src/renderer/src/main.tsx`、`src/renderer/src/styles.css`、`docs/PROJECT_MEMORY.md`。未修改 schema、迁移、依赖、preload、IPC 或 main/service 业务代码。
* 验证结果
  `npm.cmd run typecheck` 通过；`npm.cmd test` 通过 18/18；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未做 GUI 点击式自动化验证，未实际点击计划页按钮跑完整渲染层流程；尚未使用真实 DeepSeek API 连续跑通两轮完整主流程。
* 推荐下一步
  补 renderer/preload 到 AppService 的自动化 smoke 或真实桌面点击验证，覆盖“创建目标→阶段路线→确认计划→计划页开始学习→Study 提问/提交→Review 接受调整→回 Plan 生成跟进计划”。

## 2026-07-02 AppService 两轮闭环与重启恢复补强

* 日期
  2026-07-02
* 本次完成
  扩展 AppService 级渐进式 AI 流程测试：第一轮完成任务并接受后续计划调整后，继续确认跟进日计划、开始第二个 session、展开第二轮当前步骤、在步骤内提问并回到主线、提交结果、完成第二个任务和 session，并关闭后重开同一个临时 SQLite 数据库验证当前目标、阶段、日任务、步骤、问题分支和 pending adjustment 能恢复。
* 关键决策
  继续使用底层 `AiClient.generateJson` 确定性 mock，不伪造真实 DeepSeek 已跑通；保留真实 `AppService`、agent prompt、Zod 校验、ContextBuilder 和 SQLite store 调用路径，用服务层证据证明结构化学习状态不是普通长对话。
* 修改范围
  修改 `src/main/services/app-service.test.ts`、`docs/PROJECT_MEMORY.md`。未新增 schema 迁移，未修改产品 UI、IPC、配置、依赖或业务代码。
* 验证结果
  `npm.cmd test -- src/main/services/app-service.test.ts` 通过 1/1；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 18/18；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未使用真实 DeepSeek API 连续跑通两轮完整主流程；尚未做 GUI 点击式端到端自动化验证。当前补强证明 AppService 和持久化链路，不等同于真实供应商响应质量或完整渲染层交互验收。
* 推荐下一步
  在可安全使用 API Key 的情况下执行一次真实应用内两轮主流程；同时补一个 renderer/preload 到 AppService 的自动化 smoke，验证按钮操作路径。

## 2026-07-02 AppService 渐进式 AI 链路验证

* 日期
  2026-07-02
* 本次完成
  新增 AppService 级渐进式 AI 流程测试，通过 mock `AiClient.generateJson` 在不触网、不泄露 API Key 的前提下，让真实 `AppService`、agents、prompts、Zod schema、ContextBuilder 和 SQLite store 串联运行：导入目标与任务、生成阶段路线、确认阶段、生成并确认日计划、开始 session、展开当前步骤、连续提问并回到主线、提交结果、生成补救步骤、再次提交完成任务、生成 pending adjustment、接受调整并生成后续计划。修复 `completeSession` 后重新初始化 block 时会在任务已完成后误建新 active step 的问题，现在 completed session 会保留最新已完成 step 作为恢复锚点，不再虚假推进。
* 关键决策
  不为了测试引入新依赖或改变生产构造方式；使用 Vitest 对 `AiClient.prototype.generateJson` 做底层 mock，保留上层 AppService 和 agent/prompt/schema 调用路径。该测试证明应用服务链路可以用结构化 AI 输出驱动，而不是长聊天页面。
* 修改范围
  修改 `src/main/services/store.ts`、`docs/PROJECT_MEMORY.md`；新增 `src/main/services/app-service.test.ts`。
* 验证结果
  `npm.cmd test -- src/main/services/app-service.test.ts` 通过 1/1；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 18/18；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未使用真实 DeepSeek API 连续跑通两轮完整主流程；尚未做 GUI 点击式端到端自动化验证。当前 AppService 测试使用确定性 mock AI 输出，只证明应用服务链路和结构化校验，不等同于真实供应商响应质量验证。
* 推荐下一步
  若要继续逼近最终验收，优先做真实 API Key 下的一次手工或半自动应用内流程；如果不能触网，则补渲染层/IPC 级 smoke，验证按钮到 preload 到 AppService 的路径。

## 2026-07-02 两轮渐进式主流程本地验证

* 日期
  2026-07-02
* 本次完成
  补齐非任务完成分支的步骤摘要保存：当评估后进入 `advance`、`remediate`、`practice`、`simplify` 或重新讲解等下一步时，当前步骤会被标记完成并写入 `learning_summaries`，使下一次 AI 调用能读取最近步骤摘要。新增一条覆盖两轮学习主线的 store 集成测试：创建目标与阶段、确认日计划、开始 session、当前步骤、连续问题分支、提交评估、生成补救步骤、完成任务、生成并接受调整 proposal、创建后续 backlog 任务、生成下一日计划、再次学习并完成。
* 关键决策
  本轮仍使用本地结构化数据和确定性 agent output 验证核心状态机，不伪造真实 DeepSeek 调用已完成。测试重点是证明 SQLite 持久化状态、ContextBuilder 有界上下文、问题分支回主线、最近步骤摘要、任务总结、后续计划调整和二次学习链路可工作。
* 修改范围
  修改 `src/main/services/store.ts`、`src/main/services/store.test.ts`、`docs/PROJECT_MEMORY.md`。
* 验证结果
  `npm.cmd test -- src/main/services/store.test.ts` 通过 9/9；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 17/17；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未使用真实 DeepSeek API 连续跑通两轮完整主流程；尚未做 GUI 点击式端到端自动化验证；当前两轮验证证明的是服务层状态机和持久化链路，不等同于真实用户界面全流程验收。
* 推荐下一步
  在不泄露 API Key 的前提下，用真实配置执行一次应用内完整主流程；若需要自动化，优先为 AppService 增加可注入 AI agent 的测试 seam，再做不触网的 service-level AI mock 集成测试和 GUI smoke。

## 2026-07-02 渐进式学习调整闭环与恢复验证

* 日期
  2026-07-02
* 本次完成
  补齐任务完成后的后续计划调整落地：`plan_adjustment_proposals` 新增应用结果字段，用户接受调整建议后会创建真实 backlog 跟进任务，并把 `appliedTaskId`、`appliedAt` 写回 proposal，使后续每日计划能纳入该任务。`ContextBuilder` 新增 `generate_daily_plan` 操作并携带 pending adjustment；每日计划生成调用改为使用统一工作上下文和 context source ids。Review 接受或拒绝调整后刷新主数据，避免新跟进任务只在下次手动刷新后出现。新增数据库重开恢复测试，验证当前目标、阶段、任务、步骤和未解决问题分支可从 SQLite 恢复。
* 关键决策
  AI 仍只生成 proposal，不直接修改计划。只有用户显式接受 proposal 时，系统才把建议应用为可规划的后续任务；拒绝只记录决定。后续计划的实际重排仍通过既有每日计划生成与确认流程完成，保持用户确认边界。
* 修改范围
  修改 `src/main/db/schema.ts`、`src/main/db/migrations.ts`、`drizzle/0003_plan_adjustment_application.sql`、`src/main/services/store.ts`、`src/main/services/context-builder.ts`、`src/main/services/app-service.ts`、`src/main/ai/agent-prompts.ts`、`src/main/ai/agents.ts`、`src/shared/types.ts`、`src/renderer/src/main.tsx`、`src/main/services/store.test.ts`。
* 验证结果
  `npm.cmd test -- src/main/services/store.test.ts` 通过 8/8；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 16/16；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志仍有 GPU process/network service 短暂崩溃重启提示。
* 尚未解决
  尚未使用真实 DeepSeek API 连续跑通两轮完整主流程；尚未做自动 GUI 点击式端到端验证；接受调整后当前策略是创建后续 backlog 任务，尚未自动生成新版日计划草稿，仍需用户到 Plan 生成并确认。
* 推荐下一步
  用可用 API Key 跑两轮真实主流程，覆盖创建目标、阶段路线、今日计划、步骤展开、连续提问、提交评估、下一步、任务总结、接受调整、重新生成计划和应用重启恢复；随后补 AppService 级别的 AI mock 集成测试。

## 2026-07-02 渐进式学习运行层首轮落地

* 日期
  2026-07-02
* 本次完成
  建立渐进式 AI 学习导师的第一条真实纵向切片：新增阶段路线、当前学习步骤、学习运行状态、问题分支、问题消息、学习提交、结构化评估、下一步决策和学习摘要的数据模型；新增启动迁移记录；实现 Context Builder、阶段路线 AI、当前步骤教学 AI、步骤问题回答 AI、提交评估 AI 和下一步决策 AI；通过 IPC/preload 暴露目标、学习运行、提问、提交和评估接口；Study 页面接入当前步骤、问题分支、提交评估和下一步展示。
* 关键决策
  不把 Study 实现成普通长对话页。数据库保存当前目标、阶段、今日任务、当前步骤和问题分支；Context Builder 每次按操作类型只组装当前目标/阶段/任务/步骤、最近 2-3 个步骤摘要、当前问题分支和必要提交/评估，不发送完整历史。旧 `.agent/TASK.md` 仍是 FLOAT-003，与当前用户目标冲突，本轮按用户当前目标优先。
* 修改范围
  修改 `src/main/db/schema.ts`、`src/main/db/bootstrap.ts`、`src/main/db/migrations.ts`、`drizzle/0001_progressive_learning_runtime.sql`、`src/main/services/store.ts`、`src/main/services/context-builder.ts`、`src/main/services/app-service.ts`、`src/main/ai/agent-prompts.ts`、`src/main/ai/agents.ts`、`src/shared/schemas.ts`、`src/shared/types.ts`、`src/shared/ipc.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/main.tsx`、`src/renderer/src/styles.css`、`src/main/services/store.test.ts`。
* 验证结果
  `npm.cmd test -- src/main/services/store.test.ts` 通过 5/5；`npm.cmd test` 通过 13/13；`npm.cmd run typecheck` 通过；`npm.cmd run build` 通过；Electron dev smoke 观察到 `start electron app...` 启动标记并退出码 0，日志中存在 GPU process/network service 短暂崩溃重启提示。证据保存于 `.agent/evidence/TASK-20260702-progressive-learning-mvp/`。
* 尚未解决
  尚未使用真实 DeepSeek API 完整跑通“创建目标→阶段路线→今日任务→当前步骤→连续提问→提交→评估→下一步→总结→重启恢复”两轮主流程；尚未实现任务完成后的后续计划调整确认 UI；阶段路线生成后当前 UI 还未展示完整阶段列表和确认动作；Electron smoke 只验证启动标记，未做自动 GUI 点击流程。
* 推荐下一步
  继续完善 Plan/Study UI 的阶段展示和确认、任务完成总结与计划调整 proposal；补 AppService/ContextBuilder 单元测试；在配置可用 API Key 后跑两轮真实主流程并验证重启恢复。

## 2026-07-02 渐进式学习文档契约更新

* 日期
  2026-07-02
* 本次完成
  根据用户提供的新规则重写并合并根目录 `AGENTS.md`，补充渐进式学习流程底线、下一步决策集合、领域服务职责划分和 `docs/CONTEXT_AND_MEMORY.md` 条件读取规则。同步精简更新 `docs/PRODUCT_SPEC.md`、`docs/CONTEXT_AND_MEMORY.md`、`docs/ARCHITECTURE.md`、`docs/AI_AND_DATA_RULES.md`，将产品、上下文、架构、AI 输出和数据规则统一到“结构化学习运行系统”方向。
* 关键决策
  本次以对话中提供的内容为准；与原文不冲突的事实源、技术约束、隐私禁令、RAG 路线、Prompt Profiles、非目标和验证规则保留或压缩合并。文档强调数据库是状态来源，AI 是无状态 proposal，当前学习位置和问题分支必须显式保存。
* 修改范围
  仅修改文档：`AGENTS.md`、`docs/PRODUCT_SPEC.md`、`docs/CONTEXT_AND_MEMORY.md`、`docs/ARCHITECTURE.md`、`docs/AI_AND_DATA_RULES.md`、`docs/PROJECT_MEMORY.md`。未修改产品代码、依赖、数据库 schema、迁移或测试。
* 验证结果
  已执行文档读取、结构检查、目标文件存在性检查和 git diff 复核；本次为纯文档任务，未运行 typecheck/test/build。
* 尚未解决
  现有代码尚未实现新的渐进式学习运行主流程数据模型和服务边界；后续实现时需要以当前已验证代码为事实源，逐步迁移或映射到新文档概念。
* 推荐下一步
  启动实现主流程前，先对照现有 schema、IPC 和服务列出差距，再按 `learning-runtime-service`、`context-builder`、`evaluation-service`、`progression-service` 的最小闭环逐步落地。

## 2026-06-29 文档架构重构

* 日期
  2026-06-29
* 本次完成
  将根目录 `AGENTS.md` 从长篇常驻规则拆分为精简入口文件和按任务读取的专题文档。新增 `docs/PRODUCT_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/AI_AND_DATA_RULES.md`、`docs/SECURITY_AND_PRIVACY.md`、`docs/UI_GUIDELINES.md`、`docs/TESTING_AND_MIGRATIONS.md`、`docs/REFERENCES.md` 和 `.agent/WORKFLOW.md`。
* 关键决策
  `AGENTS.md` 只保留项目身份、优先级、事实源、通用工作纪律、最高级禁令、条件读取映射、最低验证和项目记忆规则；专题规则不再全部常驻。正式 Task-ID 任务继续使用 `.agent/WORKFLOW.md` 的完整证据协议，普通小型交互任务不强制生成完整证据目录。
* 修改范围
  仅修改文档和本次证据文件，未修改产品代码、配置、依赖、数据库、测试代码或业务行为。
* 验证结果
  已检查新 `AGENTS.md` 行数为 109 行、字符数为 2996；已确认专题文档创建完成，并保存 git baseline、post status、diff name-status 和 diff stat 到 `.agent/evidence/doc-architecture-refactor-20260629/`。
* 尚未解决
  当前工作树在本任务前已有大量未提交变更，本次未整理这些既有变更，也未处理既有文档中的历史乱码显示问题。
* 推荐下一步
  后续执行具体产品、架构、AI、隐私、UI、测试或迁移任务时，按 `AGENTS.md` 的条件读取映射只加载相关专题文档。

## 2026-06-29 浮动窗口拖拽与计时同步修复

* 日期
  2026-06-29
* 本次完成
  修复学习浮动窗口拖拽后误触发展开或打开主程序的问题，并统一主窗口与浮动窗口的学习计时计算逻辑。打开主程序进入 Study 页面时会主动同步当前活跃 session，浮窗打开主程序时也会从主进程推送最新 session 状态。
* 关键决策
  - 不修改数据库 schema，沿用现有 `study_sessions.durationMinutes` 与 `startedAt` 作为计时事实源。
  - 新增 `float-behavior` 纯函数模块，把拖拽阈值、拖拽后点击抑制、session elapsed seconds 计算集中测试，避免主窗口和浮窗各自维护一套计时公式。
  - 浮窗拖拽使用 4px 阈值判定真实拖动；拖动结束后的 click/double-click 在短窗口期内被抑制，避免鼠标释放被误判为展开或打开主程序。
  - 主窗口新增 `sessions.getActive` preload/API 调用，Study 页面导航与初始加载时主动拉取活跃 session，避免打开主程序后显示旧计时状态。
* 修改范围
  新增 `src/renderer/src/float-behavior.ts`、`src/renderer/src/float-behavior.test.ts`；修改 `src/renderer/src/float-main.tsx`、`src/renderer/src/main.tsx`、`src/shared/types.ts`、`src/preload/index.ts`、`src/main/ipc.ts`。
* 验证结果
  `npm.cmd test -- src/renderer/src/float-behavior.test.ts` 先红后绿，最终通过 3/3；`npm.cmd run typecheck` 通过；`npm.cmd test` 通过 12/12；`npm.cmd run build` 通过。完整日志保存在 `.agent/evidence/TASK-20260629-float-window-sync/`。
* 尚未解决
  本轮未执行真实桌面黑盒拖拽冒烟测试；仍建议后续启动应用后手动验证浮窗拖动、展开、打开主程序、暂停/恢复、结束学习的完整链路。
* 推荐下一步
  运行一次主流程手工回归：开始学习后拖动浮窗，确认不会自动展开；从浮窗打开主程序，确认主窗口 Study 计时与浮窗一致；暂停/恢复后再次确认两端计时一致。

## 当前状态
- 仓库已经初始化，主系统已搭建为 `Electron + React + TypeScript` 桌面应用。
- `AGENTS.md` 是架构契约；本文件是跨对话迁移的主记录文件。
- 核心闭环已完整实现并通过构建验证（`typecheck` 通过、`test` 9/9 通过、`build` 通过、Windows 打包通过）。
- **六页面架构**：已按 `PRODUCT_SCOPE_V1.md` 完成 Today / Plan / Study / Knowledge / Review / Settings 七个视图（含隐藏的 Settlement 过渡页）。侧边栏导航 6 项，Settlement 仅在学习完成后自动跳转。
- **学习专注浮窗**：独立 BrowserWindow（380×48~300），支持收起/展开、拖拽移动、实时计时（含暂停累计）、快速笔记、暂停/继续/结束学习、打开主程序、位置持久化、应用重启恢复。浮窗与主窗口通过 Main 进程 `pushSessionState` 双向同步。
- **会话计时**：已修复暂停恢复计时归零问题（BUG-002），使用数据库 `getAccumulatedSeconds` 作为累计时间源，主窗口和浮窗统一计时逻辑。
- **浮窗生命周期**：已修复关闭/重启残留浮窗问题（BUG-004），关闭主窗口且无活跃会话时退出应用；浮窗 close 在 `isQuitting` 时允许真正关闭。
- **复盘兜底**：已修复结算后复盘页为空问题（BUG-003），新增本地结算摘要兜底，AI 不可用时不再进入空复盘状态。
- **数据库**：14 张表完整，SQLite 为唯一事实源。AI 输出通过 Zod schema 校验，必须经过用户确认。
- **监控**：FocusMonitor 每 15 秒通过 Windows API PowerShell 探测前台应用，仅记录应用名和窗口标题，不截图、不记录键盘。
- **已知未提交**：所有浮窗、六页面重构、Bug 修复代码均在 `4aa5b4f` 之后未提交，处于工作区修改状态。

## 设计思路
- 产品不是普通待办清单，而是“本地优先的 AI 学习管家”：导入计划、拆解任务、生成十分钟计划、记录执行、监控专注、复盘评分、建议重排。
- SQLite 是唯一事实源；AI 输出只是建议，必须经过用户确认才变成正式计划。
- Prompt profile 是可编辑、可版本化的数据，不写死在 UI 里。
- v1 监管只做低侵入行为记录：前台应用、窗口标题、学习 session、跳过/推迟原因；不做截图、键盘记录、浏览器历史读取、强制锁屏。
- RAG、知识库、向量索引留作后续阶段，未来索引必须能从 SQLite 和源文件重建。

## 迭代过程
- 第一步：创建 `AGENTS.md`，明确产品目标、非目标、技术栈、数据边界、AI 上下文策略和 RAG 预留方向。
- 第二步：初始化 Git，建立 `docs/PROJECT_MEMORY.md` 和 `scripts/dev-log.mjs`，把跨对话迁移能力作为工程约束。
- 第三步：搭建 Electron/Vite/React/TypeScript 基础工程，区分 main、preload、renderer、shared。
- 第四步：建立 SQLite-compatible libSQL + Drizzle 数据层，覆盖导入原文、目标、任务、依赖、日计划、计划块、学习 session、专注事件、跳过记录、AI 记录、prompt profile、计划版本、设置。
- 第五步：实现 DeepSeek 兼容 AI 客户端和导入/规划/复盘 agent，所有输出通过 Zod schema 校验。
- 第六步：实现主进程窗口、托盘、通知、开机自启设置入口、IPC 注册和 Windows 前台应用监控。
- 第七步：实现 React 工作台 UI，包括今日计划、导入计划、任务列表、复盘、设置、prompt profile 编辑。
- 第八步：移除 `active-win` 依赖链，改用 Windows API PowerShell 探测前台应用，生产依赖审计归零。
- 第九步：修复 preload 文件扩展名错误导致的启动空白，并增加启动失败可见错误提示。
- 第十步：根据真实 DeepSeek 返回内容修复计划生成容错，增加计划输出归一化、空 blocks 兜底、中文错误提示和回归测试。
- 第十一步：重构主流程页面，把导入和生成计划合并到“学习工作台”，增加每日计划历史选择，并压缩布局和窗口尺寸。

## 主计划
- 当前阶段目标：六页面闭环（Today→Plan→Study→Settlement→Review）已可走通，P1 Bug 已修复。**已达成。**
- 当前阶段：文档整理与对齐（本次）、代码未提交需决定提交策略。
- 下一阶段目标：添加自定义图标、配置 lint、优化 UI 视觉细节、Knowledge 页从占位实现轻量功能。
- 后续增强：提醒调度、独立置顶提醒窗口、重排 diff 审核、Playwright/Electron UI 测试、知识库/RAG 原型。

## 2026-06-20 学习专注浮窗实现

* 日期
  2026-06-20
* 本次完成
  实现学习专注浮窗（独立 BrowserWindow），包含收起态/展开态 UI、实时计时器、会话状态同步、快速笔记、暂停/继续、结束学习、打开主程序、位置持久化、应用重启恢复。浮窗与主窗口完全隔离，共享 preload API。
* 关键决策
  浮窗使用独立 HTML 入口和 Vite 构建入口。会话状态通过 Main 进程 pushEvent 同步。位置存储在 app_settings 表。主窗口导航通过 IPC 事件触发。
* 修改范围
  新增：`src/renderer/float-index.html`、`src/renderer/src/float-main.tsx`、`src/renderer/src/float-styles.css`
  修改：`electron.vite.config.ts`（新增 renderer 入口）、`src/shared/ipc.ts`（新增通道）、`src/preload/index.ts`（新增 API）、`src/main/index.ts`（浮窗窗口管理）、`src/main/services/app-service.ts`（pushEvent）、`src/renderer/src/main.tsx`（接收导航事件）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过。
* 尚未解决
  浮窗 AI 教师面板为占位、浮窗未接入真实 AI 建议。
* 推荐下一步
  运行 npm run dev 验证浮窗完整流程，添加自定义图标，配置 lint。

## 2026-06-20 UI 按设计原型完整重构

* 日期
  2026-06-20
* 本次完成
  按 `design-prototype/src/main.tsx` 和 `design-prototype/src/styles.css` 完整重构正式应用 UI。CSS 从 19.63kB 重写为 58.61kB（含完整设计系统），JS 从 271.53kB 增长为 299.66 kB。所有页面组件匹配原型结构：白色侧边栏、Today 焦点面板+点轴时间线+AI面板、Study 计时器+笔记编辑器+AI助手、Settlement 完成选择、Review 指标网格+复盘项。
* 关键决策
  完全重写 styles.css 而非增量修改，确保设计系统一致性。保留正式应用补充样式（会话控制、AI 状态、设置页面等）在文件末尾。
* 修改范围
  修改：`src/renderer/src/styles.css`（完全重写）、`src/renderer/src/main.tsx`（所有页面组件重写）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过。
* 尚未解决
  AI 教师面板和 AI 助手面板为占位 UI、Knowledge 页面为占位、lint 未配置。
* 推荐下一步
  运行 npm run dev 验证完整 UI 效果，添加自定义图标，配置 lint。

## 2026-06-20 六页面架构完成

* 日期
  2026-06-20
* 本次完成
  按 PRODUCT_SCOPE_V1.md 设计文档完成六页面架构：TodayView（状态驱动导航）、PlanView（导入+生成+确认）、StudyView（块详情+会话控制+监控）、KnowledgeView（占位）、ReviewView（评分+建议+跳转计划页）、SettingsView（时间窗+自启+隐私）。核心闭环 19 步全部打通。
* 关键决策
  Today 页面移除导入功能，只保留状态概览和导航。Plan 页面承载完整导入→生成→确认流程。复盘建议通过"去计划页生成新草稿"按钮回到计划页。
* 修改范围
  修改：`src/renderer/src/main.tsx`（新增 TodayView、PlanView、StudyView、KnowledgeView 组件，完善 ReviewView 和 SettingsView）、`src/renderer/src/styles.css`（页面布局、风险提示、监控状态、时间窗编辑器样式）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过。
* 尚未解决
  Knowledge 页面为占位、AI 教师面板未实现、lint 未配置。
* 推荐下一步
  运行 npm run dev 验证完整流程，添加自定义图标，配置 lint。

## 活跃决策
- 先支持 Windows。
- 技术栈保持 `Electron + React + TypeScript + SQLite/Drizzle`。
- 开发过程、设计思路、迭代记录、计划和迁移提示都用中文写入本文件。
- 软件用户界面也使用中文；技术内部类型名和数据库字段名可以保持英文，保证工程可维护。
- 开发记录以本文件为主，Git commit 为辅助。
- 每完成一个小开发步骤，都要运行 `npm run devlog -- step "中文说明"` 或手动更新本文件。
- 使用本地 Windows API PowerShell 探测前台应用，不引入有漏洞的 `active-win` 依赖链。

## 近期开发记录
- 2026-06-21 [步骤] PAGES-002：按 PRODUCT_SCOPE_V1 分离 Today 和 Plan 页面职责。TodayView 移除所有导入/生成功能，只保留状态概览、FocusCard 和导航跳转；新增风险提示（草稿未确认、任务已完成）和去复盘/去计划按钮。PlanView 新增已解析任务列表（compact 标题+难度）。新增 active-session-banner、risk-alerts、today-nav-actions、plan-task-preview CSS 样式。typecheck/test/build 通过。
- 2026-06-20T14:01:45+08:00 [步骤] 基于用户提供的三张参考图继续完善 `design-prototype`：Today 保留当前重点与时间线，并新增可点击切换的 AI 教师展开态；Study 页面重构为参考图式任务标题、专注计时、三段进度、笔记编辑器和右侧 AI 学习助手；仍使用假数据，不调用数据库、DeepSeek 或真实监控。已运行 `npm.cmd --prefix design-prototype run build` 通过，并确认 `http://127.0.0.1:5174` 本地服务响应；因当前未暴露浏览器控制工具，未做自动截图视觉 QA。
- 2026-06-20T05:12:30.962Z [步骤] 按用户提供的三张参考图再次重设计 design-prototype Today：补齐浅色桌面三栏结构、顶部搜索/通知/日期区、参考图式当前重点卡、分段圆形进度、带状态标签的今日时间线，以及右侧 AI 学习建议卡和快捷操作；保持假数据和原点击流程，不修改正式业务逻辑。
- 2026-06-20T04:58:25.281Z [步骤] 重构 design-prototype 的 Today 页面视觉结构：移除正式页状态切换器和状态样例，将状态演示移动到 #/dev/states；Today 改为当前任务高权重区、简洁时间线和低权重 AI 窄栏；侧边栏收窄并改为浅色导航；未修改数据库、AI 调用或学习会话逻辑。
- 2026-06-20T04:23:36.289Z [步骤] 审查 design-prototype 当前页面，新增 docs/UI_SYSTEM.md；将原型颜色、字体、间距、圆角、控件尺寸和状态变量集中到 design-prototype/src/design-tokens.css，styles.css 改为引用统一 token；未修改正式业务代码。
- 2026-06-20T04:13:21.225Z [步骤] 创建 design-prototype 隔离 UI 原型，使用假数据实现今日到学习、学习结算、复盘的可点击流程，并验证原型构建和本地服务可访问。
- 2026-06-20T04:06:32.517Z [步骤] 基于 PRODUCT_SCOPE_V1 和 USER_FLOWS 重新创建 V1 信息架构与低保真线框文档，明确六个一级页面、AI 教师面板、确认节点和页面状态。
- 2026-06-19T09:01:39.396Z [步骤] 创建学习监督工作台 UI v1 设计说明和高保真 HTML mockup；Figma 文件已创建，但因 Starter 计划 MCP 调用上限暂未写入画布。
- 2026-06-19T08:44:32.850Z [步骤] 重构学习工作台：合并导入和生成计划入口，增加每日计划历史选择，生成草稿后自动选中新计划，并压缩页面布局和窗口尺寸。
- 2026-06-18T18:44:06.223Z [步骤] 修复 DeepSeek 计划输出字段不完整导致生成计划失败的问题，增加宽松解析、本地归一化、空计划兜底和中文错误提示。
- 2026-06-18T18:30:23.430Z [步骤] 将 React 工作台文案切换为中文，并增加默认提示词中文迁移逻辑。
- 2026-06-18T18:28:58.967Z [步骤] 将应用标题、托盘菜单、通知、默认提示词和 AI 提示词改为中文。
- 2026-06-18T18:28:09.563Z [步骤] 将项目记忆文件改为中文，加入设计思路、迭代过程、主计划和中文记录规范。
- 2026-06-18T18:23:39.000Z [步骤] 修复 Electron preload 路径为 `index.mjs`，增加启动失败显示，smoke 测试确认主界面渲染。
- 2026-06-18T18:15:15.318Z [步骤] 移除 active-win，改为 Windows API PowerShell 前台窗口探测，升级 drizzle-orm，生产依赖审计清零。
- 2026-06-18T18:11:59.417Z [步骤] 完成类型检查、单元测试、构建和短时 Electron preview smoke。
- 2026-06-18T18:09:07.827Z [步骤] 实现 React 工作台 UI，并补齐 React runtime/type 依赖。
- 2026-06-18T18:04:44.056Z [步骤] 添加 DeepSeek 兼容 AI 客户端、agent prompt、应用服务、专注监控、IPC 注册和 Electron 主进程。
- 2026-06-18T18:01:48.340Z [步骤] 添加 SQLite-compatible Drizzle schema、bootstrap SQL、默认 prompt profiles 和 StudyStore 服务。
- 2026-06-18T17:58:46.708Z [步骤] 搭建 Electron/Vite/React/TypeScript 配置并安装依赖。
- 2026-06-18T17:53:51.641Z [步骤] 创建项目记忆、开发日志脚本和 AGENTS 阅读要求。
- 2026-06-19 01:19 [步骤] 创建 `AGENTS.md`，记录产品、数据、AI、RAG 和监控边界。
- 2026-06-19 [步骤] 初始化 Git 仓库。

## 未决问题
- DeepSeek 模型名需要保持可配置，因为供应商模型名会变化。
- 打包图标、安装器品牌、应用正式名称可以在核心闭环稳定后决定。
- `tools/agent-runner/` 已在工作区中删除，但 Git 历史中仍保留（在 `4aa5b4f` 提交中）。
- 大量代码未提交（52 文件变更，+4679/-3000 行），需确定提交策略。

## 下一步
- 确认提交策略：将工作区所有未提交变更整理为若干有意义的 commit。
- 添加自定义应用图标。
- 配置 lint（eslint/prettier）。
- 优化 UI 视觉细节：卡片间距、字体层级、颜色克制。
- 增强重排建议的 diff 审核视图。
- 在手动流程稳定后补 Playwright/Electron UI 测试。

## 已知风险
- AI 返回 JSON 可能不稳定，所有 agent 输出必须继续做 schema 校验和失败恢复。
- Windows 前台应用探测可能受权限、系统语言、PowerShell 策略影响；该能力必须保持可选、非阻塞。
- 现有数据库里已经写入过英文默认 prompt 的用户，需要后续迁移或覆盖为中文版本。

## 2026-06-20 Planner-Executor 自动化首轮

* 日期
  2026-06-20
* 本次完成
  建立 OpenCode 原生双 Agent 自动化架构（planner + executor），清理旧 Codex-OpenCode 外部编排方案的所有产物（agent-loop.ps1、tools/agent-runner/、STATUS.json、REPORT.md 等）。完成 7 个连续任务：REAL-DATA-001（Today 三栏布局+真实数据）、STUDY-SESSION-001（Study 会话完整状态流）、REVIEW-ADJUST-001（复盘建议展示+手动处理）、ERROR-STATES-001（AI 不可用状态处理）、VERIFY-PERSISTENCE-001（数据持久化验证）、FIX-DB-PATH-001（数据库路径统一）。核心闭环代码路径全部打通，Windows 打包验证通过。
* 关键决策
  放弃外部 PowerShell 脚本编排方案，改用 OpenCode 原生 agent 系统。settlement 流程采用保留 completed session 直到用户确认的设计。统一 appName 为 study-supervisor 确保数据库路径一致。
* 修改范围
  新增：`opencode.json`、`.opencode/agents/planner.md`、`.opencode/agents/executor.md`、`.opencode/commands/plan-and-build.md`、`.opencode/commands/execute-task.md`、`.agent/DELIVERY.md`、`.agent/REVIEW.md`
  修改：`src/renderer/src/main.tsx`（FocusCard、FocusBlock 四阶段会话控制、ReviewView 建议处理、AI 状态禁用）、`src/renderer/src/styles.css`（设计变量、会话控制面板、建议操作、AI 状态提示条）、`src/main/index.ts`（app.setName）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过、Windows 打包通过（release\win-unpacked\学习管家.exe）。数据库含真实数据（2 导入、10 任务、5 prompt profile、加密 API Key）。
* 尚未解决
  无 lint 命令配置、默认 Electron 图标、AGENTS.md 中过时协议文件引用。
* 推荐下一步
  添加自定义图标、配置 lint、清理 AGENTS.md。

## 迁移提示
继续开发 `D:\work\study_plugin`。新对话开始后先读 `AGENTS.md` 和 `docs/PROJECT_MEMORY.md`。保持本地优先架构；每完成一个小开发步骤都更新本文件；开发记录和用户可见软件文案使用中文；AI 对正式计划的修改必须经过用户确认。

## 2026-06-29 文档整理与对齐

* 日期
  2026-06-29
* 本次完成
  全面审计代码与文档的一致性，确认代码为当前状态真相源。更新 `docs/PROJECT_MEMORY.md`：
  - 重写"当前状态"，完整记录六页面架构、学习浮窗、会话计时修复、浮窗生命周期修复、复盘兜底、已知未提交状态
  - 修正"主计划"为六页面闭环已达成、当前阶段为文档整理
  - 合并两个重复的"Planner-Executor 自动化首轮"条目
  - 修正全部测试数量引用（8→9）
  - 更新"未决问题"：记录 `tools/agent-runner/` 已删除、52 文件未提交
  - 更新"下一步"：确认提交策略为首要事项
* 关键决策
  代码即真相源。文档描述与代码不符时以代码为准。`docs/CURRENT_PRODUCT_AUDIT.md` 和 `docs/DEVELOPMENT_BASELINE.md` 已过时，需要后续更新。
* 修改范围
  修改：`docs/PROJECT_MEMORY.md`（当前状态、主计划、未决问题、下一步、合并重复条目、修正测试数量）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过。确认 52 文件变更（+4679/-3000）处于工作区未提交状态。
* 尚未解决
  `docs/CURRENT_PRODUCT_AUDIT.md` 仍描述旧单页架构，需要更新或标注过时。
  `docs/DEVELOPMENT_BASELINE.md` 页面列表和文件列表需要更新。
  52 个未提交文件的提交策略待定。
* 推荐下一步
  更新 `docs/CURRENT_PRODUCT_AUDIT.md` 过时标注，然后确定代码提交策略。

## 2026-06-21 冒烟测试 P1 问题修复

* 日期
  2026-06-21
* 本次完成
  修复 `docs/test-report-v1/SMOKE_TEST_REPORT.md` 中 4 个 P1 阻断性问题：BUG-001（浮窗收起空白遮挡）、BUG-002（暂停恢复计时归零）、BUG-003（结算后复盘页为空）、BUG-004（浮窗生命周期和应用退出）。
* 关键决策
  - BUG-004：浮窗 close 事件在 isQuitting 时允许真正关闭（不再 hide）；`window-all-closed` 在 Windows 上调用 `app.quit()`；`getActiveSession` 同时查询 active 和 paused 状态。
  - BUG-001：移除 CSS `max-height` transition，改用 `requestAnimationFrame` 确保 DOM 布局更新后再 resize Electron 窗口。
  - BUG-002：废弃手动 accumulatedRef 累加逻辑（存在双重计算和丢失问题），改用数据库查询 `getAccumulatedSeconds(blockId, excludeSessionId)` 作为累计时间源。新增 IPC 通道 `sessions:getAccumulated`、preload API `sessions.getAccumulated`、store 方法 `getAccumulatedSeconds`。
  - BUG-003：ReviewView 增加 `autoTriggeredRef` 防止重复触发，增加 `generating` 状态显示加载中提示。
  - 结算页时长改用 StudyView 计时器的 `elapsedSeconds`（通过 `studyElapsedRef` 传递），而非仅读取 session.durationMinutes。
* 修改范围
  修改：`src/main/index.ts`（浮窗 close、window-all-closed）、`src/main/services/app-service.ts`（getActiveSession + getAccumulatedSeconds）、`src/main/services/store.ts`（getAccumulatedSeconds）、`src/main/ipc.ts`（新 handler）、`src/shared/ipc.ts`（新通道）、`src/shared/types.ts`（新 API 方法）、`src/preload/index.ts`（新 bridge 方法）、`src/renderer/src/float-main.tsx`（计时器重写）、`src/renderer/src/float-styles.css`（移除 transition）、`src/renderer/src/main.tsx`（StudyView/SettlementView/ReviewView 修复）
* 验证结果
  typecheck 通过、test 9/9 通过、build 通过。
* 尚未解决
  需要运行 `npm run dev` 验证完整浮窗生命周期、计时累计和复盘自动生成流程。
* 推荐下一步
  按 `docs/test-report-v1/SMOKE_TEST_REPORT.md` 第 7 节回归测试清单重新执行冒烟测试。
## 2026-06-20 Agent Runner 真实运行前加固

* 日期
  2026-06-20
* 本次完成
  为 `tools/agent-runner/` 增加 `agent:doctor` 诊断命令和真实模式 preflight；新增 Codex CLI Windows 解析器，支持 `CODEX_CLI_PATH`、npm 全局 `codex.cmd`、PATH 搜索，并拒绝 WindowsApps 内置 Codex 路径；修正 OpenCode SDK 本地服务/provider 检查；新增 `.agent/state.example.json`，将 `.agent/state.json` 与具体 `.agent/runs/*` 运行产物改为 Git 忽略。
* 关键决策
  普通 doctor 只做本地检查，不发模型请求；`--online` 才允许最小 Codex 和 MiMo JSON 请求。真实 `agent:runner -- --request` 在模型调用和 OpenCode 开发任务发送前必须通过 Codex、OpenCode、MiMo 和命令配置检查，否则直接进入 BLOCKED。
* 修改范围
  修改 `tools/agent-runner/codex.mjs`、`codex-cli.mjs`、`doctor.mjs`、`index.mjs`、`opencode.mjs`、`.gitignore`、`package.json`、`package-lock.json`；新增 `.agent/state.example.json`。
* 验证结果
  已运行 `npm run agent:doctor`，本地检查完成：Node/npm、Git、写权限、workflow、命令配置、OpenCode 服务、MiMo 配置、Electron capture 通过；Codex CLI 检查失败且明确识别为 WindowsApps 内置路径。已运行 `npm run agent:runner:mock -- --request "验证调度器回归，不修改业务代码"`、`npm run typecheck`、`npm test`、`npm run build`，均通过。
* 尚未解决
  真实 Codex CLI 仍需安装 npm 版 `@openai/codex` 并设置 `CODEX_CLI_PATH`，避开 WindowsApps 内置可执行文件。未运行 `agent:doctor -- --online`，避免本轮自动发起真实模型请求。
* 推荐下一步
  用户安装并配置 npm 版 Codex CLI 后，先运行 `npm run agent:doctor -- --online` 验证真实 Codex 和 MiMo 最小 JSON 链路，再运行真实 `agent:runner`。

## 2026-06-20 双 Agent 自动开发调度器

* 日期
  2026-06-20
* 本次完成
  新增 `tools/agent-runner/` 最小可运行双 Agent 调度器，包含 Codex 规划/验收封装、OpenCode SDK 执行封装、独立验证命令执行、Electron capture 截图适配、JSON Schema、workflow 配置、Windows 双击入口，以及 `.agent/PROJECT_BRIEF.md`、`.agent/state.json`、`.agent/runs/` 运行目录。
* 关键决策
  新调度器不继续扩展 legacy 的 `.agent/TASK.md`、`.agent/REPORT.md`、`.agent/REVIEW.md` 审计协议；默认提供 `--mock` 模式以便在无真实模型凭据或 CLI 不可用时验证完整状态机；真实模式通过 Codex CLI 非交互调用和 `@opencode-ai/sdk` 接入，不在代码中硬编码 API Key。
* 修改范围
  新增 `tools/agent-runner/`、`.agent/PROJECT_BRIEF.md`、`.agent/state.json`、`.agent/runs/.gitkeep`；更新 `package.json` 和 `package-lock.json` 加入 `@opencode-ai/sdk` 与 runner 脚本；更新 `.gitignore` 忽略具体 run 产物但保留 `.agent/runs/.gitkeep`。
* 验证结果
  已运行 `npm run agent:runner:mock -- --request ...`，mock 流程完成 PLANNING -> EXECUTING -> VERIFYING -> EVALUATING -> REWORK -> EXECUTING -> VERIFYING -> EVALUATING -> PASS；调度器独立执行 `typecheck`、`test`、`build` 并保存日志；Electron capture 通过 CDP 生成主窗口截图。已运行 `npm run typecheck`、`npm test`、`npm run build`，均通过。
* 尚未解决
  当前本机直接执行 `codex exec --help` 返回 Access denied，因此真实 Codex CLI 调用路径未完成端到端验证；真实 OpenCode SDK 会话需要本机已有 OpenCode/MiMo 配置和可用凭据后再验证。`npm install @opencode-ai/sdk` 后 `npm audit` 报告 16 个漏洞，未自动修复。
* 推荐下一步
  在确认 Codex CLI 权限和 OpenCode MiMo 配置可用后，用非 mock 模式跑一个小型真实任务；根据真实 SDK 返回结构再收紧 `execution.json` 提取逻辑；为 capture 增加更细的交互脚本配置。
## 2026-06-21 Study Agent 1.0 阻断性冒烟测试

* 日期
  2026-06-21
* 本次完成
  使用 Computer Use 对 Study Agent 1.0 执行第一轮黑盒阻断性冒烟测试，覆盖启动、主窗口浏览、开始学习、浮窗单击/双击/展开/收起、浮窗与主窗口暂停恢复、结束学习、保存结算、进入复盘、关闭并重启应用。生成测试报告 `docs/test-report-v1/SMOKE_TEST_REPORT.md`，截图证据保存在 `docs/test-report-v1/evidence/smoke/`。
* 关键决策
  本轮只记录 P0/P1，不做源码阅读和修复；遇到浮窗收起空白按恢复规则等待 5 秒并复现 2 次后停止反复触发；保存结算只执行 1 次，避免重复提交测试数据。
* 修改范围
  新增测试报告、截图证据和 `.agent` 协议输出；未修改业务代码。
* 验证结果
  应用可启动，主窗口未白屏，开始/暂停/恢复/结束学习主流程可触发；记录 4 个 P1：浮窗收起后空白遮挡、暂停恢复后计时归零、保存结算后复盘页仍为空、无活跃会话时浮窗残留且关闭主窗口后浮窗无法普通关闭。
* 尚未解决
  未验证技术根因；未继续测试低优先级视觉和边界问题；复盘/调整建议后续流程被空复盘状态阻断。
* 推荐下一步
  优先修复浮窗生命周期和关闭行为，再修复浮窗收起高度、会话计时累计和结算后复盘数据读取；修复后重新执行 `docs/test-report-v1/SMOKE_TEST_REPORT.md` 中第 7 节列出的回归测试。

## 2026-06-21 主流程冒烟回归补修

* 日期
  2026-06-21
* 本次完成
  针对初版冒烟报告中仍可能阻断主流程的问题继续补修：暂停后恢复学习不再创建新的活跃 session，学习时长按秒累计后写回现有 `durationMinutes`；主窗口和学习浮窗恢复后以 session 累计时长作为计时基线；启动恢复时跳过已经指向完成、跳过或延期学习块的陈旧 paused session；结算后复盘页新增本地结算摘要兜底，AI 复盘未生成或不可用时不再进入空复盘状态。
* 关键决策
  不修改数据库 schema，沿用现有 `study_sessions.durationMinutes` 字段保存累计分钟数，但内部用秒计算，避免短暂停/恢复被分钟取整吞掉。AI 复盘继续作为建议结果，本地结算摘要只用于保证流程可继续，不自动改写计划。
* 修改范围
  修改 `src/main/services/store.ts`、`src/main/services/app-service.ts`、`src/renderer/src/float-main.tsx`、`src/renderer/src/main.tsx`，并在 `src/main/services/store.test.ts` 增加暂停/恢复累计时长回归测试。
* 验证结果
  已保存红绿回归证据。`npm.cmd test -- src/main/services/store.test.ts` 先复现恢复创建新 session 的失败，修复后通过；`npm.cmd test` 通过 9/9；`npm.cmd run typecheck` 通过；`npm.cmd run build` 通过。
* 尚未解决
  本轮未执行完整 Computer Use 黑盒手工冒烟；仍建议按 `docs/test-report-v1/SMOKE_TEST_REPORT.md` 第 7 节重新跑一遍桌面交互回归，确认真实窗口行为与自动化/静态验证一致。
* 推荐下一步
  重新执行主流程冒烟：启动无浮窗、开始学习、展开/收起浮窗、暂停/恢复、结束并保存结算、进入复盘、关闭重启后无残留浮窗。
