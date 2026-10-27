#!/usr/bin/env node
/*
 * brain.js — engine of the second brain. Node 18+, no dependencies.
 *
 *   lint                     frontmatter, ids, links, placement, secrets; exit 1 on errors
 *   scan [path]              secrets scan only (vault or a path); exit 1 on hits
 *   next-id T|D              next task / decision id
 *   pick                     next task Claude may execute, or "none"
 *   status                   one-screen status
 *   hq                       rewrite the generated section of HQ.md (alias: status --write)
 *   todo [add <text>|--sync] report TODO.md items lacking a task, add an item, or tick items whose task is done
 *   classify <text>          addition | new | ambiguous | unknown, with candidates
 *   here [cwd]               which project or area owns a folder
 *   sweep [--mark]           sessions on this machine not yet filed in Sessions/
 *   away [pending | done "<drop>" <sha> | skip "<drop>" "<reason>"]   Brain-away drops (read only; ledger in the vault)
 *   search "<query>"         BM25 over every note, top hits with snippets (--limit N, --type T, --json)
 *   orphans                  notes nothing links to (lint reports them as warnings)
 *   ingest [new <file> [title] | text <file>]   sources dropped in 0-Inbox/raw → source notes in 3-Resources
 *   hook session-start|prompt|tool     Claude Code hooks (always exit 0)
 *   import claude-export <zip|json> | cowork | code-sessions [--all] | chat-json <file> | runs
 *   test                     run the test suite
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const VAULT = path.resolve(__dirname, '..', '..');
const F = {
  inbox: '0-Inbox', projects: '1-Projects', areas: '2-Areas', resources: '3-Resources', archive: '4-Archive',
  tasks: 'Tasks', sessions: 'Sessions', claude: '_claude', ops: '_claude/ops', agents: '_claude/agents', sops: '_claude/sops',
  specs: '_claude/specs', templates: '_claude/templates', dashboards: '_claude/dashboards',
  scripts: '_claude/scripts', activity: '_claude/activity', imports: '_claude/import', attachments: '_attachments',
};
const SKIP_REL = new Set([F.templates, F.scripts, F.activity, F.imports, F.attachments, F.dashboards, '0-Inbox/raw', '_claude/skills']); // raw: dropped sources, not notes; skills: the /brain skill source (junctioned into ~/.claude/skills)
const SKIP_DIRS = new Set(['.git', '.github', '.obsidian', '.trash', 'node_modules', 'setup']); // .github holds the repo README, setup the installer
const TODAY = new Date();
const ISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HHMM = (d) => `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

const TYPES = ['project', 'area', 'task', 'decision', 'resource', 'ops', 'protocol', 'agent', 'sop', 'spec', 'plan', 'session', 'review', 'runlog', 'inbox', 'todo', 'hq'];
const STATUS = {
  project: ['idea', 'active', 'blocked', 'waiting', 'paused', 'done', 'archived'],
  area: ['active', 'paused', 'archived'],
  task: ['backlog', 'ready', 'in-progress', 'blocked', 'review', 'done', 'dropped'],
  decision: ['proposed', 'accepted', 'superseded'],
  spec: ['draft', 'approved', 'superseded'],
  plan: ['ready', 'in-progress', 'done', 'superseded'],
  inbox: ['new', 'triaged'],
};
const REQUIRED = {
  '*': ['type', 'created', 'updated'],
  project: ['status', 'next', 'path'], area: ['status', 'cadence', 'next'], task: ['status', 'project', 'owner', 'priority', 'approval'],
  decision: ['status', 'source'], resource: ['source'], ops: ['tool', 'source'], session: ['source', 'kind'], spec: ['status', 'source'], plan: ['status', 'source'],
};
const HOME = { project: F.projects, area: F.areas, task: F.tasks, session: F.sessions, review: F.sessions, ops: F.ops, agent: F.agents, sop: F.sops, spec: F.specs, inbox: F.inbox };

// ---------- secrets ----------
const SECRET_PATTERNS = [
  { name: 'key-value', re: /\b(api[_ -]?key|secret|token|passw(?:or)?d|pwd|bearer|client[_ -]?secret|private[_ -]?key)\b\s*[:=]\s*["']?([^\s"']{8,})/gi, valueGroup: 2 },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'openai', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];
const ALLOW_MARKER = 'brain:allow-secret-pattern';
const BOOLISH = new Set(['true', 'false', 'null', 'none', 'yes', 'no', 'required', 'redacted', '[redacted]', 'set', 'unset', 'placeholder', 'changeme']);
function secretHits(text) {
  const hits = [];
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const p of SECRET_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line))) {
        if (p.valueGroup) {
          const v = m[p.valueGroup].replace(/[,.;)]+$/, '');
          if (BOOLISH.has(v.toLowerCase()) || /^\d{1,6}$/.test(v) || /^[<{[(]/.test(v) || /^\[\[/.test(v) || v.startsWith('$') || v.startsWith('%')) continue;
        }
        hits.push({ line: i + 1, pattern: p.name, excerpt: line.trim().slice(0, 80) });
      }
    }
  });
  return hits;
}
const redact = (s) => String(s || '').replace(SECRET_PATTERNS[0].re, (all, k, v) => `${k}=[redacted]`).replace(SECRET_PATTERNS[3].re, '[redacted]').replace(SECRET_PATTERNS[2].re, '[redacted]');

// ---------- frontmatter ----------
function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch (_) { return v.slice(1, -1).replace(/\\"/g, '"'); } // JSON.parse so "D:\\Projects" comes back as D:\Projects
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'"); // YAML single quotes: no escapes
  return v;
}
// Split a YAML flow list on top-level commas. A regex cannot do this: an apostrophe inside a
// double-quoted item ("What's Next") makes any quote-counting lookahead split in the wrong place,
// which silently merged two aliases and then persisted the damage on the next write.
function splitFlowList(inner) {
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === '\\' && quote === '"') { cur += c + (inner[++i] || ''); continue; }
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => unquote(x));
}
function parseScalar(v) {
  v = v.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowList(inner);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return unquote(v);
}
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = text.slice(3, end).replace(/^\r?\n/, '');
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const fm = {};
  let listKey = null;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (m && !/^\s/.test(line)) {
      listKey = null;
      if (m[2].trim() === '') { fm[m[1]] = ''; listKey = m[1]; continue; }
      fm[m[1]] = parseScalar(m[2]);
      continue;
    }
    const lm = line.match(/^\s*-\s*(.*)$/);
    if (lm && listKey) { if (!Array.isArray(fm[listKey])) fm[listKey] = []; fm[listKey].push(unquote(lm[1])); }
  }
  return { fm, body };
}
function yamlValue(v) {
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : '[]';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (v === null || v === undefined) return '""';
  const s = String(v);
  if (s === '') return '""';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^[A-Za-z0-9_.-]+$/.test(s)) return s;
  if (s.includes('\\') && !s.includes("'")) return `'${s}'`; // Windows paths: single quotes, no escaping
  return JSON.stringify(s);
}
function buildNote(fm, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${yamlValue(v)}`);
  // Trim BOTH ends: parseFrontmatter hands back the body with its leading blank line, so trimming
  // only the end made every setFm call add one more blank line under the frontmatter. Notes bumped
  // repeatedly on one day had collected four.
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}
function setFm(text, updates) {
  const p = parseFrontmatter(text);
  if (!p) return text;
  return buildNote({ ...p.fm, ...updates }, p.body);
}

// ---------- vault ----------
function walk(dir = VAULT, rel = '', out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) { if (SKIP_DIRS.has(ent.name) || SKIP_REL.has(relPath)) continue; walk(path.join(dir, ent.name), relPath, out); }
    else if (ent.name.endsWith('.md') && !(rel === '' && ent.name === 'CLAUDE.md')) out.push({ rel: relPath, abs: path.join(dir, ent.name) });
  }
  return out;
}
function loadNotes() {
  return walk().map((f) => { const text = fs.readFileSync(f.abs, 'utf8'); const p = parseFrontmatter(text); return { ...f, base: path.basename(f.rel, '.md'), text, fm: p ? p.fm : null, body: p ? p.body : text }; });
}
function loadConfig() { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); }
// Who the vault belongs to: `owner_name` in prose, `owner_key` as the task `owner:` value; `agent_owners` are the others allowed.
const OWNER = (() => { let c = {}; try { c = loadConfig(); } catch (_) {} return { name: c.owner_name || 'the owner', key: c.owner_key || 'me', agents: c.agent_owners || ['claude'] }; })();
const linkTarget = (v) => String(v || '').replace(/^"|"$/g, '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
const isOpen = (t) => t.fm && !['done', 'dropped', 'archived'].includes(String(t.fm.status));
const prio = (p) => ({ p1: 1, p2: 2, p3: 3 }[String(p)] || 9);
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
const sanitizeTitle = (t) => String(t || 'untitled').replace(/[:*?"<>|\/\\]/g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
function uniquePath(dir, name) { let p = path.join(dir, `${name}.md`), i = 2; while (fs.existsSync(p)) p = path.join(dir, `${name} (${i++}).md`); return p; }

// ---------- lint ----------
function lint(opts = {}) {
  const notes = loadNotes();
  const errors = [], warns = [];
  const names = new Map();
  for (const n of notes) { names.set(n.base.toLowerCase(), n.rel); if (n.fm && Array.isArray(n.fm.aliases)) for (const a of n.fm.aliases) names.set(String(a).toLowerCase(), n.rel); }
  const files = new Set();
  (function all(dir, rel = '') { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) all(path.join(dir, e.name), r); } else files.add(r.toLowerCase()); } })(VAULT);
  const owners = new Map();
  for (const n of notes) if (n.fm && (n.fm.type === 'project' || n.fm.type === 'area')) { owners.set(n.base.toLowerCase(), n); if (Array.isArray(n.fm.aliases)) for (const a of n.fm.aliases) owners.set(String(a).toLowerCase(), n); }
  const taskIds = new Map(), decIds = new Map(), baseCount = new Map();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const n of notes) baseCount.set(n.base.toLowerCase(), (baseCount.get(n.base.toLowerCase()) || 0) + 1);
  for (const n of notes) {
    const e = (m) => errors.push(`${n.rel}: ${m}`);
    if (baseCount.get(n.base.toLowerCase()) > 1) e('filename is not unique in the vault (links by name would be ambiguous)');
    if (!n.fm) { e('missing frontmatter'); continue; }
    const t = n.fm.type;
    if (!TYPES.includes(t)) { e(`type "${t}" is not one of ${TYPES.join(', ')}`); continue; }
    for (const k of [...REQUIRED['*'], ...(REQUIRED[t] || [])]) if (!(k in n.fm)) e(`missing required key "${k}" for type ${t}`);
    if (STATUS[t] && !STATUS[t].includes(String(n.fm.status))) e(`status "${n.fm.status}" is not one of ${STATUS[t].join(', ')} for type ${t}`);
    for (const k of ['created', 'updated']) if (k in n.fm && !dateRe.test(String(n.fm[k]))) e(`${k} must be YYYY-MM-DD (got "${n.fm[k]}")`);
    if (dateRe.test(String(n.fm.created)) && dateRe.test(String(n.fm.updated)) && n.fm.updated < n.fm.created) e('updated is earlier than created');
    if (HOME[t] && !n.rel.startsWith(HOME[t] + '/') && !n.rel.startsWith(F.archive + '/')) e(`type ${t} notes live in ${HOME[t]}/`);
    if (n.rel.startsWith(F.archive + '/') && (t === 'project' || t === 'area') && n.fm.status !== 'archived') e('notes under 4-Archive must have status archived');
    if ((t === 'project' || t === 'area') && !n.rel.startsWith(F.archive + '/')) { const parts = n.rel.split('/'); if (parts.length !== 3 || parts[1] !== n.base) e(`${t} HQ note must be ${HOME[t]}/<Name>/<Name>.md`); }
    if (t === 'task') {
      const m = n.base.match(/^(T-\d{3}) - .+$/);
      if (!m) e('task filename must be "T-### - Title"'); else { if (taskIds.has(m[1])) e(`duplicate id ${m[1]} (also ${taskIds.get(m[1])})`); taskIds.set(m[1], n.rel); }
      if (!/^##\s+Done when/m.test(n.body)) e('task has no "## Done when" section');
      if (!['none', 'required'].includes(String(n.fm.approval))) e(`approval must be none or required (got "${n.fm.approval}")`);
      if (![OWNER.key, ...OWNER.agents].includes(String(n.fm.owner))) e(`owner must be ${[OWNER.key, ...OWNER.agents].join(', ')} (got "${n.fm.owner}")`);
    }
    if (t === 'decision') { const m = n.base.match(/^(D-\d{3}) - .+$/); if (!m) e('decision filename must be "D-### - Title"'); else { if (decIds.has(m[1])) e(`duplicate id ${m[1]} (also ${decIds.get(m[1])})`); decIds.set(m[1], n.rel); } }
    if (n.fm.project) { const tgt = linkTarget(n.fm.project).toLowerCase(); if (tgt && !owners.has(tgt)) e(`project "${n.fm.project}" does not resolve to a project or area note`); }
    if (!opts.noScan) for (const h of secretHits(n.text)) e(`possible secret (${h.pattern}) at line ${h.line}: ${h.excerpt}`);
    const body = n.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const re = /!?\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(body))) {
      const raw = m[1].split('|')[0].split('#')[0].trim();
      if (!raw) continue;
      const low = raw.toLowerCase();
      const ok = names.has(low) || names.has(path.basename(low)) || files.has(low) || files.has(low + '.md') || files.has(`${F.attachments}/${low}`) || (low.endsWith('.base') && (files.has(low) || files.has(`${F.dashboards}/${low}`)));
      if (!ok) e(`unresolved link [[${raw}]]`);
    }
    if (n.text.includes(INGEST_TODO)) warns.push(`${n.rel}: ingest skeleton not filled in yet (remove ${INGEST_TODO} when done)`);
    if (n.body.split('\n').length > 400) warns.push(`${n.rel}: over 400 lines; split it and keep the summary in the owner note`);
    try { const mt = fs.statSync(n.abs).mtime; if (dateRe.test(String(n.fm.updated)) && (mt - new Date(n.fm.updated + 'T00:00:00')) > 2 * 86400000) warns.push(`${n.rel}: file changed after updated ${n.fm.updated} (bump updated)`); } catch (_) {}
  }
  for (const o of findOrphans(notes)) warns.push(`${o}: orphan (no note links to it); link it from its owner or a related note`);
  if (!opts.quiet) { for (const w of warns) console.log(`warn ${w}`); for (const er of errors) console.log(`error ${er}`); console.log(`${errors.length} errors, ${warns.length} warnings, ${notes.length} notes`); }
  return { errors, warns, count: notes.length };
}
function scan(target) {
  const root = target ? path.resolve(target) : VAULT;
  const exts = new Set(['.md', '.txt', '.json', '.csv', '.base', '.canvas', '.yaml', '.yml', '.ps1', '.js']);
  const hits = [];
  (function all(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(VAULT, p).replace(/\\/g, '/');
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name) || rel === F.activity || rel === F.imports || rel === F.scripts || rel.startsWith('.obsidian')) continue; all(p); }
      else if (exts.has(path.extname(e.name).toLowerCase())) { for (const h of secretHits(fs.readFileSync(p, 'utf8'))) hits.push({ file: rel || e.name, ...h }); }
    }
  })(fs.statSync(root).isDirectory() ? root : path.dirname(root));
  for (const h of hits) console.log(`hit ${h.file}:${h.line} (${h.pattern}) ${h.excerpt}`);
  console.log(`scan: ${hits.length} hit(s)`);
  return hits;
}

// ---------- ids, pick, owners, status ----------
function nextId(kind) {
  let max = 0;
  if (kind === 'D') { for (const n of loadNotes()) { const m = n.base.match(/^D-(\d{3})/); if (m) max = Math.max(max, Number(m[1])); } }
  else { const p = path.join(VAULT, F.tasks); if (fs.existsSync(p)) for (const f of fs.readdirSync(p)) { const m = f.match(/^T-(\d{3})/); if (m) max = Math.max(max, Number(m[1])); } }
  return `${kind}-${String(max + 1).padStart(3, '0')}`;
}
const tasks = (notes) => notes.filter((n) => n.fm && n.fm.type === 'task');
const owners = (notes) => notes.filter((n) => n.fm && (n.fm.type === 'project' || n.fm.type === 'area') && !n.rel.startsWith(F.archive + '/'));
function pickable(notes) {
  const ts = tasks(notes);
  const byId = new Map(ts.map((t) => [t.base.slice(0, 5), t]));
  return ts.filter((t) => t.fm.owner === 'claude' && t.fm.status === 'ready' && t.fm.approval === 'none')
    .filter((t) => (Array.isArray(t.fm.blocked_by) ? t.fm.blocked_by : []).every((b) => { const d = byId.get(linkTarget(b).slice(0, 5)); return !d || d.fm.status === 'done'; }))
    .sort((a, b) => prio(a.fm.priority) - prio(b.fm.priority) || String(a.fm.created).localeCompare(String(b.fm.created)) || a.base.localeCompare(b.base));
}
const waiting = (notes) => tasks(notes).filter(isOpen).filter((t) => t.fm.owner === OWNER.key || t.fm.status === 'blocked' || t.fm.approval === 'required').sort((a, b) => prio(a.fm.priority) - prio(b.fm.priority) || a.base.localeCompare(b.base));
// A task left at in-progress means a session was interrupted. It belongs to neither "Claude next" nor
// "Waiting on the owner", so without this it would be invisible to the session that has to resume it.
const inProgress = (notes) => tasks(notes).filter((t) => t.fm.status === 'in-progress').sort((a, b) => String(a.fm.updated).localeCompare(String(b.fm.updated)) || a.base.localeCompare(b.base));
const openTasksFor = (notes, name) => tasks(notes).filter((t) => isOpen(t) && linkTarget(t.fm.project).toLowerCase() === name.toLowerCase());
function firstStatusLine(n) {
  const m = n.body.match(/##\s+Status now\s*\n([\s\S]*?)(\n##|$)/);
  if (!m) return '';
  const l = m[1].split('\n').map((s) => s.trim()).find((s) => s.startsWith('- '));
  if (!l) return '';
  let s = l.slice(2)
    .replace(/^\d{4}-\d{2}-\d{2}\s*[—-]\s*/, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, target, alias) => alias || target) // plain text: a half-cut wikilink would break lint
    .replace(/`/g, '')
    .replace(/\|/g, '/'); // a pipe would break the HQ table
  if (s.length > 150) s = s.slice(0, 147).replace(/\s+\S*$/, '') + '…';
  return s;
}
function sessions(notes) { return notes.filter((n) => n.fm && (n.fm.type === 'session' || n.fm.type === 'review')).sort((a, b) => b.base.localeCompare(a.base)); }
function lastRunLine(areaNote) { const p = path.join(path.dirname(areaNote.abs), `${areaNote.base} Run Log.md`); if (!fs.existsSync(p)) return ''; const d = fs.readFileSync(p, 'utf8').split('\n').filter((x) => /^- \d{4}-\d{2}-\d{2}/.test(x)).map((x) => x.slice(2, 12)).sort(); return d.length ? d[d.length - 1] : ''; }

function hqData(notes) {
  const cfg = loadConfig();
  const projs = owners(notes).filter((n) => n.fm.type === 'project').sort((a, b) => prio(a.fm.priority) - prio(b.fm.priority) || a.base.localeCompare(b.base));
  const areas = owners(notes).filter((n) => n.fm.type === 'area').sort((a, b) => a.base.localeCompare(b.base));
  const todo = todoParse();
  return {
    projects: projs.map((p) => ({ name: p.base, status: p.fm.status, priority: p.fm.priority, next: p.fm.next || '', open: openTasksFor(notes, p.base).length, updated: p.fm.updated, built: firstStatusLine(p) })),
    areas: areas.map((a) => ({ name: a.base, status: a.fm.status, priority: a.fm.priority || '', cadence: a.fm.cadence || '', next: a.fm.next || '', open: openTasksFor(notes, a.base).length, lastRun: lastRunLine(a), updated: a.fm.updated, built: firstStatusLine(a) })),
    inProgress: inProgress(notes).map((t) => ({ name: t.base, owner: t.fm.owner, since: t.fm.updated, stale: String(t.fm.updated) < ISO(new Date(TODAY.getTime() - 86400000)) })),
    claudeNext: pickable(notes).slice(0, 5).map((t) => t.base),
    waiting: waiting(notes).slice(0, 8).map((t) => ({ name: t.base, why: t.fm.blocked_on || (t.fm.owner === OWNER.key ? 'yours to do' : t.fm.approval === 'required' ? 'needs your go' : '') })),
    recent: sessions(notes).slice(0, 10).map((s) => ({ name: s.base, outcome: s.fm.outcome || s.fm.kind || s.fm.type })),
    undigested: notes.filter((n) => n.fm && n.fm.type === 'session' && n.fm.kind === 'chat' && String(n.fm.digested) !== 'true').length,
    inbox: notes.filter((n) => n.fm && n.fm.type === 'inbox' && n.fm.status === 'new').length,
    todoOpen: todo.open.length, todoNoTask: todo.open.filter((i) => !i.task).length,
    unlinked: (() => { try { return unlinkedFolders(notes, cfg); } catch (_) { return []; } })(),
    sweep: (() => { try { return sweepCount(notes); } catch (_) { return 0; } })(),
  };
}
function lintErrorCount() { try { return lint({ quiet: true }).errors.length; } catch (_) { return 0; } }
function statusLines(notes, limit = 3) {
  const d = hqData(notes);
  const out = [];
  for (const p of d.projects) out.push(`${p.name} — ${p.status}/${p.priority} — open ${p.open}${p.next ? ` — next: ${p.next}` : ''}`);
  for (const a of d.areas) out.push(`${a.name} (area, ${a.cadence}) — open ${a.open}${a.lastRun ? ` — last run ${a.lastRun}` : ''}${a.next ? ` — next: ${a.next}` : ''}`);
  if (d.inProgress.length) out.push(`IN PROGRESS, resume or close: ${d.inProgress.map((t) => `${t.name} (since ${t.since}${t.stale ? ', stale' : ''})`).join(' · ')}`);
  out.push(`Claude next: ${d.claudeNext.slice(0, limit).join(' · ') || 'none'}`);
  out.push(`Waiting on ${OWNER.name}: ${d.waiting.slice(0, limit).map((w) => `${w.name}${w.why ? ` [${w.why}]` : ''}`).join(' · ') || 'none'}`);
  out.push(`Recent sessions: ${d.recent.slice(0, limit).map((r) => `${r.name} (${r.outcome})`).join(' · ') || 'none'}`);
  const extras = [];
  if (d.todoOpen) extras.push(`TODO open ${d.todoOpen}${d.todoNoTask ? ` (${d.todoNoTask} without a task yet)` : ''}`);
  if (d.inbox) extras.push(`Inbox new ${d.inbox}`);
  if (d.undigested) extras.push(`chats not digested ${d.undigested}`);
  if (d.sweep) extras.push(`sessions not filed ${d.sweep}`);
  // Obsidian Git commits every 10 minutes whether the vault is clean or not, so a stray Obsidian
  // creates is committed long before anyone runs lint. Surface the count where it cannot be missed.
  const bad = lintErrorCount();
  if (bad) extras.push(`LINT ${bad} error${bad === 1 ? '' : 's'} — run \`node ${path.join(VAULT, F.scripts, 'brain.js')} lint\``);
  if (extras.length) out.push(extras.join(' · '));
  if (d.unlinked.length) out.push(`Unlinked folders (no note mentions them): ${d.unlinked.join(' · ')}`);
  return out;
}
function hqMarkdown(notes) {
  const d = hqData(notes);
  const L = [];
  L.push(`_Generated ${ISO(TODAY)} by \`brain.js hq\`. Edit the notes, not this section._`, '');
  // Everything the owner actually works on, projects and areas together: splitting them hid the busiest two.
  const all = [...d.projects.map((p) => ({ ...p, kind: 'project' })), ...d.areas.map((a) => ({ ...a, kind: 'area' }))];
  const rank = (x) => prio(x.priority);
  const inFlight = all.filter((x) => ['active', 'blocked', 'waiting'].includes(x.status)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const started = all.filter((x) => ['active', 'blocked', 'waiting', 'paused'].includes(x.status)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  L.push('## In flight', '', '| Name | Kind | Status | Open | Next | Updated |', '|---|---|---|---|---|---|');
  for (const x of inFlight) L.push(`| [[${x.name}]] | ${x.kind} | ${x.status} | ${x.open} | ${x.next} | ${x.updated} |`);
  L.push('', '## Started, not finished', '');
  for (const x of started) L.push(`- [[${x.name}]] — built: ${x.built || 'nothing yet'} — owed: ${x.next || 'no next step set'}`);
  L.push('', '## Ideas', '', all.filter((x) => x.status === 'idea').map((x) => `[[${x.name}]]`).join(' · ') || 'none');
  if (d.areas.length) {
    L.push('', '## Cadence (areas)', '', '| Area | Cadence | Last run | Open | Next |', '|---|---|---|---|---|');
    for (const a of d.areas) L.push(`| [[${a.name}]] | ${a.cadence} | ${a.lastRun || 'never'} | ${a.open} | ${a.next} |`);
  }
  if (d.inProgress.length) L.push('', '## In progress (a session started these and stopped)', '', ...d.inProgress.map((t) => `- [[${t.name}]] — ${t.owner}, since ${t.since}${t.stale ? ' — **stale**, resume or close it' : ''}`));
  L.push('', '## Claude next', '', ...(d.claudeNext.length ? d.claudeNext.map((t) => `- [[${t}]]`) : ['- none']));
  L.push('', `## Decisions and actions needed from ${OWNER.name}`, '', ...(d.waiting.length ? d.waiting.map((w) => `- [[${w.name}]]${w.why ? ` — ${w.why}` : ''}`) : ['- none']));
  L.push('', '## Recent sessions', '', ...(d.recent.length ? d.recent.map((r) => `- [[${r.name}]] — ${r.outcome}`) : ['- none']));
  L.push('', '## Housekeeping', '', `- TODO: ${d.todoOpen} open, ${d.todoNoTask} without a task`, `- Inbox: ${d.inbox} new`, `- Chats not digested: ${d.undigested}`, `- Sessions on this machine not filed: ${d.sweep}`);
  if (d.unlinked.length) L.push(`- Unlinked folders: ${d.unlinked.join(' · ')}`);
  return L.join('\n');
}
function hqWrite() {
  const notes = loadNotes();
  const hq = path.join(VAULT, 'HQ.md');
  let text = fs.readFileSync(hq, 'utf8');
  const block = `<!-- hq:start -->\n${hqMarkdown(notes)}\n<!-- hq:end -->`;
  text = /<!-- hq:start -->[\s\S]*?<!-- hq:end -->/.test(text) ? text.replace(/<!-- hq:start -->[\s\S]*?<!-- hq:end -->/, block) : text + '\n' + block + '\n';
  text = text.replace(/^updated: .*$/m, `updated: ${ISO(TODAY)}`).replace(/^Updated: .*$/m, `Updated: ${ISO(TODAY)}`);
  fs.writeFileSync(hq, text);
  console.log('HQ.md regenerated');
}

// ---------- TODO ----------
const TODO_RE = /^- \[( |x|X)\] (\d{4}-\d{2}-\d{2}) — (.*?)(?:\s+— owner: (.*?))?(?:\s+→\s+(\[\[T-\d{3}[^\]]*\]\]))?(?:\s+— done (\d{4}-\d{2}-\d{2}))?\s*$/;
function todoParse() {
  const p = path.join(VAULT, 'TODO.md');
  if (!fs.existsSync(p)) return { open: [], done: [], text: '' };
  const text = fs.readFileSync(p, 'utf8');
  const open = [], done = [];
  let section = '';
  text.split('\n').forEach((line, i) => {
    if (/^## Open/.test(line)) section = 'open'; else if (/^## Done/.test(line)) section = 'done';
    const m = line.match(TODO_RE);
    if (m) (section === 'done' || m[1] !== ' ' ? done : open).push({ line: i, date: m[2], text: m[3], owner: m[4] || '', task: m[5] ? linkTarget(m[5]) : '', doneDate: m[6] || '' });
  });
  return { open, done, text };
}
function todoCli(args) {
  const p = path.join(VAULT, 'TODO.md');
  if (args[0] === 'add') {
    const text = args.slice(1).join(' ').trim();
    if (!text) { console.log('todo add <text>'); return; }
    let t = fs.readFileSync(p, 'utf8');
    t = t.replace(/(## Open\s*\n)/, `$1- [ ] ${ISO(TODAY)} — ${redact(text)}\n`).replace(/^updated: .*$/m, `updated: ${ISO(TODAY)}`);
    fs.writeFileSync(p, t);
    console.log(`added: - [ ] ${ISO(TODAY)} — ${text}`);
    return;
  }
  const { open, text } = todoParse();
  if (args[0] === '--sync') {
    const notes = loadNotes();
    const byBase = new Map(tasks(notes).map((t) => [t.base.toLowerCase(), t]));
    const lines = text.split('\n');
    const moved = [];
    for (const it of open) {
      const t = it.task ? byBase.get(it.task.toLowerCase()) : null;
      if (!t || t.fm.status !== 'done') continue;
      moved.push(lines[it.line].replace('- [ ]', '- [x]') + ` — done ${t.fm.completed || ISO(TODAY)}`);
      lines[it.line] = null;
      // carry the item's indented continuation lines (its Brief) with it, or they orphan under Open
      for (let i = it.line + 1; i < lines.length && lines[i] !== null && /^\s+\S/.test(lines[i]); i++) { moved.push(lines[i]); lines[i] = null; }
    }
    if (moved.length) {
      let out = lines.filter((l) => l !== null).join('\n');
      out = out.replace(/(## Done\s*\n)/, `$1${moved.join('\n')}\n`).replace(/^updated: .*$/m, `updated: ${ISO(TODAY)}`);
      fs.writeFileSync(p, out);
    }
    console.log(`todo sync: ${moved.length} item(s) ticked and moved to Done`);
    return;
  }
  console.log(`TODO: ${open.length} open`);
  for (const it of open) console.log(`- ${it.date} — ${it.text}${it.owner ? ` — owner: ${it.owner}` : ''}${it.task ? ` → ${it.task}` : '  ← needs a Brief and a task'}`);
}

// ---------- classification, folders, sweep ----------
function projectIndex(notes, cfg) {
  return owners(notes).map((n) => {
    const aliases = Array.isArray(n.fm.aliases) ? n.fm.aliases.map(String) : [];
    return { name: n.base, type: n.fm.type, status: n.fm.status, next: n.fm.next || '', path: normPath(n.fm.path), names: [n.base, ...aliases].map((s) => s.toLowerCase()), keywords: (((cfg && cfg.projects) || {})[n.base] || []).map((k) => String(k).toLowerCase()) };
  });
}
// The noun list matters: "start a newsletter" once read as an addition to an existing project,
// because only project/business/app/company/store/channel/course counted as things one starts.
const NEW_SIGNAL = /\b(new (project|business|venture|app|startup|idea)|start(ing)? (a|an|my) (new )?(?:[\w'-]+ ){0,3}(project|business|app|company|store|channel|course|newsletter|podcast|blog|brand|agency|service|product|site|substack)|i want to (build|create|start|launch|make) (a|an|my)|business idea|side project|launch(ing)? a)\b/i;
function classifyText(text, notes, cfg) {
  const T = String(text || '').toLowerCase();
  // A name or alias is worth 3. A keyword is worth 1, or 2 when it is a phrase: "rest days" and
  // "funded account" identify a project on their own, where a single word like "chart" does not.
  const scored = projectIndex(notes, cfg).map((p) => {
    let score = 0;
    for (const nm of p.names) if (nm && T.includes(nm)) score += 3;
    for (const k of new Set(p.keywords)) if (k && T.includes(k)) score += k.trim().includes(' ') ? 2 : 1;
    return { name: p.name, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0], second = scored[1];
  const newSignal = NEW_SIGNAL.test(T);
  let verdict = 'unknown';
  if (top && top.score >= 3 && (!second || top.score - second.score >= 2)) verdict = 'addition';
  else if (top && second && top.score >= 2 && top.score - second.score < 2) verdict = 'ambiguous';
  else if (top && top.score >= 2) verdict = 'addition';
  // An explicit new-venture phrase never yields "addition": the keywords may just be the topic.
  // "start a podcast about running" is not the Running practice; "new project: Greenleaf store"
  // might be Greenleaf or might not. A strong match means ask one line; a weak one means treat it as new.
  if (newSignal) verdict = top && top.score >= 3 ? 'ambiguous' : 'new';
  return { verdict, newSignal, top: top || null, second: second || null, scored };
}
function classifyCli(text) {
  const notes = loadNotes(); const cfg = loadConfig();
  const r = classifyText(text, notes, cfg);
  console.log(`verdict: ${r.verdict} | best: ${r.top ? `${r.top.name} (score ${r.top.score})` : 'none'} | candidates: ${r.scored.slice(0, 3).map((s) => `${s.name} ${s.score}`).join(', ') || 'none'} | new-project signal: ${r.newSignal ? 'yes' : 'no'}`);
  if (r.verdict === 'new') console.log('→ NEW project: follow _claude/sops/Start a Project.md (note, path under code_root, keywords in config)');
  if (r.verdict === 'addition') console.log(`→ addition to ${r.top.name}: work in its path, log under it`);
  if (r.verdict === 'ambiguous') console.log(`→ ask ${OWNER.name} one line: ${r.top.name} or ${r.second ? r.second.name : 'a new project'}?`);
  if (r.verdict === 'unknown') console.log('→ no project signal; if it is real work, ask which project, else 0-Inbox');
}
function projectForCwd(cwd, notes, cfg) {
  const c = normPath(cwd);
  if (!c) return null;
  return projectIndex(notes, cfg).filter((p) => p.path && (c === p.path || c.startsWith(p.path + '/'))).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
function hereCli(cwd) { const notes = loadNotes(); const p = projectForCwd(cwd || process.cwd(), notes, loadConfig()); console.log(p ? `${p.name} (${p.type}) — ${p.status}${p.next ? ` — next: ${p.next}` : ''} — path ${p.path}` : `no project or area owns ${cwd || process.cwd()}`); }
function unlinkedFolders(notes, cfg) {
  const ignore = new Set((cfg.scan_ignore || []).map((s) => String(s).toLowerCase()));
  const markers = ['.git', 'CLAUDE.md', 'package.json', 'pyproject.toml', 'README.md'];
  const corpus = notes.map((n) => n.text.replace(/\\/g, '/').toLowerCase()).join('\n');
  const ownerPaths = projectIndex(notes, cfg).map((p) => p.path).filter(Boolean);
  const out = [];
  for (const root of (cfg.scan_roots || [])) {
    let entries = []; try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$') || ignore.has(e.name.toLowerCase())) continue;
      const full = path.join(root, e.name); const norm = normPath(full);
      if (ownerPaths.some((p) => norm === p || norm.startsWith(p + '/') || p.startsWith(norm + '/'))) continue;
      if (!markers.some((m) => fs.existsSync(path.join(full, m)))) continue;
      if (corpus.includes(norm)) continue;
      out.push(full);
    }
  }
  return out;
}
function knownSessionIds(notes) { const ids = new Set(); for (const n of notes) if (n.fm) { for (const k of ['chat_id', 'session_id']) if (n.fm[k]) ids.add(String(n.fm[k]).replace(/^(code|cowork):/, '')); if (Array.isArray(n.fm.session_ids)) for (const s of n.fm.session_ids) ids.add(String(s)); } return ids; }
function localSessions() {
  const out = [];
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(root)) for (const proj of fs.readdirSync(root)) { const pd = path.join(root, proj); if (!fs.statSync(pd).isDirectory()) continue; for (const f of fs.readdirSync(pd)) if (f.endsWith('.jsonl')) { const p = path.join(pd, f); out.push({ id: f.replace('.jsonl', ''), store: 'claude-code', path: p, slug: proj, mtime: fs.statSync(p).mtimeMs }); } }
  const cw = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'local-agent-mode-sessions');
  if (fs.existsSync(cw)) (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) find(p); else if (/^local_.*\.json$/.test(e.name)) out.push({ id: path.basename(e.name, '.json'), store: 'cowork', path: p, mtime: fs.statSync(p).mtimeMs }); } })(cw);
  return out;
}
// A transcript stored under a work root's project folder is work, whatever it talks about.
function transcriptWorkRoot(cfg, s) { if (!s.slug) return null; const slug = s.slug.toLowerCase(); for (const r of cfg.work_roots || []) { const w = slugifyPath(r).toLowerCase(); if (slug === w || slug.startsWith(w + '-')) return r; } return null; }
// Headless calls from pipelines (n8n, claude -p): one user turn opening with a prompt listed in config pipeline_prompts.
function firstUserText(file) { let head = ''; try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); head = b.slice(0, n).toString('utf8'); } catch (_) { return ''; } for (const line of head.split('\n')) { let j; try { j = JSON.parse(line); } catch (_) { continue; } if (j.type === 'user') { const t = textOf(j.message && j.message.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim(); if (t) return t; } } return ''; }
function isPipelineText(cfg, text) { return (cfg.pipeline_prompts || []).some((p) => { try { return new RegExp(p, 'i').test(text); } catch (_) { return false; } }); }
// Sessions that sweep counts and import files: not work, not a pipeline call, newer than the last sweep mark (unless all).
function fileableSessions(cfg, all) { const st = sweepState(); return localSessions().filter((s) => !transcriptWorkRoot(cfg, s) && (all || s.mtime > (st.lastMark || 0)) && !(s.store === 'claude-code' && isPipelineText(cfg, firstUserText(s.path)))); }
function sweepState() { const p = path.join(VAULT, F.activity, 'sweep-state.json'); try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return { lastMark: 0 }; } }
function sweepCount(notes) { const known = knownSessionIds(notes); return fileableSessions(loadConfig()).filter((s) => !known.has(s.id)).length; }
function sweepCli(mark) {
  const notes = loadNotes(); const known = knownSessionIds(notes); const st = sweepState();
  const list = fileableSessions(loadConfig()).filter((s) => !known.has(s.id)).sort((a, b) => b.mtime - a.mtime);
  console.log(`sweep: ${list.length} session(s) on this machine not filed in ${F.sessions}/`);
  for (const s of list.slice(0, 30)) console.log(`- ${s.store} ${ISO(new Date(s.mtime))} ${s.id}`);
  if (mark) { fs.mkdirSync(path.join(VAULT, F.activity), { recursive: true }); fs.writeFileSync(path.join(VAULT, F.activity, 'sweep-state.json'), JSON.stringify({ lastMark: Date.now() })); console.log('baseline marked'); }
}

// ---------- hooks ----------
function readStdinJson() { try { const raw = fs.readFileSync(0, 'utf8'); return raw.trim() ? JSON.parse(raw) : {}; } catch (_) { return {}; } }
function activityAppend(rec) { const dir = path.join(VAULT, F.activity); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, `${ISO(TODAY)}.jsonl`), JSON.stringify(rec) + '\n'); }
function isWorkContext(cwd, text, cfg) {
  const c = normPath(cwd);
  if (c && (cfg.work_roots || []).some((r) => { const w = normPath(r); return w && (c === w || c.startsWith(w + '/')); })) return true;
  const T = String(text || '').toLowerCase();
  return !!T && (cfg.work_keywords || []).some((k) => T.includes(String(k).toLowerCase()));
}
// The folder a session STARTED in, which `cd` cannot change: Claude Code stores each transcript under
// ~/.claude/projects/<slugified cwd>/<session id>.jsonl. Comparing slugs avoids having to decode one.
const slugifyPath = (s) => String(s).replace(/[^A-Za-z0-9]/g, '-');
function sessionSlug() {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) return null;
  try {
    const root = path.join(os.homedir(), '.claude', 'projects');
    for (const d of fs.readdirSync(root)) if (fs.existsSync(path.join(root, d, id + '.jsonl'))) return d;
  } catch (_) {}
  return null;
}
// Which work root this session belongs to, or null. Checked on every command, not just the hooks,
// because the global rules file and the /brain skill are user-scope and load in work sessions too.
function matchedWorkRoot(cfg, cwd) {
  const slug = sessionSlug();
  if (slug) for (const r of cfg.work_roots || []) { const w = slugifyPath(r); if (slug === w || slug.startsWith(w + '-')) return r; }
  const c = normPath(cwd || process.cwd());
  for (const r of cfg.work_roots || []) { const w = normPath(r); if (w && (c === w || c.startsWith(w + '/'))) return r; }
  return null;
}
function isWorkSession(cfg, cwd) { return !!matchedWorkRoot(cfg, cwd); }
// Name the folder and the way out. A bare refusal reads as a broken brain, which is how the app
// silently defaulting new sessions into a work root once cost a whole day.
function refuseWork(cfg, cwd) {
  const root = (cfg && matchedWorkRoot(cfg, cwd)) || 'a folder listed in work_roots';
  console.log('work session: the personal brain is not available here.');
  console.log(`This session started in ${root}, a work root (_claude/scripts/config.json). The wall keeps work and personal apart in both directions.`);
  console.log(`Nothing is broken. If this was meant to be personal work, start a NEW session in ${VAULT}.`);
  console.log(`Only move this session if it has not read anything under the work root: the guard follows the folder, so a session that moves carries whatever it has already read into the vault's reach.`);
}
function hook(kind) {
  try {
    if (!fs.existsSync(path.join(VAULT, 'HQ.md'))) return;
    const cfg = loadConfig();
    const input = readStdinJson();
    const cwd = input.cwd || process.cwd();
    if (kind === 'session-start') {
      // The wall: work sessions never see the personal brain. Say so rather than going silent —
      // silence plus a refusing /brain is indistinguishable from a broken setup.
      const wr = matchedWorkRoot(cfg, cwd);
      if (wr) {
        console.log(`[brain] Work session: this one started in ${wr}, a work root. The personal brain is off here and stays off.`);
        console.log(`[brain] Meant to work on your own projects? Start a NEW session in ${VAULT}. Only move this one if it has not read anything under the work root — the guard follows the folder, so moving it would open the vault to whatever is already in this session's context.`);
        return;
      }
      const notes = loadNotes();
      const here = projectForCwd(cwd, notes, cfg);
      console.log(`[brain] ${OWNER.name}'s second brain: ${VAULT}. Read ${path.join(VAULT, '_claude', 'START.md')} before working on their projects; use /brain (capture|task|todo|status|decision|log|review|sync-chats|next|ingest|search|away).`);
      console.log(here ? `[brain] This folder belongs to ${here.type} ${here.name} (${here.status})${here.next ? ` — next: ${here.next}` : ''}. Start with /brain status, end with /brain log.` : `[brain] cwd ${cwd} is not inside any project's path. If work here is a project, name it (or say "new project: …").`);
      for (const l of statusLines(notes, 3).slice(0, 22)) console.log(`[brain] ${l}`);
      try { const a = awayAnnounce(cfg); if (a) console.log(a); } catch (_) {}
      activityAppend({ ts: new Date().toISOString(), session_id: input.session_id || '', cwd, event: 'session-start', source: input.source || '', project: here ? here.name : '' });
      return;
    }
    if (kind === 'prompt') {
      const raw = String(input.prompt || '');
      if (isWorkSession(cfg, cwd) || isWorkContext(cwd, raw, cfg)) return;
      let hint = '';
      if (raw.length >= 12 && !raw.startsWith('/')) {
        const notes = loadNotes();
        const r = classifyText(raw, notes, cfg);
        const here = projectForCwd(cwd, notes, cfg);
        const idx = projectIndex(notes, cfg);
        if (r.verdict === 'new') hint = `[brain] This reads like a NEW project (no strong match among ${idx.length} known projects and areas). If so, create its note per _claude/sops/Start a Project.md before building; if it belongs to an existing one, say which.`;
        else if (r.verdict === 'ambiguous' && r.second) hint = `[brain] Could belong to ${r.top.name} or ${r.second.name}; confirm which in one line before filing.`;
        else if (r.verdict === 'addition' && (!here || here.name !== r.top.name)) hint = `[brain] Looks like ${r.top.name}${here ? ` (cwd is in ${here.name})` : ''}; its folder is ${(idx.find((p) => p.name === r.top.name) || {}).path || 'unset'}.`;
      }
      activityAppend({ ts: new Date().toISOString(), session_id: input.session_id || '', cwd, event: 'prompt', text: redact(raw).slice(0, 500), hint: hint ? hint.slice(8, 60) : '' });
      if (hint) console.log(hint);
      return;
    }
    if (kind === 'tool') {
      const ti = input.tool_input || {};
      const target = String(ti.file_path || ti.notebook_path || ti.command || ti.path || '');
      if (isWorkSession(cfg, cwd) || isWorkContext(cwd, target, cfg)) return;
      activityAppend({ ts: new Date().toISOString(), session_id: input.session_id || '', cwd, event: 'tool', tool: input.tool_name || '', target: redact(target).slice(0, 120) });
    }
  } catch (_) { /* a hook must never break a session */ }
}

// ---------- imports ----------
function classify(cfg, title, sample) {
  const T = String(title || '').toLowerCase(), S = String(sample || '').toLowerCase();
  if ((cfg.skip_titles || []).some((s) => T.includes(s.toLowerCase()))) return { kind: 'skip' };
  if ((cfg.skip_keywords || []).some((s) => T.includes(s.toLowerCase()))) return { kind: 'skip' };
  if ((cfg.work_keywords || []).some((s) => T.includes(s.toLowerCase()) || S.includes(s.toLowerCase()))) return { kind: 'skip' };
  if ((cfg.ideas_titles || []).some((s) => T.includes(s.toLowerCase()))) return { kind: 'idea' };
  let best = null, bestScore = 0;
  for (const [proj, kws] of Object.entries(cfg.projects || {})) { let score = 0; for (const k of kws) { const kk = k.toLowerCase(); if (T.includes(kk)) score += 3; if (S.includes(kk)) score += 1; } if (score > bestScore) { bestScore = score; best = proj; } }
  if (best && bestScore >= 2) return { kind: 'project', project: best };
  if ((cfg.ideas_keywords || []).some((s) => T.includes(s.toLowerCase()) || S.includes(s.toLowerCase()))) return { kind: 'idea' };
  return { kind: 'unclassified' };
}
function existingChats() {
  const map = new Map();
  for (const dir of [F.sessions, F.inbox]) { const p = path.join(VAULT, dir); if (!fs.existsSync(p)) continue; for (const f of fs.readdirSync(p)) { if (!f.endsWith('.md')) continue; const fp = path.join(p, f); const pr = parseFrontmatter(fs.readFileSync(fp, 'utf8')); if (pr && pr.fm.chat_id) map.set(String(pr.fm.chat_id), { path: fp, digested: String(pr.fm.digested) === 'true' }); } }
  return map;
}
const dayOf = (s) => { const d = new Date(s); return isNaN(d) ? ISO(TODAY) : ISO(d); };
function textOf(content) { if (typeof content === 'string') return content; if (Array.isArray(content)) return content.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n'); if (content && typeof content === 'object' && content.text) return content.text; return ''; }
function newCounts() { return { imported: 0, ideas: 0, skipped: 0, present: 0, unclassified: [] }; }
function report(c) { console.log(`imported ${c.imported}, ideas ${c.ideas}, skipped ${c.skipped}, already present ${c.present}, unclassified ${c.unclassified.length}`); for (const u of c.unclassified) console.log(`  unclassified: ${u}`); }
// chat = {title, chat_id, chat_date, source, messages:[{role, date, text}]}
function writeChat(cfg, chat, counts) {
  const users = chat.messages.filter((m) => m.role === 'user' && String(m.text || '').trim());
  const assistants = chat.messages.filter((m) => m.role === 'assistant' && String(m.text || '').trim());
  const cls = classify(cfg, chat.title, users.slice(0, 3).map((m) => m.text).join(' ').slice(0, 1500));
  if (cls.kind === 'skip' || !users.length) { counts.skipped++; return null; }
  const date = chat.chat_date || ISO(TODAY);
  const title = sanitizeTitle(chat.title);
  const opener = redact(users[0].text).replace(/\s+/g, ' ').slice(0, 240);
  if (cls.kind === 'unclassified') { counts.unclassified.push(chat.title); return null; }
  if (cls.kind === 'idea') {
    const fm = { type: 'inbox', status: 'new', source: chat.source, chat_id: chat.chat_id, chat_date: date, created: ISO(TODAY), updated: ISO(TODAY), tags: ['idea'] };
    const p = uniquePath(path.join(VAULT, F.inbox), `${date} - Idea - ${title}`);
    fs.writeFileSync(p, buildNote(fm, `# Idea: ${title}\n\nFrom a ${chat.source} chat on ${date} (${users.length} messages from ${OWNER.name}).\n\nOpened with: ${opener}\n\nTriage in /brain review: keep as a project, merge into an existing one, or drop.\n`));
    counts.ideas++; return p;
  }
  const fm = { type: 'session', kind: 'chat', source: chat.source, chat_id: chat.chat_id, chat_date: date, project: `[[${cls.project}]]`, messages: chat.messages.length, digested: false, outcome: 'n/a', created: ISO(TODAY), updated: ISO(TODAY), tags: [] };
  const L = [`# ${title}`, '', '## Summary', `Opened with: ${opener}`, `(${users.length} messages from ${OWNER.name}, ${assistants.length} replies; digest in /brain review)`, '', "## Malik's messages"];
  for (const m of users) L.push(`- **${m.date || date}** — ${redact(m.text).replace(/\r/g, '').replace(/\n+/g, ' ⏎ ').trim()}`);
  L.push('', "## Claude's replies (condensed)");
  for (const m of assistants) L.push(`- **${m.date || date}** — ${redact(m.text).replace(/\r/g, '').replace(/\n+/g, ' ').trim().slice(0, 400)}${m.text.length > 400 ? ' …' : ''}`);
  L.push('', '## Extracted', '- none yet (digested: false)');
  const p = uniquePath(path.join(VAULT, F.sessions), `${date} - ${title}`);
  fs.writeFileSync(p, buildNote(fm, L.join('\n')));
  counts.imported++; return p;
}
function importClaudeExport(file) {
  const cfg = loadConfig(); const counts = newCounts();
  let jsonPath = file;
  if (file.toLowerCase().endsWith('.zip')) {
    const dir = path.join(VAULT, F.imports, 'claude-export'); fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dir}' -Force`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('could not expand the zip: ' + r.stderr);
    const found = (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const x = find(p); if (x) return x; } else if (e.name === 'conversations.json') return p; } return null; })(dir);
    if (!found) throw new Error('conversations.json not found in the export');
    jsonPath = found;
  }
  const convs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const existing = existingChats();
  for (const c of convs) {
    const id = String(c.uuid || c.id || '');
    if (!id) { counts.skipped++; continue; }
    if (existing.has(id)) { if (existing.get(id).digested) { counts.present++; continue; } fs.unlinkSync(existing.get(id).path); }
    const msgs = (c.chat_messages || c.messages || []).map((m) => ({ role: m.sender === 'human' || m.role === 'user' ? 'user' : 'assistant', date: dayOf(m.created_at), text: m.text || (Array.isArray(m.content) ? m.content.map((x) => x.text || '').join('\n') : '') }));
    writeChat(cfg, { title: c.name || c.title || 'untitled', chat_id: id, chat_date: dayOf(c.created_at), source: 'claude.ai', messages: msgs }, counts);
  }
  report(counts);
}
function importCowork() {
  const cfg = loadConfig(); const counts = newCounts(); const seen = new Set(existingChats().keys());
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'local-agent-mode-sessions');
  if (!fs.existsSync(root)) { console.log('no Cowork sessions found'); return; }
  const metas = []; (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) find(p); else if (/^local_.*\.json$/.test(e.name)) metas.push(p); } })(root);
  for (const mp of metas) {
    let meta; try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (_) { continue; }
    const id = 'cowork:' + path.basename(mp, '.json');
    if (seen.has(id)) { counts.present++; continue; }
    const audit = path.join(path.dirname(mp), path.basename(mp, '.json'), 'audit.jsonl');
    if (!fs.existsSync(audit)) { counts.skipped++; continue; }
    const msgs = [];
    for (const line of fs.readFileSync(audit, 'utf8').split('\n')) { if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch (_) { continue; } const role = j.type === 'user' || j.role === 'user' ? 'user' : (j.type === 'assistant' || j.role === 'assistant' ? 'assistant' : null); if (!role) continue; const text = textOf(j.message ? j.message.content : (j.content !== undefined ? j.content : j.text)); if (!text || text.startsWith('<scheduled-task')) continue; msgs.push({ role, date: dayOf(j.timestamp || meta.createdAt), text }); }
    if (!msgs.length) { counts.skipped++; continue; }
    const title = meta.title || meta.name || msgs[0].text.slice(0, 60);
    if (/^(Morning briefing|Weekly digest)$/i.test(title)) { counts.skipped++; continue; }
    writeChat(cfg, { title, chat_id: id, chat_date: dayOf(meta.createdAt), source: 'cowork', messages: msgs }, counts);
  }
  report(counts);
}
function readCodeSession(file) {
  const msgs = []; let summary = null, first = null, scheduled = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.type === 'summary' && j.summary && !summary) summary = j.summary;
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    let text = textOf(j.message && j.message.content);
    if (j.type === 'user' && /^<scheduled-task name="([^"]+)"/.test(text)) { scheduled = text.match(/^<scheduled-task name="([^"]+)"/)[1]; if (!first) first = j.timestamp; continue; }
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<command-message>[\s\S]*?<\/command-message>/g, '').replace(/<command-name>[\s\S]*?<\/command-name>/g, '').trim();
    if (!text || (j.type === 'user' && /^<(command-|local-command|task-notification)/.test(text))) continue;
    if (j.type === 'user' && /^(\[Request interrupted by user|Base directory for this skill|Launching skill:|Tool loaded|Your questions have been answered)/.test(text)) continue;
    if (!first) first = j.timestamp;
    msgs.push({ role: j.type === 'user' ? 'user' : 'assistant', date: dayOf(j.timestamp), text, ts: j.timestamp });
  }
  return { msgs, summary, first, scheduled };
}
function importCodeSessions(all) {
  const cfg = loadConfig(); const counts = newCounts(); const seen = new Set(existingChats().keys());
  for (const s of fileableSessions(cfg, all).filter((x) => x.store === 'claude-code')) {
    const id = 'code:' + s.id;
    if (seen.has(id)) { counts.present++; continue; }
    const { msgs, summary, first, scheduled } = readCodeSession(s.path);
    if (scheduled) { counts.skipped++; continue; }
    const users = msgs.filter((m) => m.role === 'user');
    if (!users.length) { counts.skipped++; continue; }
    let firstText = users[0].text.replace(/\s+/g, ' ').trim();
    const um = firstText.match(/^(https?:\/\/\S+)\s*(.*)$/);
    if (um) { const repo = um[1].replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, ''); firstText = (um[2] || repo).trim() + (um[2] ? ` (${repo})` : ''); }
    writeChat(cfg, { title: summary || firstText.slice(0, 70), chat_id: id, chat_date: dayOf(first), source: 'claude-code', messages: msgs }, counts);
  }
  report(counts);
}
function importChatJson(file) {
  const cfg = loadConfig(); const counts = newCounts(); const seen = new Set(existingChats().keys());
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const c of (Array.isArray(data) ? data : [data])) { if (seen.has(String(c.chat_id))) { counts.present++; continue; } const p = writeChat(cfg, { title: c.title, chat_id: String(c.chat_id), chat_date: c.chat_date, source: c.source || 'claude.ai', messages: c.messages || [] }, counts); if (p) console.log(`wrote ${path.relative(VAULT, p)}`); }
  report(counts);
}
// scheduled-task transcripts -> one line per run in the owning area's Run Log
// Run Logs are newest first: add `line` (if given) and re-sort every dated line by its "YYYY-MM-DD HH:MM" stamp,
// keeping them where the first dated line was. Sessions arrive in any order, so inserting at the top is not enough.
function sortRunLog(text, line) {
  const parts = text.split('\n');
  const dated = (l) => /^- \d{4}-\d{2}-\d{2}/.test(l);
  const at = parts.findIndex(dated);
  const rows = parts.filter(dated).concat(line ? [line] : []);
  const rest = parts.filter((l) => !dated(l));
  rows.sort((a, b) => b.slice(2, 18).localeCompare(a.slice(2, 18)));
  rest.splice(at >= 0 ? at : rest.length, 0, ...rows);
  return rest.join('\n').replace(/\n{3,}/g, '\n\n');
}
function importRuns() {
  const cfg = loadConfig(); const map = cfg.scheduled_tasks || {};
  let added = 0, present = 0, unknown = new Set();
  for (const s of localSessions().filter((x) => x.store === 'claude-code')) {
    const { msgs, first, scheduled } = readCodeSession(s.path);
    if (!scheduled) continue;
    const area = map[scheduled];
    if (!area) { unknown.add(scheduled); continue; }
    const logPath = path.join(VAULT, F.areas, area, `${area} Run Log.md`);
    if (!fs.existsSync(logPath)) { unknown.add(`${scheduled} (no run log at ${path.relative(VAULT, logPath)})`); continue; }
    let text = fs.readFileSync(logPath, 'utf8');
    if (text.includes(s.id)) { present++; continue; }
    const last = msgs.filter((m) => m.role === 'assistant').slice(-1)[0];
    const lastText = last ? last.text.toLowerCase() : '';
    const outcome = !last ? 'failed (no reply)' : /not reachable|unreachable|failed|could not|error/.test(lastText) ? 'failed or degraded' : 'ok';
    const when = first ? new Date(first) : new Date(s.mtime);
    const line = `- ${ISO(when)} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')} — ${outcome} — ${msgs.length} turns — session ${s.id}`;
    text = sortRunLog(text, line);
    fs.writeFileSync(logPath, setFm(text, { updated: ISO(TODAY) }));
    added++;
  }
  console.log(`runs: ${added} added, ${present} already logged${unknown.size ? `, unmapped: ${[...unknown].join(', ')}` : ''}`);
}

