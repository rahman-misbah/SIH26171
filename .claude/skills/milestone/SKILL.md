---
name: milestone
description: Start (or resume) an Edward build milestone from docs/MILESTONES.md and produce a plan for approval
disable-model-invocation: true
argument-hint: "[next | M<number>]"
allowed-tools: Bash(git status *) Bash(git log *)
---

## Repo state

!`git status --short`

!`git log --oneline -5`

## Task

Start milestone: **$ARGUMENTS** (if empty or `next`, use the first milestone in `docs/MILESTONES.md` whose status is `in progress`, otherwise the first `todo`).

1. Read `docs/MILESTONES.md` in full, including the Log (especially the latest "Notes for next milestone").
2. Check preconditions:
   - Every earlier milestone is `done` or `cut`. If not, stop and tell me which one is unfinished.
   - The working tree is clean, or the changes belong to this milestone. If not, stop and ask.
3. Read every spec section the milestone cites in `docs/SPEC.md`, and CLAUDE.md.
4. Present a plan (you are normally in plan mode here, so don't edit anything yet):
   - Files to create/change, grouped by deliverable, each with the spec section it implements.
   - Which parts are tests-first, and what those tests assert.
   - Anything needed from a later milestone and how it will be stubbed.
   - Risks and the browser/library facts you will verify before relying on them.
   - Ambiguities or spec conflicts, as numbered questions. Do not guess answers.
   - Step 1 of the plan is always: set this milestone's status to `in progress` in `docs/MILESTONES.md`.
5. Stop and wait for my approval. Do not write code yet.

## Scope rules while building this milestone

- Work only on this milestone's deliverables. If you notice something outside scope, add it to a "Noticed" list and tell me at the end — don't fix it.
- Follow CLAUDE.md non-negotiables and boundaries. If a browser or library limitation conflicts with a privacy guarantee, stop and ask.
- When finished, tell me to run `/milestone-check`. Do not mark the milestone done yourself.
