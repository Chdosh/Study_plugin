# 学习管家（Study Supervisor）

一款本地优先的 Windows 桌面 AI 学习系统。它把目标澄清、计划生成、专注学习、结果提交、AI 评估和复盘调整连接成可恢复的学习闭环，让 AI 不只回答问题，也能持续理解当前目标与学习进度。

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111827)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)

## 项目简介

学习管家面向需要长期推进的学习目标，而不是一次性的问答。系统会先通过对话澄清目标，再生成分层学习计划；学习过程中以任务和行动为执行单位，记录真实 Session、问题分支、提交结果与评价，并将结果反馈到后续计划。

所有核心学习状态都持久化在本地 SQLite 数据库中。应用重启后可以恢复当前任务、进行中的行动、学习上下文和计划版本；API Key 使用 Electron `safeStorage` 加密保存。

## 核心能力

- 通过 AI 对话澄清学习目标，生成可确认的目标简报
- 将长期目标拆分为 Roadmap、阶段计划和今日重点任务
- 管理 Task、Action 与 Focus Session，支持暂停、继续和恢复
- 提供与当前任务绑定的 AI 导师上下文和问题分支
- 提交学习结果并进行结构化评价，失败时保留可重试状态
- 在统一记录页查看 Session、行动、评价、复盘、知识沉淀和计划版本
- 本地持久化学习数据，并支持导出 JSON 备份
- 在桌面端使用窄 IPC 和类型化 preload 隔离 Renderer 与系统能力

## 学习闭环

1. 创建目标并完成目标澄清
2. 确认 AI 生成的目标简报与分层计划
3. 从概览进入当前重点任务
4. 在学习页执行 Action，并按真实状态记录 Session
5. 提交任务结果，获取 AI 评价与改进建议
6. 在记录页复盘过程，必要时调整后续计划

## 页面结构

| 页面 | 职责 |
| --- | --- |
| 概览 | 展示当前目标、阶段、学习路径和重点任务摘要 |
| 学习 | 承载当前任务、行动执行、AI 导师和结果提交 |
| 记录 | 汇总 Session、行动、评价、问题分支、复盘与计划版本 |
| 设置 | 管理 AI 模型、学习上下文、偏好、隐私、本地数据与诊断 |

## 技术架构

```text
React Renderer
      │ typed preload API
      ▼
Electron IPC / AppService
      │
      ├─ Planning Module
      ├─ Runtime Module
      ├─ Context Module
      └─ Branch Module
      │
      ▼
Store / Persistence / CurrentLearningContext
      │
      ▼
SQLite (libSQL + Drizzle ORM)
```

结构化 AI 输出由 Zod 在运行时校验。AI 只生成 proposal，关键计划和状态变化仍由应用规则与用户操作确认后落库。

## 技术栈

- Electron、electron-vite
- React、TypeScript、Lucide React
- SQLite、libSQL、Drizzle ORM
- OpenAI-compatible DeepSeek client
- Zod、Vitest

## 本地运行

环境要求：Windows、Node.js 和 npm。建议使用当前 Node.js LTS 版本。

```bash
git clone https://github.com/Chdosh/Study_plugin.git
cd Study_plugin
npm install
npm run dev
```

启动后进入“设置”，填写 DeepSeek API Key、Base URL 与模型名称。默认 Base URL 为 `https://api.deepseek.com`，默认模型为 `deepseek-chat`。

## 常用命令

```bash
npm run dev          # 启动开发环境
npm run typecheck    # TypeScript 类型检查
npm test             # 运行 Vitest 测试
npm run build        # 类型检查并构建生产版本
npm run db:generate  # 生成 Drizzle 迁移
```

真实 DeepSeek 合约测试默认跳过，只有在显式提供测试环境变量时才会访问远程模型。

## 项目结构

```text
src/
├─ main/       Electron 主进程、业务模块、AI 服务与持久化
├─ preload/    类型化 preload API
├─ renderer/   React 页面、组件、交互策略与样式
└─ shared/     跨进程共享类型、schema 与 IPC 契约
drizzle/       数据库迁移
docs/          当前项目规则与架构文档
```

## 本地数据与隐私

- 学习数据保存在 Electron `userData` 目录下的本地 SQLite 数据库中
- API Key 通过系统级 `safeStorage` 加密，不写入数据库或日志
- Renderer 无法直接访问 Node.js、SQLite、文件系统或系统监控 API
- 发送给模型的内容按任务上下文裁剪，不上传完整学习历史
- 设置页支持导出本地 JSON 数据用于备份和迁移

## 当前状态

项目处于持续迭代阶段，当前重点是稳定从目标创建到学习复盘的完整桌面流程，并持续收敛状态一致性、错误恢复和不同窗口宽度下的操作体验。
