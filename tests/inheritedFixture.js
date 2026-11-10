import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './publicationFixture.js';
import { createTrees } from '../src/cli/gitTrees.js';
import { attributeConflicts } from '../src/cli/conflictAttribution.js';

export function inheritedFixture(t, options = {}) {
  const f = fixture(t);
  const file = 'src/b.js';
  const original = Array.from({ length: 60 }, (_, i) => `unique line ${i}\n`).join('');
  const write = text => fs.writeFileSync(path.join(f.folder, file), text);
  write(options.original || original);
  f.command(['add', '.']); f.command(['commit', '-qm', 'Common ancestor']);
  const ancestor = f.command(['rev-parse', 'HEAD']);
  const peerText = (options.original || original).replace('unique line 30', 'peer conflict');
  const pull = f.peer('bob', [file], peerText);
  const baseline = (options.original || original).replace('unique line 30', 'main conflict');
  write(baseline);
  f.command(['commit', '-qam', 'Main advanced']);
  const base = f.command(['rev-parse', 'HEAD']);
  pull.base.sha = ancestor;
  f.fake.store.tip = base;
  const trees = createTrees(f.git);
  return { ...f, trees, file, base, ancestor, pull, baseline, write,
    inspect() {
      const local = trees.snapshot();
      return attributeConflicts(trees, { commit: local.commit, other: pull.head.sha, base: () => base, mine: new Set([file]), inherited: true });
    } };
}

export function customDefault(f) {
  const exec = f.git.exec.bind(f.git);
  f.git.exec = (args, env, ...rest) => exec(args, { ...env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' }, ...rest);
  const commit = f.trees.snapshot().commit;
  const driver = `const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const [base, ours, theirs, size] = process.argv.slice(2);
const first = fs.readFileSync(ours, 'utf8').startsWith('local addition\\n') ? '${commit}' : '${f.base}';
fs.appendFileSync('.git/fixture-default-invocations', 'called\\n');
const result = spawnSync('git', ['merge-file', '--marker-size=' + size, '-L', first, '-L', 'ancestor', '-L', '${f.pull.head.sha}', ours, base, theirs]);
process.exit(result.status ?? 129);
`;
  fs.writeFileSync(path.join(f.folder, '.git/fixture-default-driver.cjs'), driver);
  f.command(['config', 'merge.default', 'fixture']);
  f.command(['config', 'merge.fixture.driver', 'node .git/fixture-default-driver.cjs %O %A %B %L']);
}
