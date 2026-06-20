# /execute-task

**Agent**: executor

Execute the task defined in `.agent/TASK.md` following the standard workflow with full evidence capture.

## Steps

### 1. Read AGENTS.md

Read `AGENTS.md` and internalize project conventions, architecture rules, Git baseline rules, and evidence requirements.

### 2. Read TASK.md

Read `.agent/TASK.md`. Parse Task ID, Objective, Allowed Scope, Forbidden Scope, Requirements, Acceptance Criteria, Required Tests.

### 3. Read REVIEW.md

Read `.agent/REVIEW.md`. If this is a revision (revision > 0), incorporate Required Changes from the review.

### 4. Check STATUS.json

Read `.agent/STATUS.json`.

- If `needsHumanDecision` is `true`, STOP. Inform the user that a human decision is required.
- If `taskId` is `null`, STOP. No task has been assigned.

### 5. Save Pre-execution Baseline

Create the evidence directory: `.agent/evidence/<Task-ID>/`

Save the pre-execution git baseline:
```
git status --short --untracked-files=all > .agent/evidence/<Task-ID>/pre-status.txt
git ls-files --others --exclude-standard > .agent/evidence/<Task-ID>/pre-untracked.txt
```

Record the execution start time in the evidence manifest.

### 6. Implement Changes

Modify code strictly within the Allowed Scope defined in TASK.md. Follow all rules from AGENTS.md. Do NOT touch Forbidden Scope files. Do NOT overwrite pre-existing changes.

### 7. Run Required Tests

Execute every test listed in TASK.md Required Tests. For each command:

1. Save full stdout and stderr to `.agent/evidence/<Task-ID>/<command-name>.log`
2. Save the exit code to `.agent/evidence/<Task-ID>/<command-name>.exitcode`
3. Append the command, exit code, and log file path to `.agent/evidence/<Task-ID>/commands.md`
4. If exit code is not 0, mark the command as FAILED in commands.md. NEVER report it as passed.

### 8. Save Post-execution State

```
git status --short --untracked-files=all > .agent/evidence/<Task-ID>/post-status.txt
git ls-files --others --exclude-standard > .agent/evidence/<Task-ID>/post-untracked.txt
git diff --name-status > .agent/evidence/<Task-ID>/diff-name-status.txt
git diff --stat > .agent/evidence/<Task-ID>/diff-stat.txt
```

### 9. Write Evidence Manifest

Write `.agent/evidence/<Task-ID>/evidence-manifest.json`:
```json
{
  "taskId": "<Task-ID>",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp>",
  "workingDirectory": "<absolute path>",
  "commands": [
    {
      "command": "<exact command>",
      "exitCode": 0,
      "logFile": "<relative path to .log>"
    }
  ],
  "evidenceFiles": ["<list of all files in evidence dir>"],
  "executor": "executor"
}
```

### 10. Update REPORT.md

Fill in ALL sections of `.agent/REPORT.md`, including:
- Task ID, Result, Summary
- Started At, Finished At
- Pre-execution Git Status, Pre-existing Changes, Untracked Files Before, Untracked Files After
- Changed Files (protocol files and business files separately)
- Exact Commands with exit codes
- Evidence Directory path
- Diff Name Status, Diff Summary
- Tests, Known Issues, Risks, Review Focus

### 11. Update STATUS.json

Update `.agent/STATUS.json`:
- Set `phase` to `waiting_review`
- Increment `revision` by 1
- Set `updatedBy` to `executor`
- Keep `needsHumanDecision` as `false` unless a conflict was found

### 12. Stop

Do NOT commit. Do NOT push. The task is now ready for human review.
