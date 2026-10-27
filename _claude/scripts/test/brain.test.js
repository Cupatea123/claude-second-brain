'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../brain.js');

test('frontmatter: scalars, quoted strings, inline and block lists', () => {
  const text = '---\ntype: task\nproject: "[[Running]]"\npath: \'D:\\Running\'\nblocked_by: ["[[T-002 - X]]", "[[T-003 - Y]]"]\ntags:\n  - a\n  - b\ndigested: false\n---\n# Body\n';
  const { fm, body } = b.parseFrontmatter(text);
  assert.equal(fm.type, 'task');
  assert.equal(fm.project, '[[Running]]');
  assert.equal(fm.path, 'D:\\Running');
  assert.deepEqual(fm.blocked_by, ['[[T-002 - X]]', '[[T-003 - Y]]']);
  assert.deepEqual(fm.tags, ['a', 'b']);
  assert.equal(fm.digested, false);
  assert.equal(body.trim(), '# Body');
});

test('setFm is idempotent — bumping a note repeatedly does not grow blank lines', () => {
  const note = '---\ntype: task\nupdated: 2026-09-16\ntags: []\n---\n\n# Title\n\nBody.\n';
  let t = note;
  for (let i = 0; i < 5; i++) t = b.setFm(t, { updated: '2026-09-17' });
  assert.equal(t, b.setFm(note, { updated: '2026-09-17' }), 'five bumps must equal one');
  assert.match(t, /\n---\n\n# Title\n/, 'exactly one blank line between frontmatter and body');
});

test('buildNote round-trips through parseFrontmatter', () => {
  const fm = { type: 'session', kind: 'chat', project: '[[AI OS]]', messages: 3, digested: false, created: '2026-09-16', updated: '2026-09-16', tags: [] };
  const back = b.parseFrontmatter(b.buildNote(fm, '# T')).fm;
  assert.equal(back.project, '[[AI OS]]');
  assert.equal(back.created, '2026-09-16');
  assert.equal(back.digested, false);
  assert.deepEqual(back.tags, []);
});

test('flow lists survive apostrophes inside quoted items', () => {
  // regression: a quote-counting regex split "What's Next" in the wrong place, merged two aliases,
  // and the next write persisted the damage as escaped quotes inside a single string.
  const aliases = ["What's Next", "What's Next?", 'whats-next'];
  const back = b.parseFrontmatter(b.buildNote({ type: 'project', aliases, created: '2026-09-17', updated: '2026-09-17' }, '# x')).fm;
  assert.deepEqual(back.aliases, aliases);
  const twice = b.parseFrontmatter(b.buildNote({ type: 'project', aliases: back.aliases, created: '2026-09-17', updated: '2026-09-17' }, '# x')).fm;
  assert.deepEqual(twice.aliases, aliases, 'a second round trip must not accumulate escapes');
  assert.deepEqual(b.parseFrontmatter('---\ntags: [a, "b, still one", \'c\']\n---\n').fm.tags, ['a', 'b, still one', 'c']);
});

test('a Windows path survives a write/read round trip (single backslashes)', () => {
  // regression: JSON.stringify wrote "D:\\Running" and the old reader returned it with both backslashes,
  // so projectForCwd stopped matching D:\Running and `here` said no owner.
  for (const p of ['D:\\Running', 'C:\\Users\\alex\\.claude', "D:\\What's Next"]) {
    const back = b.parseFrontmatter(b.buildNote({ type: 'project', path: p, created: '2026-09-16', updated: '2026-09-16' }, '# x')).fm;
    assert.equal(back.path, p);
    assert.equal(b.normPath(back.path).includes('//'), false);
  }
});

test('sanitizeTitle strips reserved characters and apostrophes', () => {
  assert.equal(b.sanitizeTitle("What's Next: v2? <draft>"), 'Whats Next v2 draft');
});

test('secret scan catches keys and ignores config flags and markers', () => {
  assert.equal(b.secretHits('api_key=abcdefghijklmnop').length, 1);
  assert.equal(b.secretHits('token: true').length, 0);
  assert.equal(b.secretHits('approval: required').length, 0);
  assert.equal(b.secretHits('the password field is 6 chars').length, 0);
  assert.equal(b.secretHits('-----BEGIN RSA PRIVATE KEY-----').length, 1);
  assert.equal(b.secretHits('AKIAABCDEFGHIJKLMNOP').length, 1);
  assert.equal(b.secretHits('ghp_' + 'a'.repeat(36)).length, 1);
  assert.equal(b.secretHits('secret = "hunter2hunter2" brain:allow-secret-pattern').length, 0);
});

test('redact masks values but keeps the key name', () => {
  assert.equal(b.redact('use api_key=abcdefghijklmnop now'), 'use api_key=[redacted] now');
  assert.match(b.redact('sk-' + 'x'.repeat(30)), /\[redacted\]/);
});

test('classifyText: addition, new, ambiguous, unknown', () => {
  const notes = [
    { fm: { type: 'project', status: 'active', aliases: ['Running OS'], path: 'D:\\Running' }, base: 'Running', rel: '1-Projects/Running/Running.md', text: '' },
    { fm: { type: 'project', status: 'idea', aliases: [], path: '' }, base: 'Greenleaf', rel: '1-Projects/Greenleaf/Greenleaf.md', text: '' },
  ];
  const cfg = { projects: { Running: ['interval run', 'pace', 'marathon'], Greenleaf: ['shopify', 'supplement brand'] } };
  assert.equal(b.classifyText('fix the interval run pace capture', notes, cfg).verdict, 'addition');
  assert.equal(b.classifyText('I want to start a new business selling candles', notes, cfg).verdict, 'new');
  assert.equal(b.classifyText('what time is it', notes, cfg).verdict, 'unknown');
  // an explicit new-venture phrase never yields "addition", however strong the keyword match:
  // the matched words may only be the topic of the new thing.
  assert.equal(b.classifyText('new project: Greenleaf shopify store', notes, cfg).verdict, 'ambiguous');
  assert.equal(b.classifyText('I want to start a podcast about marathon running', notes, cfg).verdict, 'ambiguous');
  assert.equal(b.classifyText('I want to build a mobile app for tracking gym workouts', notes, cfg).verdict, 'new');
  // one specific phrase is enough to place work; one generic word is not
  assert.equal(b.classifyText('fix the interval run capture', notes, cfg).verdict, 'addition');
  assert.equal(b.classifyText('keep a steady pace', notes, cfg).verdict, 'unknown');
  // "start a <qualifier> <thing>": the thing is often a product noun, and words sit between the
  // article and it. Both were missing until 2026-09-17, so "start a running newsletter" read as
  // an addition to Running.
  assert.equal(b.classifyText('start a running newsletter', notes, cfg).newSignal, true);
  assert.equal(b.classifyText('starting a faceless youtube channel', notes, cfg).newSignal, true);
  // and the qualifier slot must not swallow a sentence and turn ordinary work into a new venture
  assert.equal(b.classifyText('start a run of the interval run and keep the pace', notes, cfg).newSignal, false);
});

test('projectForCwd maps a folder to the deepest owning project', () => {
  const notes = [
    { fm: { type: 'project', status: 'active', aliases: [], path: 'D:\\Running' }, base: 'Running', rel: '1-Projects/Running/Running.md', text: '' },
    { fm: { type: 'area', status: 'active', aliases: [], path: 'D:\\Brain' }, base: 'AI OS', rel: '2-Areas/AI OS/AI OS.md', text: '' },
  ];
  assert.equal(b.projectForCwd('D:/Running/Plans', notes, {}).name, 'Running');
  assert.equal(b.projectForCwd('d:\\brain\\Tasks', notes, {}).name, 'AI OS');
  assert.equal(b.projectForCwd('C:/Users/alex/Claude/Skills', notes, {}), null);
});

test('TODO line grammar', () => {
  const m = '- [ ] 2026-09-16 — Decide rest per week — owner: [[Running]] → [[T-013 - Decide rest per week]]'.match(b.TODO_RE);
  assert.ok(m);
  assert.equal(m[2], '2026-09-16');
  assert.equal(m[3], 'Decide rest per week');
  assert.equal(m[4], '[[Running]]');
  assert.match(m[5], /T-013/);
  const plain = '- [ ] 2026-09-16 — buy a domain for Greenleaf'.match(b.TODO_RE);
  assert.ok(plain);
  assert.equal(plain[5], undefined);
});

test('HQ summaries never emit a half-cut wikilink or a table-breaking pipe', () => {
  const long = 'x'.repeat(200);
  const note = { body: `## Status now\n- 2026-09-16 — Step 2 open: [[T-002 - Write the cloud VM vs Mac mini comparison]] and \`code\` and a | pipe ${long}\n\n## Assets\n` };
  const s = b.firstStatusLine(note);
  assert.equal(s.includes('[['), false);
  assert.equal(s.includes(']]'), false);
  assert.equal(s.includes('|'), false);
  assert.ok(s.length <= 151);
  assert.equal(s.startsWith('Step 2 open: T-002 - Write'), true);
});

test('a work session is recognised from the folder it started in, whatever the cwd is', () => {
  const cfg = { work_roots: ['C:\\Users\\alex\\Downloads\\Work', 'D:\\Work notes'] };
  // the transcript folder name is the slugified starting cwd; comparing slugs needs no decoding
  const slug = (s) => s.replace(/[^A-Za-z0-9]/g, '-');
  assert.equal(slug('D:\\Work notes'), 'D--Work-notes');
  assert.equal(slug('C:\\Users\\alex\\Claude\\Skills'), 'C--Users-alex-Claude-Skills');
  const matches = (s) => cfg.work_roots.some((r) => s === slug(r) || s.startsWith(slug(r) + '-'));
  assert.equal(matches('D--Work-notes'), true);
  assert.equal(matches('D--Work-notes-docs'), true);
  assert.equal(matches('C--Users-alex-Claude-Skills'), false);
  assert.equal(matches('D--Brain'), false);
});

test('the refusal names the work root it matched and the way out', () => {
  const cfg = { work_roots: ['C:\\Users\\alex\\Downloads\\Work', 'D:\\Work notes'] };
  // no CLAUDE_CODE_SESSION_ID here, so it falls back to the cwd, subfolders included
  assert.equal(b.matchedWorkRoot(cfg, 'D:\\Work notes\\docs'), 'D:\\Work notes');
  assert.equal(b.matchedWorkRoot(cfg, 'D:\\Brain'), null);
  assert.equal(b.isWorkSession(cfg, 'C:\\Users\\alex\\Downloads\\Work'), true);
  const said = [];
  const real = console.log;
  console.log = (s) => said.push(String(s));
  try { b.refuseWork(cfg, 'D:\\Work notes'); } finally { console.log = real; }
  const out = said.join('\n');
  // a bare refusal reads as a broken brain: it must name the folder and where to go instead
  assert.match(out, /D:\\Work notes/);
  assert.ok(out.includes(b.VAULT), `refusal should point at ${b.VAULT}`);
});

test('lint on the live vault reports zero errors (skip when vault is mid-migration)', (t) => {
  const r = b.lint({ quiet: true });
  if (process.env.BRAIN_ALLOW_LINT_ERRORS) { t.diagnostic(`${r.errors.length} errors (allowed)`); return; }
  assert.equal(r.errors.length, 0, r.errors.slice(0, 10).join('\n'));
});
