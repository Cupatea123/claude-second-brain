'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../brain.js');

const note = (rel, fm, body) => {
  const text = b.buildNote(fm, body);
  const p = b.parseFrontmatter(text);
  return { rel, abs: rel, base: path.basename(rel, '.md'), text, fm: p.fm, body: p.body };
};
const D = { created: '2026-10-14', updated: '2026-10-14' };
const VAULT_NOTES = () => [
  note('2-Areas/Running/Running.md', { type: 'area', status: 'active', cadence: 'daily', next: 'x', aliases: ['Jogging'], ...D }, '# Running\n\n## Status now\n- Rest per week is not locked yet.\n'),
  note('3-Resources/Pomodoro Timer.md', { type: 'resource', source: 'live', ...D }, '# Pomodoro Timer\n\nRuns on Linux, macOS or WSL2. Persistent process with memory.\n'),
  note('3-Resources/Loop Engineering.md', { type: 'resource', source: 'live', ...D }, '# Loop Engineering\n\nAgents that loop over a task list. See [[Pomodoro Timer]].\n'),
  note('Tasks/T-013 - Decide rest per week.md', { type: 'task', status: 'ready', project: '[[Running]]', owner: 'me', priority: 'p1', approval: 'none', ...D }, '# Decide rest per week\n\n## Done when\n- [ ] a dollar rest per week is written down\n'),
];

test('tokenize drops stopwords, punctuation and plural s', () => {
  assert.deepEqual(b.tokenize('What are the weeks, and the REST?'), ['week', 'rest']);
  assert.deepEqual(b.tokenize('class glass'), ['class', 'glass'], 'ss endings are not plurals');
});

test('search ranks the note named after the query first and returns a snippet', () => {
  const hits = b.searchNotes(VAULT_NOTES(), 'pomodoro timer');
  assert.equal(hits[0].name, 'Pomodoro Timer');
  assert.ok(hits.some((h) => h.name === 'Loop Engineering'), 'a note that links to it also matches');
  assert.match(hits[0].snippet, /WSL2|Persistent/);
  assert.equal(hits[0].snippet.startsWith('#'), false, 'the H1 is not a useful snippet');
});

test('search: every term beats one term, type filter, no match, limit', () => {
  const hits = b.searchNotes(VAULT_NOTES(), 'rest per week');
  assert.equal(hits[0].name, 'T-013 - Decide rest per week');
  assert.deepEqual(b.searchNotes(VAULT_NOTES(), 'rest', { type: 'area' }).map((h) => h.name), ['Running']);
  assert.deepEqual(b.searchNotes(VAULT_NOTES(), 'zzzunknownword'), []);
  assert.deepEqual(b.searchNotes(VAULT_NOTES(), 'the and of'), [], 'stopwords alone match nothing');
  assert.equal(b.searchNotes(VAULT_NOTES(), 'rest week agent', { limit: 2 }).length, 2);
});

test('orphans: a note nothing links to is reported; frontmatter links and aliases count; logs are exempt', () => {
  const notes = [
    ...VAULT_NOTES(),
    note('Sessions/2026-10-14 - x.md', { type: 'session', source: 'live', kind: 'interactive', ...D }, '# x\n'),
    note('3-Resources/Alone.md', { type: 'resource', source: 'live', ...D }, '# Alone\n\nNo one links here. [[Alone]] (a self link does not count)\n'),
    note('3-Resources/Via Alias.md', { type: 'resource', source: 'live', aliases: ['VA'], ...D }, '# Via Alias\n'),
    note('3-Resources/Linker.md', { type: 'resource', source: 'live', ...D }, '# Linker\n\n[[VA|see]] and [[Loop Engineering#Facts]]\n'),
  ];
  const o = b.findOrphans(notes);
  assert.ok(o.includes('3-Resources/Alone.md'));
  assert.ok(o.includes('3-Resources/Linker.md'));
  assert.equal(o.includes('3-Resources/Via Alias.md'), false, 'alias link counts');
  assert.equal(o.includes('3-Resources/Loop Engineering.md'), false, 'heading link counts');
  assert.equal(o.includes('3-Resources/Pomodoro Timer.md'), false);
  assert.ok(o.includes('Tasks/T-013 - Decide rest per week.md'), 'linking out to Running does not make T-013 linked');
  assert.equal(o.includes('Sessions/2026-10-14 - x.md'), false, 'sessions are exempt');
  assert.equal(o.includes('2-Areas/Running/Running.md'), false, 'areas are exempt (HQ links them)');
});

