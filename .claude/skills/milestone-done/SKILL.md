---
name: milestone-done
description: Close the in-progress Edward milestone — update status and log, record deviations, and commit
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *) Bash(git diff *) Bash(git log *)
argument-hint: "[optional extra notes for the log]"
---

## Repo state

!`git status --short`

## Task

Close the milestone marked `in progress` in `docs/MILESTONES.md`. Extra notes from me: $ARGUMENTS

1. Confirm `/milestone-check` was run in this session after the last code change and everything passed (manual checks confirmed by me). If not, stop and tell me to run it.
2. In `docs/MILESTONES.md`:
   - Tick the "Done when" boxes and set the status to `done`.
   - Append a Log entry:
     ```
     ### <YYYY-MM-DD> — M<n> <title>
     - Summary: <2–4 lines>
     - Measurements: <numbers from the check, or "none">
     - Deviations from SPEC: <what and why, or "none">
     - Noticed (out of scope): <items, or "none">
     - Notes for next milestone: <stubs to replace, gotchas, open questions>
     ```
3. If there were deviations from the spec or new browser quirks, update `docs/SPEC.md` (quirks go in §4.3) and the "Browser quirks found" section of CLAUDE.md. If CLAUDE.md commands changed, update them.
4. Show me the diff of these doc changes.
5. Stage everything and commit with message `M<n>: <title>` and a short body listing the deliverables.
6. Tell me the milestone is closed, and that I should run `/clear` and then `/milestone next`.
