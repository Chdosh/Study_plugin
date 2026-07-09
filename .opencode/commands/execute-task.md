---
description: Execute the current task from .agent/TASK.md. Use for rework rounds or standalone execution.
agent: executor
---

# /execute-task

Execute the task defined in `.agent/TASK.md`: $ARGUMENTS

## Steps

1. Read `AGENTS.md`.
2. Read `.agent/TASK.md`.
3. If `.agent/REVIEW.md` exists, read it for rework feedback.
4. Implement changes within Allowed Scope.
5. Run all Validation Commands from TASK.md.
6. Write `.agent/DELIVERY.md` with completed work, changed files, commands run and results, unresolved issues, risks, and acceptance criteria check.
7. Do NOT commit or push.
