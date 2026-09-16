---
name: milestone-check
description: Verify the in-progress Edward milestone against its "Done when" list, the test suite and CLAUDE.md rules
disable-model-invocation: true
allowed-tools: Bash(npm run *) Bash(npm test) Bash(npm test *) Bash(npx vitest *) Bash(npx playwright *) Bash(git diff *) Bash(git status *)
---

## Changes in this milestone

!`git status --short`

!`git diff --stat HEAD`

## Task

Verify the milestone marked `in progress` in `docs/MILESTONES.md`. Report honestly — a failing check is useful information, not something to hide.

1. Run `npm run check` and `npm test`. Run `npm run test:e2e` if this milestone touches e2e-covered behaviour or its "Done when" list mentions an e2e test.
2. Review the full diff (`git diff HEAD` plus untracked files) against CLAUDE.md:
   - Extension APIs only in `src/platform/`; model libraries only in `src/models/providers/`; vendor code only in `src/backend/llm/clients/`.
   - No logging of content: no page text, attribute values, URLs or library error messages passed to the logger or `console.*`.
   - No raw text or raw image bytes written to any storage.
   - No `any`, no new `.js` source files.
   - Every exclusion leaves a marker; failures fail closed.
   - Nothing implemented beyond this milestone's scope.
3. Go through each "Done when" item. For each, say **pass**, **fail**, or **needs manual check** (with the exact steps for me to do it, e.g. what to load in Firefox and what to look for).
4. Output a short report:
   - Commands run and results
   - Done-when table
   - Rule violations found (file:line)
   - Measurements gathered (latency etc.)
5. If something fails, propose fixes and ask before applying them. After fixes, run this check again.
