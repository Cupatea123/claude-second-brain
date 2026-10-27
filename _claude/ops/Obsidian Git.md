---
type: ops
tool: "Obsidian Git plugin and the vault repo"
source: live
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Obsidian Git

Use this when: committing or pushing `{{VAULT}}` from a session while Obsidian may be open.

## Setup
- Plugin `obsidian-git` 2.39.0, committed with the vault under `.obsidian/plugins/obsidian-git/`, settings in its `data.json`: commit, pull and push every 10 minutes while Obsidian is open, pull on boot, merge sync method, popups off. Its commits are titled `vault backup: <timestamp>`.
- Remote: a private GitHub repo. The repo's author email is the GitHub no-reply address because the account blocks pushes that expose the real email; `gh` supplies credentials through the git credential manager.
- Line endings: `.gitattributes` forces LF so the vault survives a move to a Linux box.

## Gotchas
- Two writers: the plugin and Claude both commit. Always `git pull --no-rebase` before `git push`; if `.git/index.lock` exists the plugin is mid-commit, wait 5 s and retry once.
- The plugin only runs while Obsidian is open; when it is closed, Claude's commits are the only ones, and `brain.js lint` must run first.
- Never commit `_claude/activity/` or `_claude/import/`; they are gitignored on purpose.
- Open only the vault folder as an Obsidian vault; opening a code folder as a vault creates a `.obsidian` folder inside it.

## Related
[[START]] · [[Filing-Rules]]
