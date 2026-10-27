---
type: sop
owner: claude
created: 2026-09-16
updated: 2026-10-26
tags: []
---

# Start a Project

## When
`node {{VAULT}}\_claude\scripts\brain.js classify "<what {{NAME}} said>"` says `new`, or {{NAME}} says "new project: …", or a venture appears that no project or area note covers.

## Inputs
{{NAME}}'s description in their words; any assets on disk or in chats; the classifier's output.

## Steps
1. **Confirm it is new.** If `classify` says `ambiguous`, ask one line: "new project, or part of X?". If it says `addition`, stop; file the work under that owner instead.
2. **Project or area?** A project has an end state, a deliverable, a launch or a decision, and goes in `1-Projects/<Name>/`. A recurring responsibility with no end date goes in `2-Areas/<Name>/`, needs a `cadence`, and needs a `<Name> Run Log.md` if anything runs on a schedule.
3. **Create the note** from `_claude/templates/Project.md` or `Area.md`, named exactly like its folder. Filename without apostrophes; the real name in `aliases`.
4. **Set `path`.** Default `<code_root>\<Name>`, the `code_root` in `_claude/scripts/config.json`; use an existing folder if one exists or {{NAME}} names one. Create the folder and `git init -b main` unless it already is a repo. Never point `path` at a Drive-synced folder.
5. **Fill it in.** Goal in one sentence in {{NAME}}'s words; Status now as dated facts only; Assets as paths and links, nothing moved; `status`, which stays `idea` until there is a concrete outcome; `priority`; and one line of `next`.
6. **Tasks.** At most three, each with a Done-when list; none at all if the project is still an idea.
7. **Teach the classifier.** Add the name, aliases and a few keywords to `projects` in `_claude/scripts/config.json`.
8. `brain.js lint`, `brain.js hq`, commit `brain: project <Name>`, push. Reply: name, path, next.

## Output
A note that appears in HQ and in `Projects.base`, a folder sessions open, and a classifier that recognises the name.

## Done when
`brain.js here <path>` prints the new owner and `brain.js classify "<its name>"` says `addition`.
