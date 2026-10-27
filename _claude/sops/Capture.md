---
type: sop
owner: claude
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Capture

## When
{{NAME}} pastes or says something worth keeping: an idea, a fact, a link, a decision, a task, a new venture. Also `/brain capture <text>`.

## Inputs
The text, link or paste; the folder the session is in; `brain.js classify` and `brain.js here`.

## Steps
1. Find the owner: `node {{VAULT}}\_claude\scripts\brain.js classify "<text>"`. `addition` names the project or area; `new` means follow [[Start a Project]]; `ambiguous` means ask one line; `unknown` means ask which owner only if this is real work.
2. Decide the type with the filing tree in [[Filing-Rules]]: doable outcome → task; fact → resource (or an ops note if only a tool-driving Claude would care); choice made → decision, in the owner's folder; new venture → project; something that happened → session; anything else → `0-Inbox/`.
3. Copy the matching template from `_claude/templates/`, fill every required key including `source`, keep {{NAME}}'s words verbatim in the body, link the owner with `project: "[[Owner]]"`.
4. Name the file per [[Filing-Rules]]; ids from `brain.js next-id T` or `next-id D`.
5. `brain.js lint`, then commit `brain: capture <title>` and push.

## Output
One note, and a one-line reply with its path.

## Done when
The note lints clean, sits in the right folder, and is pushed.
