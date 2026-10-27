# Claude Second Brain

An Obsidian vault that Claude Code reads at the start of every session and writes to as work happens. Projects, areas, tasks, decisions and session notes live as plain markdown with frontmatter; a small Node engine (`_claude/scripts/brain.js`, no dependencies) lints it, builds the HQ board, picks the next task, classifies requests, searches, and files your Claude Code sessions. Three Claude Code hooks keep it current without you asking.

Pair it with [brain-command-center](https://github.com/Cupatea123/brain-command-center) for a live dashboard over the same vault.

## What you get
- **A vault layout** (PARA): `0-Inbox`, `1-Projects`, `2-Areas`, `3-Resources`, `4-Archive`, `Tasks`, `Sessions`, plus `HQ.md` (the generated board) and `TODO.md` (your live list).
- **A protocol for Claude** in `_claude/`: `START.md` (read order and rules), `Filing-Rules.md` (where everything goes, frontmatter schema), `How I Work.md` (your profile, which Claude grows from evidence), four SOPs, twelve note templates, and Bases dashboards.
- **The engine** `brain.js`: `lint`, `hq`, `status`, `pick`, `next-id`, `todo`, `classify`, `here`, `search` (BM25), `ingest`, `sweep`, `import`, `guard`, `orphans`, `scan` (secrets), `test`.
- **The `/brain` skill**: `capture | task | todo | status | decision | log | review | next | ingest | search`.
- **Hooks**: session start injects the board into every new session; every prompt and file write is logged to `_claude/activity/` (local only, gitignored).

## Install
Requirements: Claude Code, Node 18+, Git, Obsidian.

1. Click **Use this template** and create a **private** repo (it will hold your memory), then clone it where you want the vault, for example `C:\Brain` or `~/Brain`.
2. In that folder run:
   ```bash
   node setup/install.js --name "Your Name" --code-root "C:/Projects"
   ```
   It fills your name and paths into the vault, installs the `/brain` skill in `~/.claude/skills/brain`, adds the three hooks to `~/.claude/settings.json`, and adds a pointer block to `~/.claude/CLAUDE.md`. Existing settings and an existing skill are backed up first. `--dry-run` shows what it would do. Run it again if you move the vault.
3. Open the folder in Obsidian (**Open folder as vault**). For automatic commits install the community plugin **Obsidian Git**; its settings are already in `.obsidian`.
4. Start a new Claude Code session in the vault and ask: *what am I working on?* It answers from HQ without reading files. Then do `T-001`: fill in `_claude/How I Work.md`.

## Daily use
| Say | What happens |
|---|---|
| "add a task: …" | A TODO line, a Brief, and a `Tasks/T-### - …` note with a Done-when list, filed under the right project |
| "new project: …" | A project folder and note, a code folder under `code_root`, and the classifier taught its keywords |
| `/brain next` | Claude picks the next ready task it may do alone, does exactly its Done-when list, and files the result |
| `/brain log` | A session note in `Sessions/` from this session's activity |
| `/brain review` | The weekly pass: file sessions, triage the inbox, refresh tasks, update your profile, regenerate HQ |
| `/brain search …` | Search the vault before answering from it |
| Drop a PDF or article in `0-Inbox/raw/`, then `/brain ingest` | A summary note in `3-Resources/` linked to the projects it affects |

## Conventions the engine checks
- Status lives in frontmatter, never prose. `lint` enforces the schema in `Filing-Rules.md`.
- Tasks have `owner: me` (yours) or `owner: claude`; `approval: required` holds anything irreversible, costly or account-creating until you say go. They show under "Decisions and actions needed from you" in HQ.
- Wikilinks only inside the vault; every filename unique; `updated` bumped on every change.
- Secrets never enter the vault: `lint` and `scan` look for keys, tokens and account numbers. List anything Claude must never open under **Off limits** in `START.md`.

## Optional
- **The wall** (`work_roots` and `work_keywords` in `_claude/scripts/config.json`): sessions started in a work folder never see this vault, and the hooks stay silent there.
- **Scheduled tasks**: map a Claude scheduled task to an area in `scheduled_tasks`; `brain.js import runs` writes one line per run into that area's Run Log.
- **Brain-away**: a second machine writes notes into a separate repo; `/brain away` files them here after you approve the table. Off while `away_root` is empty.

## Tests
```bash
node _claude/scripts/brain.js test
```
27 tests, including one that lints the vault itself.
