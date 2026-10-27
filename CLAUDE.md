# {{VAULT}} — gate for any Claude session opened here

This vault is {{NAME}}'s second brain: the single source for projects, areas, tasks, decisions, knowledge and sessions.

Before anything else, read and follow `_claude/START.md`. It gives the read order (TODO, HQ, How I Work, Filing-Rules, the owning project or area), the write rules, and the tools.

Hard rules that hold in every session, with or without START:
- Never write secrets, tokens, account or ID numbers, or personal documents into this vault. Never open the files START lists as off limits. Run `node _claude/scripts/brain.js lint` before every commit; it includes a secrets scan.
- Status lives in frontmatter, not prose. Wikilinks only inside the vault. Bump `updated` on every change. Commit after every write and push.
- Work material never enters this vault; the hooks are silent under the work roots listed in `_claude/scripts/config.json`.
