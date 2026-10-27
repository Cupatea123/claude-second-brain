---
type: task
status: ready
project: "[[Set Up My Brain]]"
owner: claude
priority: p2
approval: none
completed: ""
blocked_on: ""
blocked_by: []
created: 2026-10-26
updated: 2026-10-26
tags: []
---

# File my recent Claude Code sessions

## Goal
The brain starts with the history that already exists on this machine.

## Done when
- [ ] `node _claude/scripts/brain.js sweep` lists the unfiled sessions.
- [ ] `node _claude/scripts/brain.js import code-sessions` files them into `Sessions/`.
- [ ] Each imported session that names a project is linked to it, or the project is created with [[Start a Project]].
- [ ] `brain.js sweep --mark`, `brain.js lint` reports 0 errors, `brain.js hq`.

## Context
- Work sessions (under `work_roots` in the config) are skipped by design.

## Result
(filled on completion)

## Log
- 2026-10-26 — created with the vault.
