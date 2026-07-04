# Study Agent Development Instructions

## 1. 项目身份

本项目是一个本地优先的 Windows 桌面 AI 学习系统，目标是逐步成为长期个人学习教师。

当前 MVP 聚焦一个可恢复的端到端闭环：

```text
AI 主动访谈澄清目标
→ 用户确认目标理解
→ AI 依次生成长期大纲、前三天短期计划、第一天主任务执行稿
→ 用户确认今日执行稿
→ Today 聚焦当前主任务，其他主任务折叠
→ 用户围绕主任务开启一个或多个 Focus Session
→ Action / Checkpoint 本地记录执行进度
→ 主任务最终提交
→ local 任务走本地验证器，ai 任务最多调用一次 evaluate_submission
→ 本地状态机决定完成、继续修改、保存进度或进入下一任务
→ 每天最多一次综合复盘，并由用户确认调整建议
```

不要把长期愿景当作当前 MVP 的硬性范围。任何功能只有参与这个可用学习闭环，才算真正完成。

## 2. 指令优先级

当规则冲突时，按以下顺序执行：

1. 用户当前显式请求。
2. 本 `AGENTS.md`。
3. `docs/PROJECT_MEMORY.md`。
4. 与任务直接相关的专题文档。
5. 当前代码、`package.json`、lockfile、迁移和测试。
6. 既有产品和架构文档。
7. 现有实现模式。

如果文档与当前已验证实现冲突，临时以当前实现为准，并在 `docs/PROJECT_MEMORY.md` 记录冲突和判断依据。

## 3. 必读与条件读取

每次实现或 review 前必须读取：

1. 本文件。
2. `docs/PROJECT_MEMORY.md`。
3. 与当前任务直接相关的源文件、组件、服务、类型和测试。

不要把所有专题文档设为每次任务的必读文件。按任务类型条件读取：

| 任务类型 | 读取文档 |
| --- | --- |
| 产品流程、范围、MVP、规划体验、信息架构 | `docs/PRODUCT_SPEC.md` |
| 架构、IPC、preload、main/service、依赖、技术选型 | `docs/ARCHITECTURE.md` |
| AI、prompt、数据模型、计划版本、上下文、RAG、知识库 | `docs/AI_AND_DATA_RULES.md` |
| Electron 权限、监控、密钥、隐私、敏感数据 | `docs/SECURITY_AND_PRIVACY.md` |
| UI、交互、视觉重构、页面状态 | `docs/UI_GUIDELINES.md` |
| 测试、验证、数据库 schema、迁移 | `docs/TESTING_AND_MIGRATIONS.md` |
| 参考项目调研 | `docs/REFERENCES.md` |
| 使用 Task-ID 或 `.agent/TASK.md` 的正式任务 | `.agent/WORKFLOW.md` |

## 4. 当前核心业务规则

### Daily Guide

* `daily_guide` 输出少量主任务，不输出固定 10 分钟 Time Block。
* 主任务通常 2～4 个，默认优先 3 个；复杂或时间少时可以只有 1 个。
* 每个主任务包含动态估时 `estimatedMinutes.min/target/max`、Action、本地 Checkpoint、最终 deliverable、doneWhen、quickHint、evaluationMode、submissionPolicy 和 carryoverAllowed。
* 当前实现为真实模型稳定性允许每个主任务至少 1 个 Action；prompt 应鼓励 3～6 个 Action，但 schema 不应因少量 Action 直接阻断主流程。
* `daily_plan_blocks` / `daily_guide_blocks` 目前是 legacy session 锚点和兼容结构，不再代表固定时间块；未经设计方案不要删除。

### Focus Session

* 计时器绑定主任务。一个主任务可以有多个 Focus Session，也可以跨天继续。
* 开始、暂停、恢复、结束、超过预计时间，只能写本地记录，不能触发 AI 请求。
* Focus Session 记录实际时间、暂停/结束原因和进度说明，不判定主任务完成。

### Submission / Evaluation

* 主任务是唯一需要最终提交和评估的单位。
* Action 和 Checkpoint 只用于执行引导和本地进度记录，不能分别触发 AI 评估。
* `submissionPolicy` 默认 `once_after_task`。
* `evaluationMode=local` 的任务走本地验证器，不调用模型。
* `evaluationMode=ai` 的任务最多调用一次 `evaluate_submission`。
* 当前主流程不再固定调用 `decide_next_step`；本地状态机根据评估结果决定通过、继续修改、保存进度或进入下一任务。
* AI 不得直接标记任务完成、覆盖已确认计划或永久修改用户画像。

### Reflection

* 日终复盘按主任务汇总，不按 Action 或 Focus Session 分别复盘。
* 每天只进行一次综合复盘。
* 未完成任务可在复盘中决定明天继续、缩小范围、拆分、延后或放弃；这些调整必须由用户确认后才生效。

## 5. Source of Truth

现有项目、`package.json`、lockfile、数据库迁移、Drizzle schema 和当前实现，是已经落地技术选择的事实源。

当前技术栈：

