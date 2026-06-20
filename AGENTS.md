# Study Agent Development Instructions

## 1. Product Vision

Build a local-first Windows desktop AI learning system that gradually becomes a long-term personal learning teacher.

The product should help the user:

* define learning goals
* convert goals into executable plans
* decide what to study now
* enter and complete focused study sessions
* receive explanations, exercises, and assessments
* review actual execution
* adjust future plans
* accumulate reusable knowledge and long-term learning memory

The long-term vision includes supervision, planning, tutoring, evaluation, reflection, personal knowledge management, and contextual long-term memory.

Do not attempt to implement the entire long-term vision in the current MVP.

## 2. Current MVP

The current MVP should support the following complete loop:

1. The user pastes or manually creates a study goal or study plan.
2. The system parses the content into structured goals and tasks.
3. AI proposes a daily plan using approximately 10-minute planning units.
4. The user reviews and confirms the plan.
5. The user starts a study session.
6. The system records session time, foreground application changes, away time, and task status.
7. The user completes, skips, postpones, or partially completes the task.
8. AI generates a review and proposes plan adjustments.
9. The user confirms or rejects the proposed adjustment.
10. Important notes, questions, errors, and summaries can later enter the knowledge base.

A feature is not complete merely because a page or API exists. It should participate in a usable end-to-end workflow.

## 3. Core Product Loop

The primary product loop is:

goal setting
→ planning
→ study execution
→ completion assessment
→ reflection
→ plan adjustment
→ knowledge accumulation

The most important questions the application must answer are:

* What should I study now?
* Why should I study it?
* What does successful completion look like?
* How well did I actually complete it?
* What should change next?

Avoid building disconnected feature pages that do not contribute to this loop.

## 4. Instruction Priority

When instructions conflict, follow this order:

1. The user's current explicit request.
2. This `AGENTS.md`.
3. `docs/PROJECT_MEMORY.md`.
4. Existing product and architecture documentation.
5. Existing implementation patterns.
6. General recommendations in this file.

The existing project, `package.json`, lockfile, database migrations, and current implementation are the source of truth for already implemented technology choices.

The recommended stack in this file applies mainly to new or unimplemented modules. Do not migrate frameworks, styling systems, databases, or state-management libraries without explicit user approval.

## 5. Required Reading and Project Memory

Before implementing or reviewing code:

1. Read this file.
2. Read `docs/PROJECT_MEMORY.md`.
3. Inspect the files directly related to the current task.
4. Inspect existing reusable components, services, types, and tests.

Update `docs/PROJECT_MEMORY.md` only after a meaningful development task, architectural decision, schema change, product-flow change, or unresolved technical discovery.

Do not update it after every minor CSS adjustment or temporary debugging attempt.

Write memory updates in Chinese using this structure:

* 日期
* 本次完成
* 关键决策
* 修改范围
* 验证结果
* 尚未解决
* 推荐下一步

Do not paste large code blocks, complete console logs, or temporary reasoning into project memory.

If old memory conflicts with the current implementation, document the conflict and treat the current verified implementation as the temporary source of truth.

## 6. Language Requirements

* Write development records, design rationale, iteration notes, migration context, and project-memory updates in Chinese.
* The user-facing application UI should use Chinese text.
* Keep code identifiers, database columns, API fields, TypeScript types, and technical names in English when this improves maintainability.
* Avoid mixed Chinese and English UI labels unless the English term is necessary or widely recognized.

## 7. Working Rules for Codex

Before modifying code:

1. Inspect the current implementation.
2. Identify the smallest relevant change scope.
3. Identify reusable components and existing patterns.
4. State assumptions when requirements are ambiguous.
5. Check whether the requested change affects data, IPC, AI behavior, or existing user flows.

During implementation:

* Make the smallest coherent change that completes the requested task.
* Work on one page, module, or end-to-end flow at a time.
* Do not perform unrelated refactoring.
* Do not rename large groups of files without a clear need.
* Do not add dependencies when the existing stack can solve the problem.
* Do not remove existing behavior merely to simplify implementation.
* Do not silently replace working implementations with speculative abstractions.
* Do not modify business logic during a visual-only refactor unless explicitly requested.
* Do not modify database structure during a UI-only task.
* Do not create placeholder functionality that appears complete but has no working data flow.
* Prefer explicit and maintainable code over clever abstraction.
* Preserve backwards compatibility unless the user explicitly approves a breaking change.

