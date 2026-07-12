# DELIVERY.md — TASK-20260711-p31-plan-proposal

## 完成状态：已完成

## 交付内容

### 1. IPC 通道（shared/ipc.ts）
- `dataGetPlanVersions: 'data:getPlanVersions'`
- `dataCreatePlanProposal: 'data:createPlanProposal'`
- `dataConfirmPlanProposal: 'data:confirmPlanProposal'`
- `dataRejectPlanProposal: 'data:rejectPlanProposal'`

### 2. IPC handlers（main/ipc.ts）
- `dataGetPlanVersions` → `appService.getPlanVersionsForGoal`
- `dataCreatePlanProposal` → `appService.createPlanProposal`
- `dataConfirmPlanProposal` → `appService.confirmPlanProposal`
- `dataRejectPlanProposal` → `appService.rejectPlanProposal`

### 3. AppService adapter（app-service.ts）
- `getPlanVersionsForGoal(goalId)` → `modules.planning.getPlanVersionsForGoal`
- `createPlanProposal(goalId, proposal)` → `modules.planning.proposePlanChange`
- `confirmPlanProposal(proposalId)` → `modules.planning.confirmPlanChange`
- `rejectPlanProposal(proposalId)` → `modules.planning.rejectPlanChange`

### 4. Store 方法（store.ts）
- `getPlanVersionsForGoal(goalId)` — 按 goal 读取最近 10 个 plan version，含 snapshot 解析
- `createProposal(goalId, proposal)` — 写入 pending proposal
- `confirmProposal(proposalId)` — 应用变更 + 写 plan version + 标记 accepted（幂等）
- `rejectProposal(proposalId)` — 标记 rejected
- `findLatestPlanIdForGoal(goalId)` — 辅助方法

### 5. PlanningModule（planning.ts）
- `proposePlanChange(goalId, proposal)` → 调用 store.createProposal
- `confirmPlanChange(proposalId)` → 调用 store.confirmProposal
- `rejectPlanChange(proposalId)` → 调用 store.rejectProposal
- `getPlanVersionsForGoal(goalId)` → 调用 store.getPlanVersionsForGoal

### 6. Preload 暴露（preload/index.ts）
- `data.getPlanVersions(goalId)`
- `data.createPlanProposal(goalId, proposal)`
- `data.confirmPlanProposal(proposalId)`
- `data.rejectPlanProposal(proposalId)`

### 7. ReviewPage UI
- "计划变更历史"卡片：展示版本号、变更摘要、时间
- 空状态显示"尚无计划变更记录"
- 加载状态处理

### 8. 测试覆盖（store.test.ts）
- `createProposal writes a pending proposal`
- `confirmProposal applies changes and writes plan version`
- `confirmProposal is idempotent — repeated call does not create duplicate version`
- `rejectProposal does not modify any plan`
- `confirmProposal skips locked days`

## 验证结果

```
Test Files  12 passed | 1 skipped (13)
     Tests  128 passed | 6 skipped (134)
```

- `npm run typecheck` — 通过
- `npm run build` — 通过