* Electron + React + TypeScript
* SQLite/libSQL + Drizzle ORM
* OpenAI-compatible DeepSeek client
* Zod runtime validation
* typed preload API + narrow IPC
* Vitest + Electron fake AI GUI smoke

未经用户明确批准，不迁移框架、样式系统、数据库、状态管理、AI 客户端或主要依赖。

## 6. 语言要求

开发记录、设计理由、迭代说明、迁移上下文和项目记忆更新使用中文。

用户可见应用 UI 使用中文。代码标识符、数据库列、API 字段、TypeScript 类型和必要技术名词可以使用英文，以保证可维护性。

避免中英文混杂的 UI 标签，除非英文术语必要或已被广泛使用。

## 7. 通用开发规则

修改前：

1. 先检查当前实现。
2. 识别最小相关变更范围。
3. 复用现有组件、服务、类型、测试和项目模式。
4. 需求含糊时说明假设。
5. 判断是否影响数据、IPC、AI 行为或既有用户流程。

实现中：

* 做能完成目标的最小一致变更。
* 一次只处理一个页面、模块或端到端流程。
* 不做无关重构。
* 不无必要地批量重命名文件。
* 不新增依赖，除非现有技术无法合理完成任务。
* 不为了简化实现而移除既有行为。
* 不用 speculative abstraction 替换可工作的实现。
* 视觉重构不得修改业务逻辑，除非用户明确要求。
* UI-only 任务不得修改数据库结构。
* 不创建看似完整但没有真实数据流的占位功能。
* 优先显式、可维护的代码，而不是聪明抽象。
* 除非用户批准破坏性变更，否则保持向后兼容。

大型架构变更必须先产出设计说明或迁移方案，再修改生产代码。

## 8. 最高级禁令

Git 与工作树：

* 禁止自动提交。
* 禁止运行 `git reset --hard`、`git clean`、`git checkout --`、`git restore`、`git stash`、`git push`。
* 不得回滚、覆盖或混入用户已有变更；遇到会冲突的未知变更时停止并要求人工决策。

数据：

* SQLite 是 durable source of truth。
* schema 变更必须使用迁移，不得只靠启动时 ad hoc SQL 改生产结构。
* 未经用户明确批准，不删除表、列或用户数据。
* AI 输出是 proposal，验证并在必要时经用户确认后才能落库或影响计划。

AI：

* 不得把完整用户历史发送给模型。
* 不得因为真实模型单次失败就放宽业务安全边界、编造必填字段或让 AI 直接改变状态。
* 结构化 AI 输出必须做运行时校验，失败时不得静默补造关键字段。
* 真实 DeepSeek 合约测试是 opt-in，不作为默认自动 PASS 门槛。

安全与隐私：

* Renderer 不得直接访问 SQLite、Node.js 文件系统、操作系统监控 API、API key、Electron `safeStorage` 或无限制 IPC。
* 不得明文存储 API key，不得在日志、错误、AI 调用记录或数据库快照中泄露 secret。
* 不得自动执行 AI 生成的代码或 shell 命令。
* 不得实现截图、录屏、键盘记录、剪贴板监听、麦克风/摄像头采集、完整浏览器历史收集、私信内容收集、强制锁屏或隐藏后台监控。

## 9. 最低验证标准

完成任务前，至少执行与变更类型相匹配的检查。代码或行为变更通常需要检查 `package.json` 并运行相关的 typecheck、测试、构建或手工验证；纯文档任务可以用文档结构、行数、diff、关键词扫描和内容映射检查替代。

不得声称未运行的测试已经通过。命令失败时必须说明命令、失败现象、可能原因，以及是否由本次变更引入。

正式 Task-ID 任务的证据记录、命令日志和交付协议见 `.agent/WORKFLOW.md`。普通小型交互任务不强制生成完整证据目录，但仍必须遵守危险 Git 操作禁令和真实验证要求。

## 10. 完成标准

开发任务完成时必须满足：

* 请求行为已实现。
* 相关 UI 状态、数据持久化、AI 校验和用户确认规则按任务需要处理。
* 已执行相关测试或手工检查。
* 未有意改变无关功能。
* 需要时更新文档或项目记忆。

每个有意义任务结束时，用中文报告：

* 完成内容
* 修改文件
* 关键实现
* 验证方式和结果
* 未解决问题
* 潜在风险
* 是否更新了 `docs/PROJECT_MEMORY.md`

不要把推测或未验证工作报告为完成。

## 11. 项目记忆

`docs/PROJECT_MEMORY.md` 是新对话短交接入口，不是完整日志。

只在完成有意义的开发任务、架构决策、schema 变化、产品流程变化或未解决技术发现后更新项目记忆。不要因轻微 CSS 调整或临时调试更新。

项目记忆更新使用中文，并保持短小，优先记录：

* 日期
* 本次完成
* 关键决策
* 修改范围
* 验证结果
* 尚未解决
* 推荐下一步

不要把大段代码、完整日志或临时推理粘贴进项目记忆。长历史放入 `docs/archive/` 或具体报告。