When a task requires a large architectural change, first produce a design note or migration proposal before editing production code.

## 8. Recommended Stack

Preferred stack for new modules when compatible with the existing project:

* Desktop: Electron + electron-vite
* UI: React + TypeScript
* Styling: the existing project styling system
* Database: SQLite + Drizzle ORM
* AI client: OpenAI-compatible client configured for DeepSeek
* Runtime validation: Zod or an equivalent schema validator
* Secrets: Electron `safeStorage`
* Packaging: electron-builder
* Logic tests: Vitest
* Critical desktop flows: Playwright with Electron support

Do not install Tailwind, a component library, a state-management library, LangChain, LlamaIndex, or another major dependency solely because it is listed as a common recommendation.

Use the existing implementation unless migration has been explicitly approved.

## 9. Application Architecture

Use a local-first architecture.

Principles:

* SQLite is the durable source of truth.
* AI outputs are proposals until validated and, where required, confirmed.
* Derived indexes and caches must be rebuildable.
* Prompt templates are versioned data rather than scattered hardcoded strings.
* UI components must not contain domain-level agent logic.
* Side effects must be explicit.
* Agent roles should initially be implemented as domain services, not autonomous multi-agent processes.

Recommended dependency direction:

Renderer UI
→ typed preload API
→ Electron main-process application services
→ domain services
→ repositories and AI client
→ SQLite and local operating-system capabilities

The Renderer must not directly access:

* SQLite
* Node.js filesystem APIs
* operating-system monitoring APIs
* API keys
* Electron `safeStorage`
* unrestricted IPC channels

Core domain roles:

* `import-service`: parse pasted study plans
* `planning-service`: create and revise plans
* `tutoring-service`: explanations, examples, exercises, and hints
* `evaluation-service`: assess completion and understanding
* `scheduling-service`: propose replanning
* `reflection-service`: daily and weekly review
* `supervision-service`: interpret focus and foreground-application events
* `retrieval-service`: future knowledge retrieval

These names describe responsibilities. They do not require independent autonomous agents or agent-to-agent conversations.

Prefer one explicit orchestration layer over a multi-agent framework in v1.

## 10. Electron Security Requirements

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

## 11. Data Model

Use database migrations for every schema change.

Never modify an existing production database schema only through ad hoc SQL executed at application startup.

Core v1 tables may include:

* `raw_imports`
* `goals`
* `task_items`
* `task_dependencies`
* `daily_plans`
* `daily_plan_blocks`
* `study_sessions`
* `focus_events`
* `skip_logs`
* `ai_reviews`
* `prompt_profiles`
* `prompt_versions`
* `plan_versions`
* `app_settings`

Future knowledge-base tables may include:

* `knowledge_sources`
* `knowledge_chunks`
* `chunk_embeddings`
* `retrieval_logs`
* `memory_summaries`
* `user_profile_facts`

Do not create future tables before a real feature requires them.

Data rules:

* Use transactions for multi-record updates.
* Preserve the user's confirmed plan when creating a new proposal.
* Use version records for significant plan changes.
* Do not delete tables, columns, or user data without explicit approval.
* Prefer soft deletion or archival when recovery may be necessary.
* Define clear timestamps and status transitions.
* Avoid storing duplicate AI-generated text in multiple tables without a clear reason.
* Keep derived data rebuildable from durable source records.

## 12. AI Context Strategy

Never send the complete user history to the model.

Use layered context:

* current request and current task
* current confirmed plan
* unresolved tasks
* recent raw events where necessary
* daily summaries
* weekly summaries
* long-term user profile
* retrieved knowledge chunks

Only include context that is necessary for the current AI operation.

Every meaningful AI call should record, when available:

* provider
* model
* prompt profile
* prompt version
* output schema version
* sanitized input snapshot or input reference
* raw or normalized result status
* token usage
* estimated cost
* latency
* validation status
* error category

Never record:

* API keys
* authentication tokens
* unrelated private content
* complete raw monitoring history when a summary is sufficient