test('extractText strips HTML and transcript timing; sourceUrl and guessTitle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-x-'));
  const html = path.join(dir, 'page.html');
  fs.writeFileSync(html, '<html><head><title>Race Day Rules</title><style>p{}</style></head><body><p>Taper &amp; long runs</p><script>x()</script></body></html>');
  const t = b.extractText(html);
  assert.match(t, /Taper & long runs/);
  assert.equal(/<|script|p\{\}/.test(t), false);
  const vtt = path.join(dir, 'talk.vtt');
  fs.writeFileSync(vtt, 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello runners\n\n2\n00:00:03.000 --> 00:00:05.000\nrest first\n');
  assert.equal(b.extractText(vtt), 'Hello runners rest first');
  assert.equal(b.sourceUrl('---\nsource: "https://example.com/a?b=1"\n---\nbody'), 'https://example.com/a?b=1');
  assert.equal(b.sourceUrl('# T\nhttps://example.com/page\n'), 'https://example.com/page');
  assert.equal(b.sourceUrl('# T\nBuilt on the [LLM Wiki](https://gist.github.com/x) pattern.'), '', 'a citation in the body is not the origin');
  assert.equal(b.guessTitle(html, fs.readFileSync(html, 'utf8')), 'Race Day Rules');
  assert.equal(b.guessTitle(path.join(dir, 'my_saved-article.txt'), 'no heading'), 'my saved article');
});

test('ingest: writes a linted source note with provenance, links owners, moves the raw file, refuses duplicates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-'));
  const raw = path.join(root, b.RAW);
  fs.mkdirSync(raw, { recursive: true });
  const src = path.join(raw, 'taper.md');
  const content = '# How marathon tapering works\n\nOriginal: https://example.com/taper\n\nJogging under a trailing taper means rest per week must shrink as the account nears the limit. Pomodoro Timer is unrelated.\n';
  fs.writeFileSync(src, content);
  const cfg = { projects: { Running: ['taper', 'marathon', 'rest per week'] } };
  const notes = VAULT_NOTES();
  const r = b.ingestCreate({ root, file: src, notes, cfg, today: '2026-10-14' });
  assert.ok(r.note && fs.existsSync(r.note));
  assert.equal(path.basename(r.note), 'How marathon tapering works.md');
  assert.equal(path.relative(root, r.note).replace(/\\/g, '/'), '3-Resources/How marathon tapering works.md');
  assert.equal(fs.existsSync(src), false, 'raw file moved');
  assert.ok(fs.existsSync(path.join(raw, 'processed', 'taper.md')));
  const text = fs.readFileSync(r.note, 'utf8');
  const { fm, body } = b.parseFrontmatter(text);
  assert.equal(fm.type, 'resource');
  assert.equal(fm.source, 'https://example.com/taper');
  assert.equal(fm.source_file, '0-Inbox/raw/processed/taper.md');
  assert.match(fm.source_hash, /^[0-9a-f]{64}$/);
  assert.equal(fm.project, '[[Running]]');
  for (const k of [...b.REQUIRED['*'], ...b.REQUIRED.resource]) assert.ok(k in fm, `required key ${k}`);
  assert.match(body, /- \[\[Running\]\] — /);
  assert.ok(body.includes(b.INGEST_TODO), 'skeleton is marked until Claude fills it in');
  assert.equal(b.secretHits(text).length, 0);
  // the same bytes again are a duplicate, even under another name
  fs.writeFileSync(path.join(raw, 'copy.md'), content);
  const ingested = note('3-Resources/How marathon tapering works.md', fm, body);
  const again = b.ingestCreate({ root, file: path.join(raw, 'copy.md'), notes: [...notes, ingested], cfg });
  assert.equal(again.duplicate, '3-Resources/How marathon tapering works.md');
  assert.ok(fs.existsSync(path.join(raw, 'copy.md')), 'a duplicate is left where it was');
});

test('ingest: a source with no owner match still files, with no project key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-'));
  fs.mkdirSync(path.join(root, b.RAW), { recursive: true });
  const src = path.join(root, b.RAW, 'sourdough.txt');
  fs.writeFileSync(src, 'Sourdough starter needs flour and water fed daily.');
  const r = b.ingestCreate({ root, file: src, notes: VAULT_NOTES(), cfg: { projects: {} }, today: '2026-10-14' });
  const { fm } = b.parseFrontmatter(fs.readFileSync(r.note, 'utf8'));
  assert.equal('project' in fm, false);
  assert.equal(fm.source, 'file:0-Inbox/raw/processed/sourdough.txt');
});
