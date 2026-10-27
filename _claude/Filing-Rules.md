---
type: protocol
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Filing Rules

## Where things go (ask in this order; never stall on filing)
1. A rule about how Claude talks to {{NAME}} or how {{NAME}} works → [[How I Work]] (section 9 for evidence; sections 1–8 only in review).
2. Would only Claude, driving a tool, care? → `_claude/ops/<Tool>.md` (type `ops`).
3. Has an end state (a deliverable, a launch, a decision)? → `1-Projects/<Name>/` (type `project`).
4. A recurring responsibility with no end date (a training plan, a weekly report, upkeep of something already built)? → `2-Areas/<Name>/` (type `area`).
5. Knowledge {{NAME}} would want even without a project → `3-Resources/` (type `resource`); knowledge tied to one owner → that owner's folder.
6. A unit of work an agent or {{NAME}} must do → `Tasks/T-### - <title>.md` (type `task`, with a Done-when list).
7. A choice that was made → `D-### - <title>.md` inside the owner's folder (type `decision`).
8. Something that happened (a session, an agent run, an imported chat, a review) → `Sessions/` (type `session` or `review`).
9. Finished or retired → move the whole folder to `4-Archive/`, set `status: archived`.
10. Still unclear → a note in `0-Inbox/` (type `inbox`). The weekly review triages it.

Project or area: a project has an end state you can name (so `done` will one day be true) and carries a `priority` and a `## Done when` section; an area is a responsibility with a cadence and no finish line, and carries a Run Log. Permanence and importance are not the test. A project folder exists only when there is more than one session or an open next step; a single finished piece of work stays a session note. A scheduled routine's run is not a session: it is one line in the owner's `<Name> Run Log.md`.

## Naming
- Every filename is unique across the vault; links are `[[Note Name]]` with no path.
- A project or area's HQ note is named exactly like its folder. Decisions `D-### - Title`, tasks `T-### - Title`, run logs `<Name> Run Log`.
- Sessions: `YYYY-MM-DD HHmm - <T-### or mode> - <title>` for runs, `YYYY-MM-DD - <title>` for imported chats, `YYYY-MM-DD - Weekly review` for reviews.
- Titles never contain `: * ? " < > | / \`; apostrophes are dropped in filenames (`Whats Next`) and kept in `aliases`.
- New project folders on disk: `<code_root>\<Name>` unless {{NAME}} names another; recorded in the note's `path`.

## Frontmatter (the linter enforces this; lists in flow syntax `[a, b]` or block lists)
| type | required keys | allowed status |
|---|---|---|
| project | type, created, updated, status, next, path | idea, active, blocked, waiting, paused, done, archived |
| area | type, created, updated, status, cadence, next | active, paused, archived |
| task | type, created, updated, status, project, owner, priority, approval | backlog, ready, in-progress, blocked, review, done, dropped |
| decision | type, created, updated, status, source | proposed, accepted, superseded |
| resource | type, created, updated, source | |
| ops | type, created, updated, tool, source | |
| session | type, created, updated, source, kind (interactive, agent-run, chat) | outcome: done, partial, blocked, failed, n/a |
| review, protocol, agent, sop, runlog, inbox, todo, hq | type, created, updated | inbox: new, triaged |
| spec, plan | type, created, updated, status, source | spec: draft, approved, superseded · plan: ready, in-progress, done, superseded |

Common optional keys: `project: "[[Owner]]"` (double-quoted), `owner` (me, claude), `priority` (p1–p3), `approval` (none, required), `aliases`, `tags`, `path` (single-quoted Windows path), `repo`. Task extras: `completed`, `blocked_on`, `blocked_by`. Session extras: `session_id` or `chat_id`, `agent`, `task`, `outcome`, `duration_min`, `messages`, `digested`. Ingested-source extras (resource): `source_file`, `source_hash` (sha256 of the raw file; ingest refuses a second copy), `ingested`.

`source` is provenance: `live`, `memory:<slug>`, `session:<id>`, `claude.ai`, `cowork`, `claude-code`, `file:<path>`, or `pasted`.

## Write rules (apply as things happen)
| Event | Write |
|---|---|
| Work on something begins | Know the owner (`classify`, `here`); read its HQ note; if it is a task, set `status: in-progress` and commit |
| A chunk of work concludes | Update the task's Result and Log; update the owner's Status now and `next` |
| A decision is made | `D-###` note in the owner's folder; link it from the session note; `brain.js hq` if status changed |
| A blocker, unblock or status change | The owner's HQ note frontmatter and `next`; the task's `status` and `blocked_on` |
| Something needs {{NAME}} | Task with `owner: me` or `approval: required`; it appears under "Decisions and actions needed from {{NAME}}" |
| A fact about a system or domain is learned | Resource note, or the owner's folder if it is specific to one |
| An article, PDF or transcript is worth keeping | Drop it in `0-Inbox/raw/`, then `/brain ingest`: one resource note in `3-Resources/` tagged `source`, linked from each owner it applies to; the raw file stays local (gitignored) |
| A tool quirk is learned | Ops note |
| A fact about how {{NAME}} works | Evidence line in How I Work section 9, with quote, date and source |
| The vault contradicts reality | Fix the vault; record the correction in the session note |
| A scheduled routine runs | One line in the owner's Run Log (`brain.js import runs` does this from the transcripts) |
| {{NAME}} says "add a task: …" | Append to TODO under Open with today's date; write the Brief; create the task; link it |
| A task is finished | Tick the TODO line, date it, move it under Done (`brain.js todo --sync`); task `status: done`, `completed` |
| Filing is unclear | A note in `0-Inbox/` |
| {{NAME}} pastes a summary from a surface with no local transcript and says "file this" | A session note with `source: pasted` |

## Hard limits
- Secrets never enter the vault. Replace with a pointer to where they live (a password-manager entry name, never the value). `lint` scans every note; `scan` scans everything else.
- A note over about 400 lines is split; the owner note keeps the summary.
- Frontmatter status is the truth; prose explains it.
- After any batch of writes: `node {{VAULT}}\_claude\scripts\brain.js lint`, fix, then commit and push. Obsidian Git also commits every 10 minutes while Obsidian is open; if `.git/index.lock` exists, wait 5 s and retry once.
- Templates and dashboards change only when the task is about them.
