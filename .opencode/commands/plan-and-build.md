---
description: Plan a task, execute it, and review the result. Full plan→execute→review cycle.
agent: planner
---

# /plan-and-build

Run the complete plan → execute → review cycle for: $ARGUMENTS

## Steps

1. Read `AGENTS.md` and `docs/PROJECT_MEMORY.md`.
2. Inspect code related to the user's request.
3. Write `.agent/TASK.md` with a concrete plan (objective, scope, requirements, acceptance criteria, validation commands).
4. Use the `task` tool to launch a `general` subagent that:
   - Reads `AGENTS.md` and `.agent/TASK.md`
   - Implements the changes within Allowed Scope
   - Runs validation commands
   - Writes `.agent/DELIVERY.md`
5. Read `.agent/DELIVERY.md` and review against TASK.md acceptance criteria.
6. Report the verdict to the user: PASS, REWORK (with specific gaps), or BLOCKED (with reason).
7. If REWORK: update TASK.md with rework goals, re-launch the executor, and review again (max 2 rework rounds).
8. Do NOT commit or push.
