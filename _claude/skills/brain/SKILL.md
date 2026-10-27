---
name: brain
description: {{NAME}}'s second brain at {{VAULT}} (Obsidian vault, PARA layout, git). Use for /brain, "add this to the brain", "add a task", "what's next", "log this", "what am I working on", project or area status, capturing ideas, tasks or decisions, the weekly review, importing claude.ai chats, ingesting articles, PDFs and transcripts dropped in 0-Inbox/raw, searching the vault ("what do I have on X", "find the note about Y"), filing Brain-away drops written on a second machine ("drops waiting", "file the drops"), and for picking up and finishing the next ready task. Modes: capture | task | todo | status | decision | log | review | sync-chats | next | ingest | search | away.
user-invocable: true
argument-hint: "capture|task|todo|status|decision|log|review|sync-chats|next|ingest|search|away [text | T-### | N | file]"
---

# /brain

VAULT = `{{VAULT}}` · SCRIPT = `node "{{VAULT}}/_claude/scripts/brain.js"` · START = `{{VAULT}}/_claude/START.md` · RULES = `{{VAULT}}/_claude/Filing-Rules.md` · PROFILE = `{{VAULT}}/_claude/How I Work.md` · TEMPLATES = `{{VAULT}}/_claude/templates/` · CONFIG = `{{VAULT}}/_claude/scripts/config.json`

**First, before anything else, every time:** run `SCRIPT guard`. If it says `work session`, reply in one line that this is a work session and the personal brain is not available here, and stop. Do not read the vault, do not name a project, do not answer from memory of it. This holds even when {{NAME}} asks directly; the folder the session started in is the decision (the wall between work and personal sessions). Every other command refuses there too, so treat a `work session` line from any of them the same way.

Then: read START, then PROFILE sections 1–8 and RULES (all short). Never open the files START forbids. Dates `YYYY-MM-DD`; session names use `YYYY-MM-DD HHmm` local time.

## Which owner, which folder (before capture, task, next, or any build work)
- `SCRIPT classify "<{{NAME}}'s words>"` → `addition` (file under that project or area, work in its `path`), `new` (follow `_claude/sops/Start a Project.md`: note, `path` under CONFIG `code_root`, git init, keywords added to CONFIG), `ambiguous` (one line: "X or Y?"), `unknown` (ask which owner only if it is real work; otherwise `0-Inbox`).
- `SCRIPT here [cwd]` → the project or area whose `path` owns the current folder. Opening a session inside an owner's folder means picking it up: read its HQ note and `next` first.
- Work in the folder a task names; else the owner's `path`; else ask in one line. Never work on a project from an unrelated folder when its `path` exists.

## Search before answering
Any question about what the vault holds ("what do I know about X", "did we decide Y", "where is the note on Z"), and before capture or ingest writes a new note: run `SCRIPT search "<key words>"` (BM25 over every note, offline; `--type resource|task|decision|…`, `--limit N`, `--json`). Read the top hits before answering, cite them as `[[Note]]`, and update an existing note rather than writing a near-duplicate. If nothing matches, say so instead of answering from memory.

## Modes

**capture `<text | url | paste>`** — Decide the type with the filing tree in RULES: doable outcome → task; fact → resource (or ops if only a tool-driving Claude cares); choice made → decision; new venture → project; happening → session; else `0-Inbox`. Write from the matching template, fill every required property (`source` on knowledge), link the owner. Reply: one line with the path.

**task `<text>`** — `Tasks/T-### - <title>.md` (id from `SCRIPT next-id T`) per `_claude/sops/Write a Task an Agent Can Execute.md`: Goal, a checkable Done-when list, Context. Defaults `owner: claude`, `approval: none`, `priority: p2`, `status: ready`; `owner: me` if it needs a manual step; `approval: required` if irreversible, costly, account-creating, or reversing an explicit choice. If {{NAME}} said "add a task", also append the line to `TODO.md` under Open (`SCRIPT todo add "<text>"`), then add the owner, the indented Brief and the task link to that line. Set the owner's `next` if empty. Reply: id, title, owner.

**todo** — `SCRIPT todo` lists open items. For each without a task link: classify, write the Brief (steps to completion, systems involved, blockers already known from the vault, what {{NAME}} must supply) as an indented bullet under the line, create the task with the `task` mode, and append `— owner: [[Owner]] → [[T-###...]]` to the line. Then `SCRIPT todo --sync` to tick items whose task is done. Reply: which items are new versus belong to an existing owner, in one line each.

**status [--write]** — `SCRIPT status` (with `--write`, also regenerates HQ). Print it, nothing else, unless asked.

**decision `<text>`** — `D-### - <title>.md` (id from `SCRIPT next-id D`) inside the owner's folder (`2-Areas/<Area>/` or `1-Projects/<Project>/`) with Decision, Why, Rejected, Consequences, Revisit when, `source: live`. `status: accepted` unless {{NAME}} says "proposed". Superseding: set the old note's status to `superseded` and link both ways. Reply: id and one line.

