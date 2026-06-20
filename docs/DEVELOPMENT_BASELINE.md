# 开发基线：UI 和产品流程重构前状态

日期：2026-06-20
工作目录：`D:\work\study_plugin`

## 当前分支

- 当前分支：`main`
- 当前 HEAD：`552747f` (`Unify study workbench flow`)
- 本地 Git remote：`origin`
- 目标 GitHub 仓库：`https://github.com/Chdosh/Study_plugin`
- 当前远端地址：`https://github.com/Chdosh/Study_plugin.git`
- 当前分支跟踪：`main...origin/main`
- GitHub CLI：当前环境未找到 `gh` 命令，无法用 CLI 验证登录状态或仓库信息。

## 当前 Git 状态

更新本基线文档前，工作区存在已暂存但未提交的文档改动：

```text
M  AGENTS.md
A  docs/DEVELOPMENT_BASELINE.md
M  docs/PROJECT_MEMORY.md
A  docs/UI_DASHBOARD_V1.md
A  docs/ui-dashboard-v1.html
```

说明：

- 上述变更均为文档类变更，没有业务代码改动。
- `docs/DEVELOPMENT_BASELINE.md` 已纳入暂存区，但当前 HEAD 仍停留在 `552747f`，说明这些文档变更尚未形成新的 commit。
- 开始后续 UI/产品流程重构前，建议先将这些文档变更提交为一个基线提交，再从该提交创建功能分支。

## 当前功能状态

- 应用是本地优先 Windows 桌面学习管家，基于 Electron 运行。
- 第一屏已经是“学习工作台”，导入计划、选择提示词、生成今日草稿、查看今日历史、确认计划和开始执行集中在同一页。
- DeepSeek API 通过 OpenAI-compatible SDK 调用，API Key 由 Electron `safeStorage` 保存。
- AI 导入、计划生成、复盘均通过 Zod schema 校验。
- 计划生成已增加宽松接收和本地归一化：模型缺少时间、时长、难度等字段时会尝试补齐；空 `blocks` 会使用本地未完成任务生成保守草稿。
- SQLite 是当前唯一事实源；RAG、知识库和向量索引尚未实现。
- v1 监控范围保持低侵入：前台应用名、窗口标题、学习 session、应用切换、跳过原因等。

## 启动方式

开发启动：

```powershell
npm.cmd run dev
```

生产构建：

```powershell
npm.cmd run build
```

构建后预览：

```powershell
npm.cmd run preview
```

类型检查：

```powershell
npm.cmd run typecheck
```

单元测试：

```powershell
npm.cmd test
```

开发日志：

```powershell
npm.cmd run devlog -- step "中文开发记录"
```

Drizzle schema 生成：

```powershell
npm.cmd run db:generate
```

## 当前主要技术栈

- 桌面壳：Electron `33.x`
- 构建：electron-vite + Vite
- UI：React `18.x` + TypeScript
- 样式：项目内 plain CSS，入口为 `src/renderer/src/styles.css`
- 图标：lucide-react
- 数据库：SQLite-compatible libSQL client + Drizzle ORM
- AI：OpenAI SDK 指向 DeepSeek base URL
- 运行时校验：Zod
- 密钥：Electron `safeStorage`
- 测试：Vitest
- 打包：electron-builder

## 页面入口和主要文件

- Electron 主进程入口：`src/main/index.ts`
- Preload 安全桥：`src/preload/index.ts`
- IPC 注册：`src/main/ipc.ts`
- Renderer UI 入口：`src/renderer/src/main.tsx`
- Renderer 样式：`src/renderer/src/styles.css`
- 共享 IPC channel：`src/shared/ipc.ts`
- 共享类型：`src/shared/types.ts`
- 数据库 schema：`src/main/db/schema.ts`
- 数据库 bootstrap：`src/main/db/bootstrap.ts`
- 数据库连接：`src/main/db/client.ts`
- 应用服务编排：`src/main/services/app-service.ts`
- 本地存储服务：`src/main/services/store.ts`
- AI agent 封装：`src/main/ai/agents.ts`
- AI prompt：`src/main/ai/agent-prompts.ts`
- 计划输出归一化：`src/main/ai/normalize-plan.ts`

## 数据库位置

源码中数据库路径由 `src/main/db/client.ts` 决定：

```text
join(app.getPath('userData'), 'study-supervisor.db')
```

当前 Windows/Electron 默认位置预期为：

```text
C:\Users\cc\AppData\Roaming\study-supervisor\study-supervisor.db
```

注意：不要通过删除本地数据库来解决迁移或数据问题，除非用户明确要求。

## 当前主要页面

- 学习工作台：导入计划、生成今日草稿、查看今日历史、确认草稿、开始/跳过/完成学习块。
- 任务清单：查看任务，手动更新任务状态。
- 复盘：基于本地执行数据生成每日评分和下一步动作。
- 设置：配置 DeepSeek base URL、模型、API Key、学习块分钟数和 prompt profile。

## 当前可用测试

当前 package scripts 暴露的测试/验证能力：

- `npm.cmd run typecheck`：TypeScript 类型检查。
- `npm.cmd test`：Vitest 单元测试。
- `npm.cmd run build`：先类型检查，再构建 Electron/Vite 输出。

当前已有测试覆盖：

- `src/shared/schemas.test.ts`：AI 输出 schema 基础校验。
- `src/main/ai/normalize-plan.test.ts`：DeepSeek 计划输出缺字段时的本地归一化。
- `src/main/services/store.test.ts`：prompt profile seed、导入解析落库、草稿计划落库。

本次基线任务未重新运行测试命令；此文档只记录当前可用命令和已知状态。

## 已知问题

- 当前工作区已有暂存文档改动，后续开分支前建议先提交或明确保留在当前分支。
- `gh` CLI 当前不可用，无法在本机命令行验证 GitHub 登录或仓库状态。
- 真实 Electron UI 的自动化截图/端到端测试仍缺少稳定流程；之前普通 Browser 对本地 file 页面访问被策略拦截。
- 真实 DeepSeek 端到端流程仍需继续验证：确认计划 -> 开始学习 -> 跳过/完成 -> 生成复盘。
- Windows 前台应用探测可能受权限、PowerShell 策略和系统语言影响，需要保持可选、非阻塞。
- 旧本地数据库中可能存在早期英文 prompt profile，需要继续注意默认 prompt 迁移一致性。
- Figma/设计文档相关记录显示曾遇到 Starter 计划 MCP 调用上限，设计稿写入画布可能未完成。

## 建议的新分支名称

建议从整理后的基线提交之后创建：

```text
feature/workbench-flow-baseline
```

如果下一步直接进入更大范围 UI 重构，也可以使用：

```text
feature/workbench-ui-refactor
```
