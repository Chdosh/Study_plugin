# 学习管家 UI 原型

这是与正式业务隔离的 UI 原型，只使用假数据展示第一阶段点击流程：

```text
今日 -> 开始学习 -> 学习 -> 结束学习 -> 学习结算 -> 复盘
```

## 启动

在仓库根目录运行：

```powershell
cd D:\work\study_plugin
npm.cmd --prefix design-prototype run dev
```

默认地址：

```text
http://127.0.0.1:5174
```

开发状态预览路由：

```text
http://127.0.0.1:5174/#/dev/states
```

## 隔离边界

- 不调用正式 `src/` 业务代码。
- 不调用数据库。
- 不调用 DeepSeek。
- 不启动真实监控。
- 不写入本地数据。
- 所有页面内容、状态和跳转都来自 `src/main.tsx` 内的假数据。