**log [summary]** — `Sessions/<YYYY-MM-DD HHmm> - <T-### or mode> - <title>.md` from the Session template, about THIS session: `kind: interactive` or `agent-run`, `session_id`, Request verbatim, Did (use this session's lines in `_claude/activity/<today>.jsonl` to be exact), Result with one way to verify, Decisions, Learned ({{NAME}}, System, Project; "nothing new" allowed), Next. If Learned.{{NAME}} is new, append one Evidence line to PROFILE section 9. Update the task and owner touched; `SCRIPT hq`. Reply: the path.

**review** — `_claude/sops/Weekly Review.md` in order: sync-chats; `SCRIPT sweep` and file unfiled sessions; session notes for sessions with activity but no note; digest every session with `kind: chat` and `digested: false` into tasks (with a Done-when), decisions, owner status lines and Evidence, then set `digested: true`; triage `0-Inbox`; refresh tasks; `SCRIPT import runs`; `SCRIPT lint`; promote patterns seen twice in PROFILE §9 to §1–8 (the only mode allowed to edit §1–8); write `Sessions/<date> - Weekly review.md`; `SCRIPT hq`; `SCRIPT sweep --mark`; commit `brain: review <date>`; push. Reply: five lines (shipped, stuck, learned, inbox count, top three next week).

**sync-chats** — Import new claude.ai chats through Claude in Chrome (ToolSearch `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__browser_batch`).
1. Collect known `chat_id` values from `Sessions/` and `0-Inbox/` frontmatter.
2. Open `https://claude.ai/recents`; read titles, hrefs (`/chat/<id>`, `/cowork/<id>`) and dates. Never open a title matching CONFIG `skip_titles`, `skip_keywords` or `work_keywords`.
3. For each new project-related or idea chat: open it, click "Load earlier messages" until it disappears, `get_page_text`, write `_claude/import/chat-<id>.json` shaped `{ "title", "chat_id", "chat_date", "source": "claude.ai", "messages": [ { "role": "user|assistant", "date", "text" } ] }` with {{NAME}}'s messages verbatim and Claude's replies condensed (≤ 400 characters each), then `SCRIPT import chat-json <file>`.
4. Close the tab. If Chrome or the login is unavailable, say so in one line and stop. Report counts; add CONFIG rules for unclassified titles and re-run, or list them for {{NAME}}.
Without a browser: {{NAME}}'s export (`claude.ai → Settings → Privacy → Export data`) saved as `_claude/import/claude-export.zip`, then `SCRIPT import claude-export {{VAULT}}/_claude/import/claude-export.zip`. Local stores: `SCRIPT import cowork`, `SCRIPT import code-sessions`, `SCRIPT import runs`.

**next [N | T-###]** — The dispatch loop:
1. **Resume before starting.** If any task is `status: in-progress` (the status block and HQ list them), that session was interrupted: read its Log and Result, say in one line what was already done, and finish that task instead of picking a new one. Only if none is in progress, `SCRIPT pick` → a path or `none` (say so and stop). An explicit `T-###` is used even if `approval: required` or `status: backlog`: the explicit id is {{NAME}}'s go. With `N`, repeat up to N times.
2. Read the task, its owner note and decisions, PROFILE §1–8, RULES.
3. `status: in-progress`, bump `updated`, Log line; commit `brain: start T-###`.
4. Do exactly the Done-when items, in the task's named folder, else the owner's `path` (`cd` there first). Do not widen scope; Context's forbidden list is forbidden.
5. If it needs {{NAME}}: `status: blocked`, `blocked_on: "<one line>"`, a session note with `outcome: blocked`, commit, stop with one line naming what is needed.
6. On completion: tick the Done-when boxes, fill Result, `status: done`, `completed`, bump `updated`; owner Log line and `next`; session note (`outcome: done` or `partial`); Evidence line if learned; `SCRIPT todo --sync`; `SCRIPT lint` must report 0 errors (fix, or revert your writes); `SCRIPT hq`; commit `brain: done T-### - <title>`; `git pull --no-rebase`; `git push`.
7. Stop when: no candidates, a task blocked, lint fails twice, or push fails (leave the commit, report).
8. Reply in ≤ 6 lines: task, what exists now, how to verify, what is next.

**ingest [file]** — Sources {{NAME}} drops in `{{VAULT}}\0-Inbox\raw\` (articles .md/.html/.txt, PDFs, transcripts .vtt/.srt/.txt) become one source-summary note each in `3-Resources/`. A URL or pasted text instead of a file: save it into `0-Inbox\raw\` first (a page via defuddle or `get_page_text`, with its URL on the first line), then ingest it.
1. `SCRIPT ingest` lists what is waiting: suggested title, owners (projects and areas the classifier matched), related notes, and whether the same bytes were already ingested.
2. Per file: `SCRIPT ingest new "<file>" "<title>"` writes `3-Resources/<title>.md` (type `resource`, tag `source`, `source` = the URL or `file:…`, `source_file`, `source_hash`, `ingested`, `project` if an owner matched), with How it applies and Related pre-linked, and moves the raw file to `raw/processed/`. Same sha256 as an existing note → it says so and writes nothing.
3. Read the raw file (`SCRIPT ingest text "<file>"` for extracted text; read PDFs directly if extraction is empty). Fill Use this when, Summary (three to six sentences in {{NAME}}'s terms), Key points, and How it applies (one line per owner: what it changes for that project or area). Fix the owner and related links if the guess was wrong (`SCRIPT search` to find better ones). Short quotes only; never copy secrets from a source. Delete the `<!-- ingest:todo -->` marker.
4. Link the new note from each owner it applies to (a line under the owner's Related or Status) so it is not an orphan; if it implies work, propose a task.
5. `SCRIPT lint` (warns on unfilled skeletons and orphans), commit `brain: ingest <title>`, push. Reply: one line per source with its path and owners.

**search `<query>`** — `SCRIPT search "<query>"`; print the hits, then answer from the notes they point to.

**away** — Optional. File drops written on a second machine into a separate git repo (Brain-away), cloned at CONFIG `away_root`; off while `away_root` is empty. Each drop is a note the laptop already placed: frontmatter `target` (path in this vault), `action` (`create | append | update | todo-done | session`), optional `section`, `brain_ref` (the vault commit it read), `created`. Verify and apply; don't re-plan.
**Home never writes to Brain-away:** the clone only pulls (push disabled, git hooks refuse commits); never edit, move, commit or push anything in `the Brain-away clone`. What is filed is tracked here, in `_claude/ops/Brain-away Ledger.md`.
1. `SCRIPT away` pulls the clone and lists pending drops, oldest first (new ones, and ones marked CHANGED since they were filed). Never read `hold/`, `ingested/` or `jobs/`.
2. Per drop: read it and its target here. `git -C {{VAULT}} log --oneline <brain_ref>..HEAD -- "<target>"`: if the target changed since, merge by hand into the current note, never overwrite. Target gone or renamed: find it (`SCRIPT search`, `SCRIPT here`) and re-route. `T-NEW` / `D-NEW` get `SCRIPT next-id`; fix every link that used the placeholder. **Skip** (with a reason) anything with work material, a secret, or a personal document (résumé, passport, bank or tax papers), anything `lint` would refuse, and drops whose content is already in the vault.
3. Show one table (drop → target → action → merge / re-route / renumber / skip) and ask: "File these N drops? (yes / yes except … / no)". Write nothing until {{NAME}} answers.
4. Apply the approved ones: `create` writes the note; `append` adds the body at the end or under `section`; `update` changes the named keys or section; `todo-done` ticks and dates the TODO line; `session` writes the session note. Strip drop-only keys (`target`, `action`, `section`, `brain_ref`, `drive`, `status: pending`) so the result has this vault's frontmatter for its type; keep `drive:` links in the body. Bump `updated`. New projects follow `_claude/sops/Start a Project.md` (keywords into CONFIG).
5. `SCRIPT lint` (0 errors), `SCRIPT hq`, `SCRIPT todo --sync`; commit `brain: ingest N Brain-away drops (<first>..<last>)`, pull, push.
6. Each filed drop: `SCRIPT away done "<drop path as listed>" <that commit sha>`; each skipped one: `SCRIPT away skip "<drop path as listed>" "<reason>"`. Both only append a line to the ledger in this vault; commit it (`brain: Brain-away ledger`) and push this vault.
7. Reply: the table of what was filed where, merged, re-routed or skipped, and the commit sha. Stopping partway is safe; what is left stays pending.

## Rules
- Filenames: strip `: * ? " < > | / \` and apostrophes; keep the real title in the H1 and in `aliases`. Filenames are unique across the vault.
- YAML: wikilinks double-quoted (`project: "[[Health]]"`), Windows paths single-quoted (`path: 'C:\Projects\Blog'`), dates bare, `source` on every knowledge note.
- Secrets: `lint` scans; refuse to write anything it would flag and say so in one line. Never store a chat on the skip lists. Work material never enters the vault.
- Never touch anything START lists as off limits unless a task says so.
- Every write ends with `git -C "{{VAULT}}" add -A && git -C "{{VAULT}}" commit -m "brain: <mode> <id or title>"`, then `git -C "{{VAULT}}" pull --no-rebase && git -C "{{VAULT}}" push`. If `.git/index.lock` exists (Obsidian Git mid-commit), wait 5 s and retry once. If the push fails, leave the commit and say so.
- Terse output; answer first, walkthrough second; no menus, no questionnaires; at most one question, otherwise best guess recorded in the note.