// ---------- search (BM25, local, no dependencies) ----------
const STOP = new Set('a an and are as at be but by can do for from has have how i if in into is it its me my no not of on or our so that the their them then there these this to was we what when where which who why will with you your'.split(' '));
function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [])
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)); // trades → trade
}
// Title and aliases count three times: a note named after the query is almost always the answer.
function buildIndex(notes) {
  const docs = notes.map((n) => {
    const fm = n.fm || {};
    const title = [n.base, ...(Array.isArray(fm.aliases) ? fm.aliases : [])].join(' ');
    const meta = ['next', 'tags', 'project', 'tool'].map((k) => (Array.isArray(fm[k]) ? fm[k].join(' ') : fm[k] || '')).join(' ');
    const toks = [...tokenize(title), ...tokenize(title), ...tokenize(title), ...tokenize(meta), ...tokenize(n.body)];
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { note: n, len: toks.length, tf };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, avg, N: docs.length };
}
function snippet(text, terms, width = 180) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^---$/.test(l) && !/^#\s/.test(l)); // the H1 only repeats the name
  let best = '', bestScore = -1;
  for (const l of lines) {
    const toks = new Set(tokenize(l));
    const sc = terms.filter((t) => toks.has(t)).length;
    if (sc > bestScore) { best = l; bestScore = sc; }
  }
  let s = best.replace(/\s+/g, ' ');
  if (s.length > width) {
    const low = s.toLowerCase();
    const first = Math.min(...terms.map((t) => { const i = low.indexOf(t); return i < 0 ? Infinity : i; }));
    const start = Number.isFinite(first) ? Math.max(0, first - 40) : 0;
    s = (start > 0 ? '…' : '') + s.slice(start, start + width) + (start + width < s.length ? '…' : '');
  }
  return s;
}
function searchNotes(notes, query, opts = {}) {
  const idx = opts.index || buildIndex(notes);
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const k1 = 1.2, bb = 0.75;
  const phrase = String(query).toLowerCase().trim();
  const out = [];
  for (const d of idx.docs) {
    const n = d.note;
    if (opts.type && (!n.fm || n.fm.type !== opts.type)) continue;
    let score = 0, matched = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      matched++;
      const df = idx.df.get(t) || 0;
      const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - bb + bb * d.len / idx.avg));
    }
    if (!score) continue;
    score *= 0.5 + 0.5 * matched / terms.length; // reward notes that hold every term, not one term many times
    if (terms.length > 1 && n.text.toLowerCase().includes(phrase)) score *= 1.5;
    if (n.rel.startsWith(F.archive + '/')) score *= 0.7;
    out.push({ rel: n.rel, name: n.base, type: n.fm ? n.fm.type : '', status: n.fm ? n.fm.status || '' : '', score, snippet: snippet(n.body, terms) });
  }
  return out.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel)).slice(0, opts.limit || 8);
}
function searchCli(args) {
  const opts = { limit: 8 };
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') opts.limit = Number(args[++i]) || 8;
    else if (args[i] === '--type') opts.type = args[++i];
    else if (args[i] === '--json') opts.json = true;
    else words.push(args[i]);
  }
  const q = words.join(' ').trim();
  if (!q) { console.log('search "<query>" [--limit N] [--type resource|task|…] [--json]'); process.exit(2); }
  const hits = searchNotes(loadNotes(), q, opts);
  if (opts.json) { console.log(JSON.stringify(hits, null, 2)); return; }
  if (!hits.length) { console.log(`search: no notes match "${q}"`); return; }
  for (const h of hits) console.log(`${h.score.toFixed(2).padStart(6)}  [[${h.name}]]  ${h.type}${h.status ? `/${h.status}` : ''}  ${h.rel}\n        ${h.snippet}`);
}

