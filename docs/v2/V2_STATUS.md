# V2 Status

> 只读审计阶段状态，冻结于 2026-07-05。
> 限制 120 行。

## 当前阶段

**Phase 0：冻结审计**（进行中）

## 已完成

| 交付物 | 状态 | 行数 |
|--------|------|------|
| `docs/v2/FEATURE_LEDGER.md` | ✅ 完成 | 功能清单 + 重复分析 + 孤岛标记 |
| `docs/v2/LEGACY_MAP.md` | ✅ 完成 | 模块职责矩阵 + 状态位置清单 + IPC/页面/Store 判定 |
| `docs/v2/AI_CONTEXT_MATRIX.md` | ✅ 完成 | 8 个 AI 调用完整上下文链路 + V2 AI Task 映射 |
| `docs/v2/V2_STATUS.md` | ✅ 本文件 | 阶段状态 |

## 下一任务

**Phase 1：V2 核心骨架**（待用户批准本审计后启动）

1. 定义 V2 五个核心概念的 TypeScript 类型（Journey / Artifact / Event / Action / AI Task）
2. 创建 `dispatchLearningAction` 统一入口签名
3. 提取当前可复用模块的最小接口（AiClient、promptProfiles、settingsService）
4. 创建 `learning_runtime_v2` 单例表替代 `learning_runtime_states`（统一指针到 taskId+actionId）
5. 迁移 session 锚点从 blockId 到 taskId

## 后续允许读取的文件

Phase 1 启动时，以下文件为必读输入：

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | 治理规则 |
| `docs/PRODUCT_TRUTH.md` | 产品事实源 |
| `docs/AI_AND_DATA_RULES.md` | AI 调用与数据规则 |
| `docs/ARCHITECTURE.md` | 架构约束 |
| `docs/v2/FEATURE_LEDGER.md` | 功能清单与迁移计划 |
| `docs/v2/LEGACY_MAP.md` | 模块判定与状态位置 |
| `docs/v2/AI_CONTEXT_MATRIX.md` | AI 调用链路 |
| `src/shared/types.ts` | 当前类型定义 |
| `src/shared/schemas.ts` | AI 输出 schema |
| `src/main/ai/ai-client.ts` | AI 客户端（直接复用） |
| `src/main/ai/agent-prompts.ts` | 当前 prompt 文本 |
| `src/main/db/schema.ts` | 当前数据库 schema |
| `src/main/services/settings-service.ts` | 设置服务（直接复用） |
| `src/main/db/default-prompts.ts` | 默认 prompt profiles |

## 当前阻塞

无。

## Token 预算

| 项目 | 预算 | 已用（估算） |
|------|------|-------------|
| 本任务总计 | 500,000 | ~120,000（含代码阅读 + 四份文档撰写） |
| 剩余 | ~380,000 | — |

## 注意事项

- 本审计为只读：未修改任何业务代码、schema、Prompt、UI、测试或配置。
- 所有判定基于 2026-07-05 代码快照；后续代码变更可能使本审计过时。
- V2 启动前应重新读取 `docs/PROJECT_MEMORY.md` 确认无新增风险。
