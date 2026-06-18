# Project Memory

## Current State
- Repository initialized and scaffolded as an Electron + React + TypeScript desktop app.
- `AGENTS.md` is the architecture contract; this file is the cross-chat continuity record.
- Core v1 vertical slice exists: local database schema/bootstrap, prompt profiles, DeepSeek-compatible AI client, import/planner/reflection agents, IPC bridge, tray/window shell, foreground app monitor, React workbench UI, and tests.
- Verification completed: `npm run typecheck`, `npm test`, `npm run build`, `npm audit --omit=dev`, and a short `npm run preview` smoke launch.
- Blank startup was fixed by pointing Electron preload at `out/preload/index.mjs`; automated smoke confirmed `window.studyApp` is injected and the main UI renders.

## Active Decisions
- Build a Windows-first desktop app with Electron, React, TypeScript, SQLite, and Drizzle.
- Store project continuity in this file first; Git history is auxiliary.
- Keep AI suggestions human-confirmed before they modify formal plans.
- Avoid screenshots, keystroke logging, browser history collection, and forced lockout in v1.
- Use a local Windows API PowerShell probe for foreground app monitoring instead of the vulnerable `active-win` dependency chain.

## Recent Work Log
- 2026-06-18T18:22:56.348Z [STEP] Fixed blank startup by correcting Electron preload path to index.mjs and adding visible boot error handling; smoke test confirmed main UI renders.
- 2026-06-18T18:15:15.318Z [STEP] Removed active-win, replaced foreground monitoring with Windows API PowerShell probe, upgraded drizzle-orm, and verified production audit is clean.
- 2026-06-18T18:11:59.417Z [STEP] Typecheck, tests, build, and short Electron preview smoke test completed.
- 2026-06-18T18:09:07.827Z [STEP] Implemented the React workbench UI and fixed typecheck by adding React runtime/types.
- 2026-06-18T18:04:44.056Z [STEP] Added DeepSeek-compatible AI client, agent prompts, app service, focus monitor, IPC registration, and Electron main process.
- 2026-06-18T18:01:48.340Z [STEP] Added SQLite-compatible Drizzle schema, bootstrap SQL, default prompt profiles, and StudyStore service.
- 2026-06-18T17:58:46.708Z [STEP] Scaffolded Electron/Vite/React/TypeScript configuration and installed dependencies.
- 2026-06-18T17:53:51.641Z [STEP] Created project memory, dev-log script, and AGENTS reading requirement.
- 2026-06-19 01:19: Created `AGENTS.md` with product, data, AI, RAG, and monitoring boundaries.
- 2026-06-19: Initialized Git repository.

## Open Questions
- Exact DeepSeek model name should remain configurable because provider model names change over time.
- Packaging icon and installer branding can be decided after the core app works.

## Next Steps
- Manually run `npm run dev` and exercise the UI with a real DeepSeek API key.
- Add reminder scheduling and a dedicated always-on-top reminder window.
- Improve plan confirmation and replan diff review.
- Add Playwright/Electron UI tests once the first manual workflow is stable.

## Known Risks
- Native SQLite bindings can complicate Electron packaging; prefer a local SQLite-compatible client that is easy to bundle.
- AI JSON output can be malformed; all agent outputs need schema validation and safe failure paths.
- Foreground app monitoring can fail on some Windows permissions or package versions; keep it optional and non-blocking.

## Migration Prompt
Continue development of `D:\work\study_plugin`. First read `AGENTS.md` and `docs/PROJECT_MEMORY.md`. Preserve the local-first architecture, maintain this project memory after each small development step, and keep AI plan changes human-confirmed.