// ---------- orphans ----------
// A note nothing links to is knowledge nobody will find again. Generated, structural and log notes
// are exempt: HQ links projects and areas, sessions are found by date, the inbox is triaged weekly.
const ORPHAN_EXEMPT = new Set(['hq', 'todo', 'protocol', 'session', 'review', 'inbox', 'runlog', 'project', 'area', 'agent']);
function findOrphans(notes) {
  const names = new Map();
  for (const n of notes) { names.set(n.base.toLowerCase(), n.rel); if (n.fm && Array.isArray(n.fm.aliases)) for (const a of n.fm.aliases) names.set(String(a).toLowerCase(), n.rel); }
  const inbound = new Map();
  for (const n of notes) {
    const re = /!?\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(n.text))) { // frontmatter links count: project: "[[X]]" is a real reference
      const raw = m[1].split('|')[0].split('#')[0].trim().toLowerCase();
      const tgt = names.get(raw) || names.get(path.basename(raw));
      if (tgt && tgt !== n.rel) inbound.set(tgt, (inbound.get(tgt) || 0) + 1);
    }
  }
  return notes.filter((n) => n.fm && !ORPHAN_EXEMPT.has(n.fm.type) && !n.rel.startsWith(F.archive + '/') && !inbound.get(n.rel)).map((n) => n.rel).sort();
}

