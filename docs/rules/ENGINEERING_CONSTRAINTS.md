# 工程约束与验证规则

状态：CURRENT
生效日期：2026-08-03
适用范围：所有修改、重构、迁移与验证任务；由 AGENTS.md 按需引用。
失效条件：相应约束被用户明确确认修改。

## 1. 状态与事实所有权

- 一个业务事实只有一个正式来源。Goal、Learning Guide、Task、Action、Focus Session、Submission 和 Evaluation 都只能有一个正式来源；`current_learning_context` 只保存导航指针，不保存或复制这些对象的业务状态。Renderer 不得维护第二套业务位置，不同页面不得各自推导同一状态机。
- `current_learning_context` 的唯一写入 owner 是 CurrentLearningContextPersistence。Task/Guide 的关闭、暂缓和切换必须与导航指针在同一事务更新。
- `duration_seconds` 的唯一写入 owner 是 Runtime；Renderer、ContextBuilder、EventBus 消费者和统计查询不得修改。

## 2. AI 边界

- AI 生成内容，程序推进状态：AI 输出必须经过运行时和业务校验。AI 不得直接标记完成、改变 Current Context、覆盖历史或未经确认永久修改计划与用户画像。
- 统一 Agent Loop：所有 AI 教学与规划能力通过统一 Agent Loop + Tool Registry 执行；新增 AI 能力时新增工具，不新增独立 Agent。
- `ask_user` 是同一个持久化 Agent Run 内的暂停点：问题先保存，Run 进入 `waiting_user`；用户回答后恢复原 Run 和工具上下文。不得把它实现成生成 proposal、结束调用、再发起一轮无关联调用。
- 主线主动教学中的小测必须形成完整 Learning Turn：`quiz → ask_user → 用户回答 → evaluate` 在同一个可恢复 Run 中完成。小测回答属于过程证据，不是正式 Submission。
- Agent Run、工具调用、暂停、恢复和失败事实统一记录在扩展后的 `ai_reviews`。不持久化隐藏推理；需要恢复的意图必须保存为结构化状态。

## 3. 数据与迁移

- SQLite 是 durable source of truth；schema 变化必须使用迁移，且迁移必须可回滚。
- 未经用户明确批准，不删除表、列或用户数据。
- V1→V2 迁移器是独立一次性升级模块，不进入 Store、Runtime、正常查询、日常启动流程或主运行 bundle；迁移后不再加载，但源码、测试、版本识别和手动恢复能力长期保留。
- 正常 Runtime 只打开完成核对的 V2 数据库，不读取 V1 归档或 `.building` 文件。
- 新增设计必须同时消灭对应的旧复杂度。禁止无期限保留双写、双读、旧 Agent 包装层或两套 prompt 作为“兼容”。

## 4. 安全与隐私底线

- Renderer 不直接访问 SQLite、Node 文件系统、API key、safeStorage 或操作系统监控 API。
- 不在日志、错误、AI 调用或数据库快照中泄露 secret。
- 不自动执行 AI 生成的代码或 shell 命令。
- 不实现截图、录屏、键盘记录、剪贴板监听、麦克风/摄像头采集、完整浏览历史收集、私信收集、强制锁屏或隐藏监控。
- 真实 AI 服务测试是 opt-in，必须显式提供当前服务的地址、模型和密钥；除非用户明确要求，不自动消耗额度。

## 5. 修改与验证要求

- 使用纵向业务切片：“最小变更”指最小可完整验收的业务切片。真实症状跨越 Renderer、IPC、Module、Store 和数据库时，必须跨层修复，但不得顺手重构无关区域。
- 每个业务修改先明确：入口状态、用户动作、业务 owner、数据变化、成功终态、失败恢复和重复执行语义；以及“新增什么 / 替换什么 / 删除什么 / 迁移期如何结束”。
- Bug 任务必须先建立能捕获真实症状的反馈环，先复现，再提出 3–5 个可证伪假设，然后逐项验证，不能先修改再寻找解释。
- 修复时应将真实复现固化成红色测试或等价检查。测试 fixture 必须能通过真实调用链到达，禁止构造业务上不可能出现的状态取得假绿。
- 验证按风险匹配：纯 CSS 用 typecheck 和真实窗口检查；JSX/交互用相关测试和真实 Electron 状态；状态机/service/store 用逻辑测试、跨层集成测试和完整用户路径；IPC/preload 用 typecheck、相关测试和 build；schema/迁移用新旧数据库迁移、备份和恢复路径；AI schema/prompt 覆盖正常、非法、超时和失败恢复；多层闭环用 typecheck、全部测试、build 和真实 Electron 主路径。
