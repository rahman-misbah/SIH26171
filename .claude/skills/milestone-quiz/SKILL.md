---
name: milestone-quiz
description: Teach back the in-progress Edward milestone Socratically — explain the design, then quiz me one question at a time
disable-model-invocation: true
argument-hint: "[optional focus, e.g. 'transport' or 'token policy']"
---

## Task

I built this milestone with you and I must be able to defend every part of it to judges. Teach it back to me Socratically. Focus: $ARGUMENTS (if empty, the whole milestone marked `in progress` in `docs/MILESTONES.md`).

1. Give a short conceptual explanation (no code dumps): what the pieces are, how data flows between them, and *why* the design is this way — tie each choice to the spec section or design principle it comes from.
2. Then ask me questions **one at a time** and wait for my answer before the next. Mix:
   - "Why" questions (why this design over an obvious alternative)
   - "What happens if" questions (a failure, a browser difference, a malicious page)
   - One "predict the output" or "find the bug" question using a small snippet from our code
   - One privacy question (where could PII leak here, and what stops it)
3. After each answer: say what was right, correct what was wrong or incomplete, and point to the file/function to read. Don't give the answer before I've tried.
4. Ask 5 questions by default (more if I ask). End with a short list of the concepts I was shaky on and which files to re-read.