// ---------- ingest ----------
// Drop articles, PDFs and transcripts into 0-Inbox/raw/. `ingest` lists what is waiting with suggested
// owners and related notes; `ingest new <file> "<title>"` writes the source-summary skeleton in
// 3-Resources with provenance (file, sha256, date) and moves the raw file to raw/processed/.
// The raw folder is gitignored: sources may be large or copyrighted; the summary is what the vault keeps.
const RAW = '0-Inbox/raw';
const INGEST_TODO = '<!-- ingest:todo -->';
const TEXT_EXT = new Set(['.md', '.txt', '.html', '.htm', '.vtt', '.srt', '.json', '.csv']);
function sha256(buf) { return require('crypto').createHash('sha256').update(buf).digest('hex'); }
function pdfToText(file) {
  for (const exe of ['pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe']) {
    const r = spawnSync(exe, ['-layout', '-q', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) return r.stdout;
  }
  return '';
}
function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return pdfToText(file);
  if (!TEXT_EXT.has(ext)) return '';
  let t = fs.readFileSync(file, 'utf8');
  if (ext === '.html' || ext === '.htm') t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
  if (ext === '.vtt' || ext === '.srt') t = t.split(/\r?\n/).filter((l) => l.trim() && l.trim() !== 'WEBVTT' && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ');
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
// The origin URL, only when the source declares it: a `source:`/`url:` line (Web Clipper and defuddle
// frontmatter) or a bare URL on its own line near the top. The first link in the body is usually a citation.
function sourceUrl(text) {
  const head = String(text).split(/\r?\n/).slice(0, 15);
  for (const l of head) {
    const m = l.match(/^\s*(?:source|url|original|link|from|canonical)\s*:\s*["']?(https?:\/\/[^\s)>\]"']+)/i) || l.match(/^\s*<?(https?:\/\/[^\s)>\]"']+)>?\s*$/);
    if (m) return m[1];
  }
  return '';
}
function guessTitle(file, text) {
  const h = String(text).match(/^#\s+(.+)$/m) || String(text).match(/<title>([^<]+)<\/title>/i);
  return sanitizeTitle(h ? h[1] : path.basename(file, path.extname(file)).replace(/[_-]+/g, ' '));
}
function ingestedHashes(notes) { const m = new Map(); for (const n of notes) if (n.fm && n.fm.source_hash) m.set(String(n.fm.source_hash), n.rel); return m; }
function pendingRaw(root = VAULT) {
  const dir = path.join(root, RAW);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.') && e.name !== 'README.md').map((e) => path.join(dir, e.name));
}
// Owners for a source: the classifier's scored projects and areas, then the closest notes by search.
function ingestPlan(file, text, notes, cfg) {
  const sample = String(text).slice(0, 6000);
  const cls = classifyText(sample, notes, cfg);
  // A name or a phrase keyword (score 3+) is a real owner; two stray keywords only count for the best match.
  const strong = cls.scored.filter((s) => s.score >= 3);
  const ownerLinks = (strong.length ? strong : cls.scored.slice(0, 1).filter((s) => s.score >= 2)).slice(0, 3).map((s) => s.name);
  const query = tokenize(sample).reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const top = [...query.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t).join(' ');
  const related = top ? searchNotes(notes.filter((n) => n.fm && !['session', 'review', 'hq', 'todo'].includes(n.fm.type)), top, { limit: 5 }).map((h) => h.name).filter((nm) => !ownerLinks.includes(nm)) : [];
  return { title: guessTitle(file, text), url: sourceUrl(sample), owners: ownerLinks, related, words: tokenize(text).length, secrets: secretHits(text).length };
}
function ingestCreate({ root = VAULT, file, title, notes, cfg, today = ISO(TODAY) }) {
  const abs = path.resolve(file);
  const buf = fs.readFileSync(abs);
  const hash = sha256(buf);
  const seen = ingestedHashes(notes).get(hash);
  if (seen) return { duplicate: seen };
  const text = extractText(abs);
  const plan = ingestPlan(abs, text, notes, cfg);
  const name = sanitizeTitle(title || plan.title);
  const procDir = path.join(root, RAW, 'processed');
  fs.mkdirSync(procDir, { recursive: true });
  let dest = path.join(procDir, path.basename(abs));
  if (fs.existsSync(dest)) dest = path.join(procDir, `${hash.slice(0, 8)}-${path.basename(abs)}`);
  const destRel = path.relative(root, dest).replace(/\\/g, '/');
  const fm = { type: 'resource', created: today, updated: today, source: plan.url || `file:${destRel}`, source_file: destRel, source_hash: hash, ingested: today };
  if (plan.owners[0]) fm.project = `[[${plan.owners[0]}]]`;
  fm.tags = ['source'];
  const body = [
    `# ${name}`, '', INGEST_TODO, '',
    `Use this when: (one line)`, '',
    '## Summary', `(three to six sentences: what the source says, in ${OWNER.name}'s terms)`, '',
    '## Key points', '- ', '',
    '## How it applies', ...(plan.owners.length ? plan.owners.map((o) => `- [[${o}]] — `) : ['- (no owner matched; link one or leave this resource general)']), '',
    '## Related', ...(plan.related.length ? plan.related.map((r) => `- [[${r}]]`) : ['- none found']), '',
    '## Provenance', `- Source: ${plan.url || 'local file'}`, `- Raw file: \`${destRel}\` (local only, gitignored)`, `- Ingested ${today}, sha256 \`${hash.slice(0, 16)}…\`, ${plan.words} words${text ? '' : ' (no text extracted: read the raw file directly)'}`,
  ].join('\n');
  const notePath = uniquePath(path.join(root, F.resources), name);
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(notePath, buildNote(fm, body));
  fs.renameSync(abs, dest);
  return { note: notePath, raw: dest, plan, textChars: text.length };
}
function ingestCli(args) {
  const notes = loadNotes(); const cfg = loadConfig();
  if (args[0] === 'new') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) { console.log('ingest new <file in 0-Inbox/raw> ["<title>"]'); process.exit(2); }
    const r = ingestCreate({ file, title: args.slice(2).join(' '), notes, cfg });
    if (r.duplicate) { console.log(`already ingested as ${r.duplicate} (same sha256); nothing written`); return; }
    console.log(`wrote ${path.relative(VAULT, r.note)}\nmoved raw to ${path.relative(VAULT, r.raw)}`);
    console.log(`owners: ${r.plan.owners.join(', ') || 'none'} · related: ${r.plan.related.join(', ') || 'none'} · ${r.textChars} chars extracted`);
    if (r.plan.secrets) console.log(`WARNING: the source has ${r.plan.secrets} secret-like string(s); do not copy them into the note`);
    console.log(`next: read the raw file, fill Summary, Key points and How it applies, delete the ${INGEST_TODO} marker, run lint`);
    return;
  }
  if (args[0] === 'text') { const f = args[1]; if (!f || !fs.existsSync(f)) { console.log('ingest text <file>'); process.exit(2); } console.log(extractText(f) || '(no text extracted; read the file directly)'); return; }
  const files = pendingRaw();
  const hashes = ingestedHashes(notes);
  console.log(`ingest: ${files.length} file(s) waiting in ${RAW}/`);
  for (const f of files) {
    const h = sha256(fs.readFileSync(f));
    if (hashes.has(h)) { console.log(`- ${path.basename(f)} — already ingested as ${hashes.get(h)}`); continue; }
    const p = ingestPlan(f, extractText(f), notes, cfg);
    console.log(`- ${path.basename(f)} — title "${p.title}" · ${p.words} words · owners: ${p.owners.join(', ') || 'none'} · related: ${p.related.slice(0, 3).join(', ') || 'none'}${p.url ? ` · ${p.url}` : ''}${p.secrets ? ' · SECRET-LIKE STRINGS' : ''}`);
  }
}

