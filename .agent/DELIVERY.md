# TASK-20260629-float-window-sync Delivery

## 完成内容

- 修复浮动窗口拖拽后鼠标释放可能误触发展开或打开主程序的问题。
- 统一主窗口和浮动窗口的学习计时计算，避免打开主程序后 Study 页面显示旧 session 时间。
- 打开主程序或导航到 Study 页面时主动同步当前活跃学习 session。
- 增加浮窗行为纯函数回归测试，覆盖拖拽阈值、拖拽后激活抑制、session elapsed seconds 计算。

## 修改文件

- `src/renderer/src/float-behavior.ts`
- `src/renderer/src/float-behavior.test.ts`
- `src/renderer/src/float-main.tsx`
- `src/renderer/src/main.tsx`
- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/main/ipc.ts`
- `docs/PROJECT_MEMORY.md`

## 关键实现

- 使用 4px 阈值区分真实拖拽和普通点击。
- 拖拽结束后短时间抑制 click/double-click，防止拖动动作被解释为展开或打开主程序。
- 将计时公式集中到 `getSessionElapsedSeconds`，主窗口和浮窗共用同一计算来源。
- `StudyAppApi.sessions` 新增 `getActive`，Renderer 可在初始加载和页面导航时读取主进程当前活跃 session。
- `floatOpenMain` 在打开/聚焦主窗口后推送最新 session 状态。

## 验证结果

- `npm.cmd test -- src/renderer/src/float-behavior.test.ts`：先红后绿，最终通过 3/3。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：通过 12/12。
- `npm.cmd run build`：通过。

完整日志位于 `.agent/evidence/TASK-20260629-float-window-sync/`。

## 未完成

- 未执行真实桌面 GUI 手工冒烟。当前验证覆盖静态行为、类型、单元测试和生产构建。
