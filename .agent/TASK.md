# 当前任务

## Task ID
TASK-20260711-p5p6-experience

## 任务名称
P5 知识复习 + 学习风格设置 + P6 Session 锚点收敛

## 目标
1. 知识项按出现次数 ≥ N 自动进入复习队列
2. Review 页知识库增加"标记复习"按钮 + 复习入口
3. 学习风格设置：简洁/详细/代码优先（影响 teach prompt）
4. Token 成本统计 IPC
5. Session 锚点收敛：修正 blockId→taskId 参数名，标记 skipBlock 为 deprecated

## 修改范围

### 允许修改
- `src/main/services/store.ts` — Token cost stats, review queue methods
- `src/main/services/app-service.ts` — adapter + startSession 参数名修正
- `src/main/ipc.ts` — stats IPC
- `src/shared/ipc.ts` — channels
- `src/preload/index.ts` — API
- `src/renderer/src/pages/ReviewPage.tsx` — review entry UI
- `src/renderer/src/pages/SettingsPage.tsx` — learning style select
- `src/renderer/src/pages/StudyPage.tsx` — skipCurrentTask IPC rename
- 测试文件

### 禁止修改
- schema（不改列）
- AGENTS.md

## 实施要求

### Step 1: Review 页 — 知识项复习入口
在 ReviewPage 知识库卡片中，每项增加：
- 出现次数 ≥ 2 时显示"已纳入复习"徽章
- "标记复习"按钮（手动标记）
- 按出现次数排序（已有，确认保留）

### Step 2: Settings — 学习风格
SettingsPage 增加"学习偏好"卡片：
- 教学风格：简洁 / 详细 / 代码优先
- 保存到 app_settings（key=learningStyle）
- AppService 读取此设置注入 teach prompt

### Step 3: Token 成本统计
Store 层：
```typescript
async getTokenCostStats(opts: { goalId?: string; operation?: string; fromDate?: string; toDate?: string }): Promise<{
  totalTokens: number;
  totalCalls: number;
  byOperation: Record<string, { tokens: number; calls: number }>;
  byDate: Record<string, { tokens: number; calls: number }>;
}>
```
- 从 ai_reviews 表聚合 input_tokens + output_tokens
- 不记录 secret（token 数字本身不是 secret）

IPC: `stats:getTokenCost`
UI: ReviewPage 或 SettingsPage 展示统计（简单表格即可）

### Step 4: Session 锚点收敛（Q1）
- `startSession(blockId: Id)` → `startSession(taskId: Id)` + 内部用这个 taskId 调用 module
- `skipBlock(blockId, reason)` → 标记 deprecated，内部改为 skipCurrentTask
- `getAccumulatedSeconds(blockId, ...)` → 增加 `taskId` 参数重载
- `getActiveSession()` 中移除 legacyPlanBlockId 回退逻辑（改为仅用 taskId）

### Step 5: 测试
- store.test.ts: getTokenCostStats 测试
- app-service.test.ts: startSession 参数名修正后的回归测试

## 验收标准
1. 知识项出现 ≥ 2 次后显示"已纳入复习"徽章
2. 学习风格设置保存并读取
3. Token 成本统计按 operation/date 聚合
4. startSession 参数名统一为 taskId（不再使用 blockId）
5. All tests passed, typecheck, build 通过

## 验证命令
```
npm test
npm run typecheck
npm run build
```

## 迭代规则
完成 → DELIVERY.md → 最终 E2E 验收