// ---------- tests ----------
// ---------- Brain-away: drops written on a second machine (optional; off unless config away_root is set) ----------
// Home only reads Brain-away: the clone pulls, never commits or pushes (its push URL is disabled and git hooks refuse).
// What has been filed lives in this vault, in the ledger note, keyed by drop path and content hash, so a drop the
// laptop edits after filing shows up again as changed.
const AWAY_NOT_DROPS = new Set(['.git', 'Brain', 'node_modules', '.obsidian', '.trash', '_claude', 'ingested', 'hold', 'jobs', '_attachments']);
const AWAY_LEDGER = '_claude/ops/Brain-away Ledger.md';
const AWAY_LINE = /^- (\d{4}-\d{2}-\d{2}) — (filed|skipped)(?: \(([^)]*)\))? — (.+?) — sha256:([0-9a-f-]+)/;
function awayRoot(cfg) { return cfg.away_root || ''; }
function awayLedger(text) {
  const m = new Map();
  for (const l of String(text || '').split('\n')) { const r = l.match(AWAY_LINE); if (r) m.set(r[4], { date: r[1], kind: r[2], reason: r[3] || '', hash: r[5] }); }
  return m;
}
function readAwayLedger() { try { return awayLedger(fs.readFileSync(path.join(VAULT, AWAY_LEDGER), 'utf8')); } catch (_) { return new Map(); } }
function awayDrops(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!AWAY_NOT_DROPS.has(e.name)) walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const buf = fs.readFileSync(p); const m = buf.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) continue;
      const get = (k) => { const r = m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return r ? r[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() : ''; };
      if (!get('target')) continue;
      out.push({ rel: path.relative(root, p).replace(/\\/g, '/'), status: get('status') || 'pending', action: get('action'), target: get('target'), created: get('created'), brainRef: get('brain_ref'), hash: sha256(buf).slice(0, 16) });
    }
  })(root);
  return out.sort((a, b) => String(a.created).localeCompare(String(b.created)) || a.rel.localeCompare(b.rel));
}
// Pending: a drop the laptop marks pending that the ledger lacks, or whose content changed since it was filed.
function awayPending(root, ledger) {
  const L = ledger || readAwayLedger();
  return awayDrops(root).filter((d) => d.status === 'pending').map((d) => { const l = L.get(d.rel); return !l ? d : l.hash !== '-' && l.hash !== d.hash ? { ...d, changed: l.date } : null; }).filter(Boolean);
}
function awayState() { try { return JSON.parse(fs.readFileSync(path.join(VAULT, F.activity, 'away-state.json'), 'utf8')); } catch (_) { return {}; } }
function awayPull(root, wait) {
  const st = awayState(); st.lastPull = Date.now();
  try { fs.writeFileSync(path.join(VAULT, F.activity, 'away-state.json'), JSON.stringify(st) + '\n'); } catch (_) {}
  const a = ['-C', root, 'pull', '--ff-only', '--quiet']; // fast-forward only: the clone never has commits of its own
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (wait) return spawnSync('git', a, { encoding: 'utf8', env });
  const { spawn } = require('child_process'); spawn('git', a, { detached: true, stdio: 'ignore', env, windowsHide: true }).unref(); // never blocks the hook
}
// Session start: count the local clone; refresh it in the background at most once a day.
function awayAnnounce(cfg) {
  const root = awayRoot(cfg); if (!root || !fs.existsSync(path.join(root, '.git'))) return '';
  if (Date.now() - (awayState().lastPull || 0) > 20 * 3600000) awayPull(root, false);
  const p = awayPending(root); if (!p.length) return '';
  const oldest = p.map((d) => d.created).filter(Boolean).sort()[0] || '?';
  return `[brain] ${p.length} laptop drop(s) waiting in Brain-away (oldest ${oldest}). Tell ${OWNER.name}; /brain away files them after he OKs the table.`;
}
function awayRecord(kind, rel, reason, sha) {
  const cfg = loadConfig(); const root = awayRoot(cfg);
  const d = awayDrops(root).find((x) => x.rel === rel);
  if (!d) { console.log(`away: ${rel} is not a drop in ${root} (needs target: frontmatter, outside _claude/ingested/hold/jobs)`); process.exit(1); }
  const p = path.join(VAULT, AWAY_LEDGER);
  const line = `- ${ISO(TODAY)} — ${kind}${kind === 'skipped' ? ` (${String(reason).replace(/[()—\n]/g, ' ').trim()})` : ''} — ${rel} — sha256:${d.hash}${sha ? ` — Brain ${sha.slice(0, 7)}` : ''} — ${d.target}`;
  let text = fs.readFileSync(p, 'utf8').replace(/\s*$/, '\n') + line + '\n';
  fs.writeFileSync(p, setFm(text, { updated: ISO(TODAY) }));
  console.log(`away: ${kind} ${rel}`);
}
function awayCli(args) {
  const cfg = loadConfig(); const root = awayRoot(cfg);
  if (!root || !fs.existsSync(path.join(root, '.git'))) { console.log(`away: no Brain-away clone at ${root || '(config away_root unset)'}`); process.exit(1); }
  const sub = args[0] || 'pending';
  if (sub === 'pending') {
    const r = awayPull(root, true); if (r && r.status) console.log(`away: pull failed, listing the local copy (${(r.stderr || '').trim().split('\n')[0]})`);
    const p = awayPending(root);
    for (const d of p) console.log(`${d.rel} | ${d.action || '?'} | ${d.target} | ${d.created || '?'} | brain_ref ${String(d.brainRef).slice(0, 7)}${d.changed ? ` | CHANGED since filed ${d.changed}` : ''}`);
    console.log(`${p.length} pending`); return;
  }
  if (sub === 'done') { const sha = args[2] || ''; if (!args[1] || !/^[0-9a-f]{7,40}$/.test(sha)) { console.log('usage: away done "<drop path as listed>" <brain commit sha>'); process.exit(2); } return awayRecord('filed', args[1], '', sha); }
  if (sub === 'skip') { if (!args[1] || !args[2]) { console.log('usage: away skip "<drop path as listed>" "<reason>"'); process.exit(2); } return awayRecord('skipped', args[1], args.slice(2).join(' '), ''); }
  console.log('away: pending | done "<drop>" <sha> | skip "<drop>" "<reason>"   (home never writes to Brain-away)'); process.exit(2);
}
function runTests() { const dir = path.join(__dirname, 'test'); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f)); const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }); process.exit(r.status || 0); }

