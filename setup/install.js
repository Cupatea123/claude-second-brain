#!/usr/bin/env node
/*
 * Makes this folder your second brain and wires Claude Code to it. Node 18+, no dependencies.
 *
 *   node setup/install.js --name "Alex" [--code-root "C:/Projects"] [--dry-run]
 *
 * 1. Fills {{NAME}}, {{VAULT}} and {{CODE_ROOT}} in the vault's own files (once; a second run finds none).
 * 2. Copies the /brain skill to ~/.claude/skills/brain (an existing one is backed up first).
 * 3. Adds three hooks to ~/.claude/settings.json (backed up first): session start, prompt, file write.
 * 4. Adds a short block to ~/.claude/CLAUDE.md that points every session at this vault.
 * 5. Regenerates HQ and lints the vault.
 * Run it again after moving the vault; steps 2 to 4 are idempotent.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const DRY = args.includes('--dry-run');
const NAME = opt('--name');
if (!NAME) { console.log('usage: node setup/install.js --name "Your Name" [--code-root "C:/Projects"] [--dry-run]'); process.exit(2); }

const fwd = (p) => path.resolve(p).replace(/\\/g, '/');
const VAULT = fwd(path.join(__dirname, '..'));
const CODE_ROOT = fwd(opt('--code-root', path.join(os.homedir(), 'Projects')));
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SCRIPT = `${VAULT}/_claude/scripts/brain.js`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const say = (s) => console.log((DRY ? '[dry run] ' : '') + s);
const write = (file, text) => { if (!DRY) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } };

// 1. placeholders in the vault
const SKIP = new Set(['.git', '.github', '.obsidian', 'node_modules', 'templates', 'setup', 'activity', 'import']);
let filled = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!/\.(md|json|base)$/i.test(e.name) || e.name === 'README.md' && dir === path.join(__dirname, '..')) continue;
    const s = fs.readFileSync(p, 'utf8');
    if (!/\{\{(NAME|VAULT|CODE_ROOT)\}\}/.test(s)) continue;
    write(p, s.replaceAll('{{NAME}}', NAME).replaceAll('{{VAULT}}', VAULT).replaceAll('{{CODE_ROOT}}', CODE_ROOT));
    filled++;
  }
})(path.join(__dirname, '..'));
say(`vault: filled your name and paths into ${filled} file(s) (${VAULT})`);

// 2. the /brain skill
const skillSrc = path.join(__dirname, '..', '_claude', 'skills', 'brain', 'SKILL.md');
const skillDir = path.join(CLAUDE_DIR, 'skills', 'brain');
const skillText = fs.readFileSync(skillSrc, 'utf8').replaceAll('{{NAME}}', NAME).replaceAll('{{VAULT}}', VAULT);
if (fs.existsSync(path.join(skillDir, 'SKILL.md')) && fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8') !== skillText) {
  if (!DRY) fs.renameSync(skillDir, `${skillDir}.bak-${stamp}`);
  say(`skill: backed up the existing /brain skill to ${skillDir}.bak-${stamp}`);
}
write(path.join(skillDir, 'SKILL.md'), skillText);
say(`skill: /brain installed at ${skillDir}`);

// 3. hooks
const settingsFile = path.join(CLAUDE_DIR, 'settings.json');
let settings = {};
if (fs.existsSync(settingsFile)) {
  settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''));
  if (!DRY) fs.copyFileSync(settingsFile, `${settingsFile}.bak-${stamp}`);
}
settings.hooks = settings.hooks || {};
const want = [
  ['SessionStart', null, 'session-start'],
  ['UserPromptSubmit', null, 'prompt'],
  ['PostToolUse', 'Write|Edit|MultiEdit|NotebookEdit|Bash', 'tool'],
];
for (const [event, matcher, kind] of want) {
  const list = settings.hooks[event] = settings.hooks[event] || [];
  const command = `node "${SCRIPT}" hook ${kind}`;
  // drop an older brain.js hook (a moved vault) before adding the current one
  for (const group of list) group.hooks = (group.hooks || []).filter((h) => !(/brain\.js"? hook /.test(h.command || '') && h.command !== command));
  const has = list.some((g) => (g.hooks || []).some((h) => h.command === command));
  if (!has) list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 10 }] });
  settings.hooks[event] = list.filter((g) => (g.hooks || []).length);
}
write(settingsFile, JSON.stringify(settings, null, 2) + '\n');
say(`hooks: session start, prompt and file-write hooks point at ${SCRIPT} (settings backed up)`);

// 4. global CLAUDE.md block
const globalMd = path.join(CLAUDE_DIR, 'CLAUDE.md');
const block = [
  '<!-- second-brain:start -->',
  `- ${NAME}'s second brain is the Obsidian vault \`${VAULT}\`. It is the source of truth for projects, areas, tasks,`,
  `  decisions, sessions and what has been learned. Before working on any of ${NAME}'s projects read`,
  `  \`${VAULT}/_claude/START.md\` and follow its read order. Use the \`/brain\` skill (capture | task | todo | status |`,
  '  decision | log | review | next | ingest | search) instead of ad-hoc files.',
  '- Starting work on a project: `/brain status`. Finishing: `/brain log`.',
  '- Never write secrets, tokens, account or ID numbers, or personal documents into the vault, memory, or chat.',
  '<!-- second-brain:end -->',
].join('\n');
let md = fs.existsSync(globalMd) ? fs.readFileSync(globalMd, 'utf8') : '';
md = /<!-- second-brain:start -->[\s\S]*?<!-- second-brain:end -->/.test(md)
  ? md.replace(/<!-- second-brain:start -->[\s\S]*?<!-- second-brain:end -->/, block)
  : (md.trim() ? md.trimEnd() + '\n\n' : '') + block + '\n';
write(globalMd, md);
say(`global rules: pointer to the vault in ${globalMd}`);

// 5. HQ and lint
if (!DRY) {
  for (const cmd of [['hq'], ['lint']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...cmd], { encoding: 'utf8' });
    console.log((r.stdout || r.stderr || '').trim().split('\n').pop());
  }
}
console.log(`
Next:
  1. Open ${VAULT} as a vault in Obsidian (Open folder as vault). Install the community plugin "Obsidian Git"
     if you want automatic commits; its settings are already in .obsidian/plugins/obsidian-git/data.json.
  2. Push the vault to a PRIVATE git repo of your own. Never a public one: it is your memory.
  3. Start a new Claude Code session in ${VAULT} and type: what am I working on?
     It should answer from HQ without reading files first. Then fill in _claude/How I Work.md (T-001).`);
