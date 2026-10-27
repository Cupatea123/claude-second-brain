---
type: sop
owner: claude
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Write a Task an Agent Can Execute

## When
Work is handed to Claude or a future agent through the brain, and whenever a TODO line needs a Brief.

## Inputs
The outcome wanted, the owning project or area, what is already known in the vault.

## Steps
1. **Title** as a short imperative; id from `node {{VAULT}}\_claude\scripts\brain.js next-id T`. The file is `Tasks/T-### - <title>.md`.
2. **Goal:** one sentence saying why, not how.
3. **Done when:** two to five checkable lines an agent can verify itself. A file exists, a command prints X, a count matches, a view shows the row. Never "improve", "explore" or "look into".
4. **Context:** the folder to work in, paths, links, constraints, what NOT to do, and any fact the agent would otherwise have to rediscover.
5. **Route it**. `owner: claude` when no manual step is needed, `owner: me` when only he can do it. `approval: required` when it is irreversible, costs money, creates an account, or reverses a choice he made explicitly. `priority` p1 to p3. `status: ready` when it can start now, `backlog` when it cannot, with `blocked_on` and `blocked_by`.
6. **Size it** for one session. If it will not fit, split it and link the parts with `blocked_by`.
7. **Mirror it in TODO** when {{NAME}} asked for it out loud: the line under Open gets the owner, an indented Brief with steps to completion, systems involved, blockers already known and what {{NAME}} must supply, then the task link.
8. `brain.js lint`, commit, push.

## Output
A task `brain.js pick` can select, or one that shows up under "Decisions and actions needed from {{NAME}}" in HQ.

## Done when
The task appears in the right HQ section with no missing keys, and its Done-when list can be checked without asking {{NAME}} anything.