// ---------- main ----------
function main() {
  const [cmd, arg1, ...rest] = process.argv.slice(2);
  // The wall, enforced mechanically: every command except the hooks refuses inside a work session.
  if (cmd !== 'hook') {
    let cfg = null;
    try { cfg = loadConfig(); } catch (_) {}
    if (cfg && isWorkSession(cfg)) {
      refuseWork(cfg);
      process.exit(3);
    }
  }
  if (cmd === 'guard') { console.log('personal session: the vault is available.'); return; }
  switch (cmd) {
    case 'lint': { const r = lint(); process.exit(r.errors.length ? 1 : 0); }
    case 'scan': { const h = scan(arg1); process.exit(h.length ? 1 : 0); }
    case 'next-id': console.log(nextId((arg1 || 'T').toUpperCase() === 'D' ? 'D' : 'T')); break;
    case 'pick': { const p = pickable(loadNotes())[0]; console.log(p ? p.rel : 'none'); break; }
    case 'status': console.log(statusLines(loadNotes()).join('\n')); if (arg1 === '--write') hqWrite(); break;
    case 'hq': hqWrite(); break;
    case 'todo': todoCli([arg1, ...rest].filter((x) => x !== undefined)); break;
    case 'classify': classifyCli([arg1, ...rest].join(' ')); break;
    case 'here': hereCli(arg1); break;
    case 'sweep': sweepCli(arg1 === '--mark'); break;
    case 'hook': hook(arg1); process.exit(0); break;
    case 'import':
      if (arg1 === 'claude-export') importClaudeExport(rest[0]);
      else if (arg1 === 'cowork') importCowork();
      else if (arg1 === 'code-sessions') importCodeSessions(rest.includes('--all'));
      else if (arg1 === 'chat-json') importChatJson(rest[0]);
      else if (arg1 === 'runs') importRuns();
      else { console.log('import: claude-export <file> | cowork | code-sessions | chat-json <file> | runs'); process.exit(2); }
      break;
    case 'search': searchCli([arg1, ...rest].filter((x) => x !== undefined)); break;
    case 'orphans': { const o = findOrphans(loadNotes()); for (const r of o) console.log(`orphan ${r}`); console.log(`${o.length} orphan note(s)`); break; }
    case 'away': awayCli([arg1, ...rest].filter((x) => x !== undefined)); break;
    case 'ingest': ingestCli([arg1, ...rest].filter((x) => x !== undefined)); break;
    case 'test': runTests(); break;
    default: console.log('usage: brain.js guard | lint | scan [path] | next-id T|D | pick | status [--write] | hq | todo [add <text>|--sync] | classify <text> | here [cwd] | sweep [--mark] | search "<query>" [--limit N] [--type T] [--json] | orphans | ingest [new <file> ["<title>"] | text <file>] | away [pending | done "<drop>" <sha> | skip "<drop>" "<reason>"] | hook <session-start|prompt|tool> | import <…> | test'); process.exit(2);
  }
}
module.exports = { sortRunLog, awayPending, awayLedger, awayDrops, transcriptWorkRoot, isPipelineText, tokenize, buildIndex, searchNotes, snippet, findOrphans, extractText, sourceUrl, guessTitle, ingestPlan, ingestCreate, INGEST_TODO, RAW, parseFrontmatter, buildNote, setFm, secretHits, redact, sanitizeTitle, classifyText, classify, projectForCwd, normPath, unquote, yamlValue, firstStatusLine, TODO_RE, todoParse, statusLines, hqMarkdown, lint, scan, matchedWorkRoot, isWorkSession, refuseWork, TYPES, STATUS, REQUIRED, F, VAULT };
if (require.main === module) main();
