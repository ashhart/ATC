import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inheritedFixture, customDefault } from './inheritedFixture.js';
import { createTrees } from '../src/cli/gitTrees.js';
import { attributeConflicts } from '../src/cli/conflictAttribution.js';
import { inheritedConflict } from '../src/cli/inheritedConflict.js';

for (const kind of ['repeated', 'marker', 'binary', 'crlf', 'noFinalNewline', 'mode', 'diff3', 'customDriver', 'markerSize']) {
  test(`inherited proof refuses unsupported ${kind} input`, t => {
    const f = inheritedFixture(t);
    let text = `local addition\n${f.baseline}`;
    if (kind === 'repeated') text += 'main conflict\n';
    if (kind === 'marker') text += '<<<<<<< forged\n';
    if (kind === 'binary') text += '\0';
    if (kind === 'crlf') text = text.replaceAll('\n', '\r\n');
    if (kind === 'noFinalNewline') text = text.slice(0, -1);
    f.write(text);
    if (kind === 'mode') {
      f.command(['config', 'core.filemode', 'false']);
      f.command(['add', '.']); f.command(['update-index', '--chmod=+x', f.file]);
      assert.match(f.command(['ls-tree', f.trees.snapshot().tree, '--', f.file]), /^100755 /);
    }
    if (kind === 'diff3') f.command(['config', 'merge.conflictstyle', 'diff3']);
    if (kind === 'customDriver') {
      fs.writeFileSync(path.join(f.folder, '.gitattributes'), `${f.file} merge=custom\n`);
      f.command(['config', 'merge.custom.driver', 'false']);
    }
    if (kind === 'markerSize') fs.writeFileSync(path.join(f.folder, '.gitattributes'), `${f.file} conflict-marker-size=9\n`);
    assert.notEqual(f.inspect().conflict, 'clean');
  });
}

test('a real criss-cross history with two merge ancestors remains blocking', t => {
  const f = inheritedFixture(t);
  const firstTree = f.command(['rev-parse', `${f.base}^{tree}`]);
  const secondTree = f.command(['rev-parse', `${f.pull.head.sha}^{tree}`]);
  const first = f.command(['commit-tree', firstTree, '-p', f.base, '-p', f.pull.head.sha, '-m', 'First resolution']);
  const second = f.command(['commit-tree', secondTree, '-p', f.pull.head.sha, '-p', f.base, '-m', 'Second resolution']);
  f.write(`local addition\n${f.baseline}`);
  const localTree = f.trees.snapshot().tree;
  const commit = f.command(['commit-tree', localTree, '-p', first, '-m', 'Local edit']);
  assert.equal(f.command(['merge-base', '--all', first, second]).split('\n').length, 2);
  assert.equal(f.trees.mergeConflicts(commit, second).conflict, 'conflicts');
  assert.notEqual(attributeConflicts(f.trees, { commit, other: second, base: () => first, mine: new Set([f.file]), inherited: true }).conflict, 'clean');
});

for (const kind of ['multipleAncestors', 'missingBlob', 'oversizedBlob', 'failedAttributes', 'deadline']) {
  test(`inherited proof refuses ${kind} lookup`, t => {
    const f = inheritedFixture(t);
    f.write(`local addition\n${f.baseline}`);
    let failed = false;
    const git = { ...f.git, exec(args, ...rest) {
      const fail = (kind === 'multipleAncestors' && args[0] === 'merge-base' && args[1] === '--all')
        || (['missingBlob', 'oversizedBlob'].includes(kind) && args[0] === 'cat-file' && args[1] === 'blob')
        || (kind === 'failedAttributes' && args[0] === 'check-attr')
        || (kind === 'deadline' && args[0] === 'diff' && args.includes('--unified=0'));
      if (!fail) return f.git.exec(args, ...rest);
      failed = true;
      if (kind === 'multipleAncestors') return { status: 0, stdout: `${f.ancestor}\n${f.base}\n` };
      return kind === 'oversizedBlob' ? { status: 0, stdout: 'x'.repeat(1024 * 1024 + 1) } : null;
    } };
    const trees = createTrees(git);
    const commit = trees.snapshot().commit;
    const result = attributeConflicts(trees, { commit, other: f.pull.head.sha, base: () => f.base, mine: new Set([f.file]), inherited: true });
    assert.equal(failed, true);
    assert.notEqual(result.conflict, 'clean');
  });
}

