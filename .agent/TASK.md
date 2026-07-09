# 当前任务

## Task ID
FLOAT-003

## 任务名称
实现浮窗位置持久化、应用重启恢复、主窗口跳转联动

## 背景

FLOAT-002 已实现浮窗完整 UI。还需要：
1. 浮窗位置持久化（记住最后位置）
2. 应用重启后如果存在未结束会话，浮窗自动恢复
3. "打开主程序"按钮跳转到 Study 页面
4. 主窗口 Study 页面的会话控制与浮窗同步

## 本次目标

1. 浮窗拖动结束后保存位置到 `app_settings`（key=`floatWindowPosition`）。
2. 浮窗启动时读取保存的位置。
3. 浮窗启动时检查是否有 active session，有则自动显示。
4. 主窗口"打开主程序"时跳转到 Study 页面。
5. 确保主窗口和浮窗的会话状态完全同步。

## 修改范围

- `src/renderer/src/float-main.tsx` — 添加位置保存/恢复逻辑
- `src/main/index.ts` — 浮窗启动时恢复位置，应用重启时检查活跃会话
- `src/main/services/app-service.ts` — 可能需要调整 pushSessionState 的触发时机

## 禁止修改

- `src/main/db/schema.ts`、`src/renderer/src/main.tsx`、`src/shared/`、`src/preload/`、`design-prototype/`、`package.json`

## 实施要求

### 位置持久化
- 浮窗拖动结束（mouseup）后，调用 `window.floatApp.float.savePosition(x, y)`
- 浮窗启动时调用 `window.floatApp.float.getPosition()` 恢复位置
- 位置存储在 `app_settings` 表，key=`floatWindowPosition`，value=`{"x":100,"y":50}`

### 应用重启恢复
- 浮窗 Renderer 启动时调用 `window.floatApp.session.getActive()`
- 如果有 active session，自动显示浮窗并加载会话数据
- 如果没有 active session，浮窗保持隐藏

### 主窗口跳转
- `float:openMain` IPC handler 已存在，需要确保主窗口跳转到 Study 页面
- 可以通过 `mainWindow.webContents.send('navigate', 'study')` 实现
- 主窗口 Renderer 监听 `navigate` 事件并切换 view

## 验收标准

1. typecheck 通过。
2. test 8/8 通过。
3. build 通过。
4. 浮窗位置在重启后保持。
5. 应用重启后有活跃会话时浮窗自动出现。
6. 打开主程序按钮正确跳转到 Study 页。
7. 主窗口和浮窗会话状态同步。

## 交付证据
`.agent/DELIVERY.md`