## 13. AI Output Rules

AI output is untrusted external data.

For structured operations:

* request structured JSON
* validate it using a runtime schema
* reject or repair invalid output before persistence
* preserve existing confirmed data when validation fails
* show a clear error state to the user
* use bounded retries
* do not retry indefinitely
* do not silently fabricate missing required fields

AI must not directly:

* overwrite confirmed plans
* delete user data
* mark a task complete
* permanently change a goal
* expand monitoring scope
* modify user-profile facts
* execute code or system commands

For consequential changes, present:

* the proposed change
* the reason
* the difference from the current state
* affected tasks or dates
* confirm and reject actions

## 14. RAG and Knowledge-Base Plan

Do not introduce LangChain or LlamaIndex in v1 unless the existing implementation clearly requires it.

Preferred progression:

1. Stable task, session, review, and source data.
2. SQLite FTS5 keyword search.
3. Source-document ingestion and chunking.
4. Vector search using LanceDB or `sqlite-vec`.
5. Retrieval evaluation.
6. Reranking only if retrieval quality is insufficient.
7. LlamaIndex.TS only if ingestion and multi-step retrieval become materially complex.

RAG indexes are derived artifacts and must be rebuildable.

Do not treat generated summaries as original source material.

Every knowledge item should retain provenance where possible:

* source
* creation method
* related goal
* related study session
* timestamp
* confidence or review status

## 15. Monitoring and Privacy Boundary

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

## 16. Planning Rules

Use approximately 10 minutes as the default planning granularity, not as a rigid UI constraint.

Related planning blocks may be grouped into a longer study session.

Each planning block should include:

* `objective`
* `action`
* `expectedOutput`
* `estimatedMinutes`
* `difficulty`
* `requiredMaterial`
* `successCheck`
* `fallbackAction`

AI may propose:

* splitting a task
* deferring a task
* reducing difficulty
* adding a prerequisite
* increasing practice
* changing explanation mode to quiz mode
* reducing the daily workload
* moving unfinished work
* creating a recovery plan

AI must not overwrite a confirmed plan without user approval.

A task should have explicit status transitions, such as:

* `planned`
* `active`
* `completed`
* `partially_completed`
* `skipped`
* `postponed`
* `cancelled`

Do not infer completion only from elapsed time or foreground-application activity.

## 17. Prompt Profiles

Support editable prompt profiles:

* `foundation`: detailed and beginner-friendly
* `standard`: balanced explanation and practice
* `advanced`: concise and assumes background knowledge
* `exam`: quiz-heavy and output-driven
* `recovery`: used after missed sessions or low completion

Prompt profiles should affect instructional style, not override product safety, privacy, data-integrity, or confirmation requirements.

Prompt changes should be versioned.

Do not hardcode multiple inconsistent prompt copies across UI components and services.

## 18. Product Information Architecture

Primary navigation should remain limited and task-oriented.

Recommended top-level areas:

* Today
* Plan
* Study
* Knowledge
* Review
* Settings

The AI tutor should normally appear as a contextual assistant panel rather than an isolated generic chat page.

Page responsibilities:

### Today

Answer:

* What should I do now?
* What is most important today?
* What changed since yesterday?
* How do I begin?

The page should have one dominant primary action, normally “开始学习”.

### Plan

Show the hierarchy:

goal
→ stage
→ weekly objective
→ daily task
→ study block

AI plan changes must be previewed before confirmation.

### Study

Show:

* current task
* expected outcome
* timer and session state
* learning material
* notes
* contextual tutor
* pause and end actions

Avoid disruptive modal dialogs during an active study session.

### Knowledge

Organize:

* learning sources
* knowledge notes
* questions
* mistakes
* summaries
* mastery state

Do not build a visual knowledge graph before search, classification, review, and provenance are stable.

### Review

Show data that can change future behavior:

* effective study time
* completion rate
* estimated versus actual duration
* repeated postponement reasons
* weak topics
* unfinished tasks
* suggested adjustments

Avoid decorative metrics that do not help decision-making.

## 19. UI and Interaction Rules

Use the existing component system and design tokens.

Maintain visual consistency across pages.

Rules:

