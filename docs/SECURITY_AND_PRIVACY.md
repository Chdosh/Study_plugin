# Security and Privacy

## 1. Electron 安全要求

Use secure Electron defaults:

* `contextIsolation: true`
* `nodeIntegration: false`
* enable sandboxing where compatible
* expose only narrow, typed APIs through preload
* validate all IPC inputs
* return structured IPC errors
* do not expose generic filesystem or shell execution APIs to the Renderer
* do not use unrestricted dynamic IPC channel names
* do not store API keys in plain text
* do not include secrets in logs, error reports, AI-call records, or database snapshots
* do not execute AI-generated code or shell commands automatically
* do not open external URLs without validation

Any new privileged capability must be explicitly added to the preload contract and reviewed for scope.

The Renderer must not directly access:

* SQLite
* Node.js filesystem APIs
* operating-system monitoring APIs
* API keys
* Electron `safeStorage`
* unrestricted IPC channels

## 2. 监控与隐私边界

Allowed v1 monitoring:

* foreground application name
* window title
* focus-session start and end
* application switches
* away time
* skip and postpone reasons

Do not implement:

* screenshot monitoring
* screen recording
* keystroke logging
* clipboard monitoring
* microphone or camera monitoring
* full browser-history collection
* message-content collection
* forced application lockout
* hidden background surveillance

Monitoring requirements:

* Monitoring must be explicitly enabled by the user.
* The UI must visibly show when monitoring is active.
* The user must be able to pause or stop monitoring immediately.
* Support application exclusion rules.
* Do not collect data outside an active study session unless explicitly approved.
* Keep raw monitoring data local by default.
* Do not send raw window titles to AI unless necessary and clearly disclosed.
* Prefer aggregated summaries over raw event transmission.
* Provide a method to inspect and delete monitoring records.
* Never silently increase monitoring scope during an update.

Window titles may contain sensitive information. Treat them as private local data.

## 3. 敏感数据要求

Do not store API keys in plain text.

Do not include API keys, authentication tokens, unrelated private content, secrets, complete raw monitoring history, or sensitive window titles in logs, error reports, AI-call records, or database snapshots unless a task explicitly requires a local-only raw record and the user has approved that scope.

Prefer summaries and references over raw private content.
