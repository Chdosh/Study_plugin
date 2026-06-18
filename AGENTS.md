# Study Agent System Reference

## Product Goal
Build a local-first Windows desktop AI learning supervisor. The app imports study plans copied from ChatGPT/Codex web sessions, calls DeepSeek API to generate 10-minute study plans, monitors execution, scores completion, and suggests plan adjustments.

## Required Agent Reading
Before implementing or reviewing code, read this file and `docs/PROJECT_MEMORY.md`. Treat `docs/PROJECT_MEMORY.md` as the cross-chat continuity record and update it after each small development step.

## Non-Goals
- Do not scrape ChatGPT web sessions in v1.
- Do not monitor phone usage.
- Do not capture screenshots, keystrokes, or private content in v1.
- Do not make AI changes permanent without user confirmation.
- Do not build RAG before core task/session data is stable.

## Recommended Stack
- Desktop: Electron + electron-vite
- UI: React + TypeScript
- Styling: Tailwind or plain CSS, avoid overbuilt UI early
- Database: SQLite + Drizzle ORM
- AI client: OpenAI-compatible SDK pointed at DeepSeek base URL
- Secrets: Electron safeStorage for API keys
- Packaging: electron-builder
- Tests: Vitest for logic, Playwright/Electron for UI flows

## Architecture
Use a local-first architecture:
- SQLite is the source of truth.
- AI outputs are suggestions until confirmed.
- Vector indexes and RAG stores must be rebuildable from SQLite/source files.
- Prompt templates are versioned data, not hardcoded strings.
- Keep agent logic separate from UI.

Core modules:
- import-agent: parse pasted ChatGPT/Codex plans
- planner-agent: generate 10-minute daily plan blocks
- tutor-agent: generate explanations, examples, exercises
- evaluator-agent: score completion and focus quality
- scheduler-agent: propose replanning
- reflection-agent: daily/weekly review
- supervisor-agent: interpret foreground app/focus events
- retrieval-agent: future RAG and personal knowledge base

## Data Model
Minimum tables:
- raw_imports
- goals
- task_items
- task_dependencies
- daily_plans
- daily_plan_blocks
- study_sessions
- focus_events
- skip_logs
- ai_reviews
- prompt_profiles
- prompt_versions
- plan_versions
- app_settings

Future knowledge-base tables:
- knowledge_sources
- knowledge_chunks
- chunk_embeddings
- retrieval_logs
- memory_summaries
- user_profile_facts

## AI Context Strategy
Never send all history to the model.

Use layered context:
- raw events: permanent local record
- daily summaries
- weekly summaries
- long-term user profile
- current unresolved tasks
- retrieved knowledge chunks

Every AI call should record:
- provider
- model
- prompt profile
- prompt version
- input snapshot
- output schema version
- token/cost metadata if available

## RAG Plan
Do not introduce LangChain/LlamaIndex in v1 unless needed.

Preferred path:
1. SQLite FTS5 for keyword search.
2. Add chunking and source documents.
3. Add vector search with LanceDB or sqlite-vec.
4. Add reranking if retrieval quality is poor.
5. Consider LlamaIndex.TS only when document ingestion and multi-step retrieval become complex.

RAG indexes are derived artifacts. They must be rebuildable.

## Monitoring Boundary
v1 monitoring:
- foreground app name
- window title
- focus session start/end
- app switches
- away time
- skip/postpone reasons

Do not implement:
- screenshot monitoring
- keystroke logging
- full browser history collection
- forced lockout

## Planning Rules
Daily planning should produce 10-minute blocks.

Each block should include:
- objective
- action
- expected output
- difficulty
- required material
- success check
- fallback if too hard

AI may suggest:
- split task
- defer task
- reduce difficulty
- add prerequisite
- increase practice
- switch from explanation to quiz mode

AI must not directly overwrite confirmed plans without user approval.

## Prompt Profiles
Support editable prompt profiles:
- foundation: detailed, beginner-friendly
- standard: balanced explanation and practice
- advanced: concise, assumes background knowledge
- exam: quiz-heavy and output-driven
- recovery: used after missed sessions or low completion

## References To Study
Useful open-source references:
- DeyWeaver: AI task scheduling and dynamic reallocation
- Multi-Agent-Study-Assistant: education agent role split
- ExamRAG: hybrid retrieval, concept graph, scoring
- 5ire: desktop AI assistant, provider abstraction, MCP/local KB
- Leon: personal assistant architecture with tools, memory, skills
- Graphiti: future temporal knowledge graph and long-term memory
