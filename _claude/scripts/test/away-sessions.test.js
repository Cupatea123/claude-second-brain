'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../brain.js');

const drop = (fm) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# x\n`;

test('awayPending counts pending drops and ignores ingested, hold, _claude and non-drops', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-'));
  const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('1-Projects/Blog/2026-10-03 1747 - append - Blog.md', drop({ target: '"1-Projects/Blog/Blog.md"', action: 'append', status: 'pending', created: '2026-10-03' }));
  put('Tasks/2026-10-10 0847 - create - T-NEW - X.md', drop({ target: '"Tasks/T-NEW - X.md"', action: 'create', created: '2026-10-10' })); // no status = pending
  put('Sessions/2026-10-10 0932 - session - Skipped.md', drop({ target: '"Sessions/x.md"', action: 'session', status: 'skip', created: '2026-10-10' }));
  put('ingested/Tasks/old.md', drop({ target: '"Tasks/T-001.md"', status: 'ingested' }));
  put('hold/Resume Projects Evidence.md', drop({ status: 'hold', target: '"3-Resources/x.md"' }));
  put('_claude/templates/Drop.md', drop({ target: '"1-Projects/<Project>/<Note>.md"', status: 'pending' }));
  put('README.md', '---\ntype: protocol\n---\n# README\n');
  const p = b.awayPending(root, new Map()).map((d) => d.rel).sort();
  assert.deepEqual(p, ['1-Projects/Blog/2026-10-03 1747 - append - Blog.md', 'Tasks/2026-10-10 0847 - create - T-NEW - X.md']);
  assert.deepEqual(b.awayPending(path.join(root, 'missing')), []);
});

test('transcripts stored under a work root are work, others are not', () => {
  const cfg = { work_roots: [String.raw`D:\Work notes`, String.raw`C:\Users\alex\Downloads\Work`] };
  assert.ok(b.transcriptWorkRoot(cfg, { slug: 'D--Work-notes' }));
  assert.ok(b.transcriptWorkRoot(cfg, { slug: 'C--Users-alex-Downloads-Work-sub' }));
  assert.equal(b.transcriptWorkRoot(cfg, { slug: 'D--Brain' }), null);
  assert.equal(b.transcriptWorkRoot(cfg, { slug: 'D--Projects-Blog' }), null);
});

test('pipeline prompts are recognised by config regex', () => {
  const cfg = { pipeline_prompts: ['^You write the script for one YouTube Short', '^Reply with just OK$'] };
  assert.ok(b.isPipelineText(cfg, 'You write the script for one YouTube Short. Reply with JSON'));
  assert.ok(b.isPipelineText(cfg, 'Reply with just OK'));
  assert.equal(b.isPipelineText(cfg, 'Can you write me a YouTube Short script?'), false);
  assert.equal(b.isPipelineText({}, 'anything'), false);
});

test('sortRunLog keeps run lines newest first wherever they arrive', () => {
  const text = '---\ntype: runlog\n---\n\n# Log\n\nNewest first.\n\n- 2026-09-16 16:39 — ok — a\n- 2026-09-09 21:45 — draft\n';
  const out = b.sortRunLog(text, '- 2026-10-14 12:52 — ok — b');
  const rows = out.split('\n').filter((l) => l.startsWith('- 20')).map((l) => l.slice(2, 12));
  assert.deepEqual(rows, ['2026-10-14', '2026-09-16', '2026-09-09']);
  assert.ok(out.includes('Newest first.\n\n- 2026-10-14'), 'rows stay where the first one was');
});

test('the vault ledger hides filed drops and resurfaces ones changed after filing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'away-l-'));
  const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('Tasks/a.md', drop({ target: '"Tasks/T-1.md"', action: 'create', created: '2026-10-01' }));
  put('Tasks/b.md', drop({ target: '"Tasks/T-2.md"', action: 'create', created: '2026-10-02' }));
  put('Tasks/c.md', drop({ target: '"Tasks/T-3.md"', action: 'create', created: '2026-10-03' }));
  const h = Object.fromEntries(b.awayDrops(root).map((d) => [d.rel, d.hash]));
  const ledger = b.awayLedger([
    `- 2026-10-14 — filed — Tasks/a.md — sha256:${h['Tasks/a.md']} — Brain abc1234 — Tasks/T-1.md`,
    '- 2026-10-14 — skipped (personal document) — Tasks/b.md — sha256:0000000000000000 — Tasks/T-2.md',
  ].join('\n'));
  assert.equal(ledger.get('Tasks/b.md').reason, 'personal document');
  const p = b.awayPending(root, ledger);
  assert.deepEqual(p.map((d) => d.rel), ['Tasks/b.md', 'Tasks/c.md'], 'a is filed and unchanged; b changed since the ledger line; c is new');
  assert.equal(p[0].changed, '2026-10-14');
  assert.equal(p[1].changed, undefined);
});
