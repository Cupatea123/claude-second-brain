---
type: sop
owner: claude
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Weekly Review

## When
Once a week (Sunday evening or Monday morning), or `/brain review` at any time.

## Inputs
`Tasks/`, the project and area notes, `TODO.md`, `0-Inbox/`, `Sessions/`, `_claude/activity/` for the week, [[How I Work]].

## Steps
1. **Collect what happened.** `brain.js sweep` lists sessions on this machine not yet filed. `brain.js import code-sessions` and `import cowork` file them; `/brain sync-chats` pulls new claude.ai chats; `brain.js import runs` appends scheduled runs to the owning area's Run Log.
2. **Write the missing session notes.** For every session in `_claude/activity/` this week with no note in `Sessions/`, write one from the activity lines, `outcome: partial` if unclear.
3. **Digest.** For every session with `kind: chat` and `digested: false`: extract tasks, each with a Done-when list, plus decisions, owner status lines and profile evidence; then set `digested: true`.
4. **Triage the Inbox.** Each note becomes a task, a resource, a project, part of an existing note, or is dropped; set `status: triaged`.
5. **Refresh the work.** Close what is done, unblock what {{NAME}} answered, drop what is dead, bump `updated`. `brain.js todo --sync` ticks TODO lines whose task finished; write Briefs for any new TODO lines.
6. **Check the vault.** `brain.js lint`, fixing warnings about stale `updated` fields, then `brain.js scan`.
7. **Learn.** Promote to [[How I Work]] sections 1 to 8 any pattern that appears twice or more in section 9. This is the only time those sections change.
8. **Publish.** Write `Sessions/<date> - Weekly review.md` from the Review template. `brain.js hq`. `brain.js sweep --mark`. Commit `brain: review <date>` and push.

## Output
The review note, a clean board, an updated profile, a regenerated HQ, and five lines to {{NAME}}: shipped, stuck, learned, inbox count, top three for next week.

## Done when
Lint and scan are clean, no chat session is undigested, the Inbox has no `new` notes, and HQ's Updated line is today.
