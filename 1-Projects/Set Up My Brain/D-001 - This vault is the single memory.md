---
type: decision
status: accepted
project: "[[Set Up My Brain]]"
created: 2026-10-26
updated: 2026-10-26
tags: []
source: live
---

# This vault is the single memory

## Decision
Every project, area, task, decision and session lives in this vault as plain markdown with frontmatter. Claude's auto-memory only points here.

## Why
One place that both you and every Claude session read means nothing is decided twice and no session starts from zero.

## Rejected
Separate notes per tool; Claude's auto-memory as the store (invisible to you and to other tools).

## Consequences
Status lives in frontmatter, which is why [[Filing-Rules]] insists on it and `brain.js lint` checks it.

## Revisit when
The vault stops being the first thing sessions read.