* Use one clear primary action per page or dialog.
* Reuse components before creating near-duplicates.
* Use consistent spacing, typography, border radius, and interaction states.
* Use formal icons rather than emoji as UI icons.
* Avoid excessive gradients, glassmorphism, glow effects, shadows, and decorative animation.
* Do not place every content group inside a card.
* Use color primarily to communicate hierarchy and state.
* Preserve readable contrast.
* Prefer progressive disclosure over displaying every option simultaneously.
* Keep destructive actions visually distinct.
* Require confirmation for irreversible actions.
* Keep important actions reachable by keyboard where practical.

Every significant page or component should consider:

* loading state
* empty state
* error state
* disabled state
* partial-data state
* offline or AI-unavailable state

The user should always be able to identify:

* the current task
* the current system state
* what action is available
* what will happen after the action
* whether a change has been saved
* whether an AI result is only a suggestion

During UI refactoring:

* preserve current business behavior
* do not alter schemas
* do not rewrite unrelated services
* do not add speculative features
* verify the complete user flow after visual changes

## 20. Non-Goals

For v1, do not:

* scrape ChatGPT or Codex web sessions
* monitor phone usage
* capture screenshots
* capture keystrokes
* collect private message content
* build autonomous multi-agent collaboration
* build a complex knowledge graph
* build RAG before core task and session data is stable
* allow AI to make permanent changes without confirmation
* build social ranking or gamification systems
* build a course marketplace
* implement forced lockout
* add cloud synchronization without a separate privacy and conflict-resolution design

## 21. Testing Requirements

Test domain logic separately from UI.

Prioritize tests for:

* plan parsing
* plan validation
* task-status transitions
* plan versioning
* session start, pause, resume, and end
* monitoring-event aggregation
* AI-output validation
* failed AI requests
* user confirmation and rejection
* database migrations
* IPC input validation

Critical end-to-end flows:

1. Create or import a goal.
2. Generate a proposed plan.
3. Confirm the plan.
4. Start a study session.
5. Record session events.
6. End and review the session.
7. Generate an adjustment proposal.
8. Confirm or reject the adjustment.
9. Restart the application and verify data persistence.

Before completing a task, inspect `package.json` and run the relevant available commands, such as:

* lint
* typecheck
* unit tests
* relevant integration tests
* production build

Do not claim a test passed unless it was actually run.

If a command cannot run, report:

* the command
* the failure
* the likely cause
* whether the failure was introduced by the current change

## 22. Database and Migration Safety

Before modifying schema:

1. Inspect existing migrations.
2. Inspect current repository types and queries.
3. Determine whether the change is backward compatible.
4. Create a migration.
5. Verify migration on a clean database.
6. Verify migration on representative existing data where possible.

Do not:

* reset the user's local database automatically
* delete the database to fix a migration problem
* reuse an existing migration for a different schema change
* silently discard invalid records
* alter confirmed plans without preserving a previous version

## 23. Completion Criteria

A development task is complete only when:

* the requested behavior is implemented
* the relevant UI states are handled
* data persists correctly where required
* AI output is validated where required
* user confirmation rules are preserved
* relevant tests or manual checks have been performed
* no unrelated functionality was intentionally changed
* documentation or project memory is updated when appropriate

At the end of each meaningful task, report in Chinese:

* 完成内容
* 修改文件
* 关键实现
* 验证方式和结果
* 未解决问题
* 潜在风险
* 是否更新了 `docs/PROJECT_MEMORY.md`

Do not report speculative or unverified work as complete.

## 24. Reference Projects

The following projects may be studied for ideas:

* DeyWeaver: AI task scheduling and dynamic reallocation
* Multi-Agent-Study-Assistant: educational responsibility separation
* ExamRAG: hybrid retrieval, concept relationships, and assessment
* 5ire: desktop AI assistant, provider abstraction, MCP, and local knowledge
* Leon: personal assistant architecture with tools, memory, and skills
* Graphiti: temporal knowledge graphs and long-term memory

These projects are references, not architectural requirements.

Do not:

* copy their architecture without evaluating project needs
* add a dependency only because a reference project uses it
* block development when a reference cannot be accessed
* describe unverified reference behavior as fact
