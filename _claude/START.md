---
type: protocol
created: 2026-10-26
updated: 2026-10-26
tags: []
---

# START — read this first in every session that touches {{NAME}}'s projects

You are working for {{NAME}}. This vault is the single memory for their own projects; Claude's auto-memory only points here. Work sessions never load it: the hooks stay silent under the work roots in `_claude/scripts/config.json`.

## Read now, in this order
1. [[TODO]] — the live list. For every open item without a task link, write its Brief and create the task (`/brain todo`). In your first reply, say which open items are new and which belong to an existing project or area.
2. [[HQ]] — the current state of every project and area. If its `Updated:` line is more than 14 days old, say so and offer to regenerate it (`brain.js hq`) before starting.
3. [[How I Work]] sections 1–8 — how to handle tasks and how to report back.
4. [[Filing-Rules]] — where things go, naming, frontmatter, write rules, hard limits.
5. If the task names or implies a project or area: its HQ note, its `D-###` decisions in the same folder, and its Run Log if it has one. `node _claude/scripts/brain.js here <cwd>` tells you which one owns the folder you are in; `brain.js classify "<the ask>"` says addition, new, ambiguous or unknown.
6. Sweep: `brain.js sweep` lists Claude Code sessions on this machine not yet filed in `Sessions/`. Offer to file them (`brain.js import code-sessions`) and mark the baseline afterwards.

## Off limits
Never open these, even when asked; say so in one line instead. Add your own paths.
- Any `.env`, `.env.*`, `.credentials.json`, or folder named `secrets`.
- (add: password exports, bank, tax and ID documents, anything you never want an AI to read)

## The procedures
Four, in `_claude/sops/`. Read the one that matches before doing that kind of work, not after.

| When | Read |
|---|---|
| {{NAME}} says something worth keeping | [[Capture]] |
| A new venture appears, or `classify` says `new` | [[Start a Project]] |
| Work is being handed to Claude or an agent | [[Write a Task an Agent Can Execute]] |
| The weekly pass, or `/brain review` | [[Weekly Review]] |

## Before you touch a tool, read its ops note
| Before | Read |
|---|---|
| Committing or pushing this vault while Obsidian is open | [[Obsidian Git]] |

Add a row and an ops note in `_claude/ops/` for every tool that has a quirk worth remembering.

## Handling a task
- **Find the owner with the classifier** (no label in the reply); ask one line only when it says ambiguous.
- **Clear item:** assume the most likely reading from the vault, state the assumption in one line, proceed.
- **New or reopened item:** restate the current state from the vault first, then at most one question per turn, multiple choice where possible.
- **Anything irreversible, costly, account-creating, or reversing an explicit choice of {{NAME}}'s:** confirm first (`approval: required` on the task).
- Work in the folder the task names, else the project's `path`, never from an unrelated folder.

## Write as things happen
Follow the write-rules table in [[Filing-Rules]]. The hooks already record every prompt and file write to `_claude/activity/` (local only); `/brain log` turns a session into a note in `Sessions/` before you finish. Decisions get a `D-###` note in the owner's folder the moment they are made. Blockers and status changes go into the owner's HQ note and `next` the moment they happen, then `brain.js hq`.

## Tools
`node _claude/scripts/brain.js` — `lint` (schema, links, placement, secrets, orphans), `search "<query>"` (BM25 over every note; run it before answering anything from the vault), `ingest [new <file>]` (sources dropped in `0-Inbox/raw/` → summary notes in `3-Resources/`), `orphans`, `scan`, `next-id T|D`, `pick`, `status`, `hq`, `todo [add …|--sync]`, `classify`, `here`, `sweep [--mark]`, `import …`, `away [pending|done|push]` (optional second-machine drops), `test`. Run `lint` after every batch of writes and fix failures before reporting done.

## Never
- Never write project facts to Claude's auto-memory directory; the vault is the single source.
- Never put a password, token, key, account number or credentialed connection string in this vault.
- Never work from stale memory if this vault is unreachable; say so and stop.
- Never widen a task's scope.
