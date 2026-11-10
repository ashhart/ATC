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
      return attributeConflicts(trees, { commit: local.commit, other: pull.head.sha, base: () => base, mine: new Set([file]) });
    } };
}