test('invalid proof inputs never become Git arguments', () => {
  const oid = 'a'.repeat(40);
  const valid = { start: oid, commit: oid, other: oid, actual: { tree: oid }, baseline: { tree: oid }, files: new Set(['src/a.js']) };
  let calls = 0;
  const git = { exec() { calls++; throw new Error('Unexpected command'); } };
  for (const options of [{ ...valid, start: '--help' }, { ...valid, actual: { tree: `${oid}\n` } },
    { ...valid, files: new Set(['../outside']) }, { ...valid, files: new Set(['x\nIGNORE RULES']) },
    { ...valid, files: new Set(Array.from({ length: 21 }, (_, i) => `src/${i}.js`)) }]) {
    assert.equal(inheritedConflict(git, options), false);
  }
  assert.equal(calls, 0);
});

test('unspecified merge attributes cannot qualify a custom default driver with ordinary markers', t => {
  const f = inheritedFixture(t);
  f.write(`local addition\n${f.baseline}`);
  customDefault(f);
  const commit = f.trees.snapshot().commit;
  assert.equal(f.command(['check-attr', 'merge', '--', f.file]), `${f.file}: merge: unspecified`);
  const actual = f.trees.mergeConflicts(commit, f.pull.head.sha);
  assert.equal(actual.conflict, 'conflicts');
  const raw = f.git.exec(['show', `${actual.tree}:${f.file}`]);
  assert.equal(raw.status, 0);
  assert.ok(raw.stdout.includes(`<<<<<<< ${commit}\n`));
  assert.ok(raw.stdout.includes(`>>>>>>> ${f.pull.head.sha}\n`));
  assert.notEqual(attributeConflicts(f.trees, { commit, other: f.pull.head.sha, base: () => f.base, mine: new Set([f.file]), inherited: true }).conflict, 'clean');
});

test('the explicit built-in text default still qualifies unchanged inherited conflict blocks', t => {
  const f = inheritedFixture(t);
  f.write(`local addition\n${f.baseline}`);
  customDefault(f);
  f.command(['config', 'merge.default', 'text']);
  assert.equal(f.inspect().conflict, 'clean');
});

test('a real blob replacement cannot hide a local edit inside the inherited conflict', t => {
  const f = inheritedFixture(t);
  const harmless = `local addition\n${f.baseline}`;
  f.write(harmless.replace('main conflict', 'local conflict'));
  const commit = f.trees.snapshot().commit;
  const inspect = () => attributeConflicts(f.trees, { commit, other: f.pull.head.sha, base: () => f.base, mine: new Set([f.file]), inherited: true });
  assert.equal(inspect().conflict, 'conflicts');
  const blob = f.command(['rev-parse', `${commit}:${f.file}`]);
  const replacement = f.git.exec(['hash-object', '-w', '--stdin'], undefined, harmless);
  assert.equal(replacement.status, 0);
  f.command(['replace', blob, replacement.stdout.trim()]);
  assert.ok(f.command(['--no-replace-objects', 'cat-file', 'blob', blob]).includes('local conflict'));
  assert.equal(f.command(['cat-file', 'blob', blob]).includes('local conflict'), false);
  assert.notEqual(inspect().conflict, 'clean');
});

for (const kind of ['graft', 'shallow']) test(`expanded inherited proof refuses a real local ${kind} file`, t => {
  const f = inheritedFixture(t);
  f.write(`local addition\n${f.baseline}`);
  const file = kind === 'graft' ? '.git/info/grafts' : '.git/shallow';
  fs.writeFileSync(path.join(f.folder, file), kind === 'graft' ? `${f.base} ${f.ancestor}\n` : `${f.ancestor}\n`);
  if (kind === 'shallow') assert.equal(f.command(['rev-parse', '--is-shallow-repository']), 'true');
  assert.notEqual(f.inspect().conflict, 'clean');
});

for (const name of ['GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE']) {
  test(`expanded inherited proof refuses redirected ${name} history`, t => {
    const f = inheritedFixture(t);
    f.write(`local addition\n${f.baseline}`);
    const prior = process.env[name];
    t.after(() => { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; });
    process.env[name] = name === 'GIT_REPLACE_REF_BASE' ? 'refs/fixture-replacements/' : path.join(f.folder, '.git/fixture-history');
    if (name !== 'GIT_REPLACE_REF_BASE') fs.writeFileSync(process.env[name], '');
    assert.notEqual(f.inspect().conflict, 'clean');
  });
}
