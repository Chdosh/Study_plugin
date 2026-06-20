# Execution Report

<!-- The executor fills this out after completing a task. -->

## Task ID

<!-- Must match TASK.md. -->

## Result

<!-- One of: SUCCESS | PARTIAL | FAILED | BLOCKED -->

## Summary

<!-- Brief description of what was done and why. -->

## Started At

<!-- ISO 8601 timestamp when execution began. -->

## Finished At

<!-- ISO 8601 timestamp when execution ended. -->

## Pre-execution Git Status

<!-- Paste the content of .agent/evidence/<Task-ID>/pre-status.txt here. -->

## Pre-existing Changes

<!-- List files that were already modified/added/deleted BEFORE this task started. -->
<!-- These are NOT changes produced by this task. -->

| Status | File | Note |
|--------|------|------|

## Untracked Files Before

<!-- Paste the content of .agent/evidence/<Task-ID>/pre-untracked.txt here. -->

## Untracked Files After

<!-- Paste the content of .agent/evidence/<Task-ID>/post-untracked.txt here. -->

## Changed Files

### Protocol Files Changed

<!-- Files under .agent/ and .opencode/ that were created or modified by this task. -->

| Status | File | Reason |
|--------|------|--------|

### Business Files Changed

<!-- Files outside .agent/ and .opencode/ that were modified by this task. -->
<!-- Write "None" if no business files were changed. -->

| Status | File | Reason |
|--------|------|--------|

## Exact Commands

<!-- Every command executed, with exact exit code and log file reference. -->

| Command | Exit Code | Log File | Notes |
|---------|-----------|----------|-------|

## Evidence Directory

<!-- Path to the evidence directory for this task. -->

## Diff Name Status

<!-- Paste the output of `git diff --name-status` here. -->
<!-- If no diff, write "No staged or unstaged changes to tracked files." -->

## Diff Summary

<!-- Paste the output of `git diff --stat` here. -->
<!-- For untracked files, reference post-untracked.txt instead. -->

## Tests

<!-- Which tests were run and their results. Must include raw output summary. -->

| Test | Result | Exit Code | Output Summary |
|------|--------|-----------|----------------|

## Known Issues

<!-- Any issues discovered but not resolved in this task. -->
<!-- Write "None" if there are no known issues. -->

## Risks

<!-- Potential risks introduced by this change. -->
<!-- Write "None" if there are no risks. -->

## Review Focus

<!-- Suggest what the reviewer should pay attention to. -->
