import { attributeConflicts } from './conflictAttribution.js';
import { createTrees } from './gitTrees.js';
import { hasTime } from './timeBudget.js';
import { createPublicationCache, publicationKey } from './publicationCache.js';
import { publicationPulls, samePublicationPulls } from './publicationRead.js';
import { publicationGit } from './publicationGit.js';
import { potentialOverlap } from './potentialOverlap.js';

export function inspectPublication(context, base, workingFiles) {
  const unknown = { complete: false, conflict: false };
  const pulls = publicationPulls(context.snapshot.pullMetadata, context.repository);
  const git = publicationGit(context);
  const trees = createTrees(git);
  if (!pulls || !trees || context.snapshot.partial) return unknown;
  const local = trees.snapshot();
  if (!local) return unknown;
  let remote;
  try { remote = git.remoteFor(context.repository); } catch { return unknown; }
  if (!remote && pulls.length) return unknown;
  const cache = context.cache ? createPublicationCache(git, context.repository, context.env) : null;
  const clean = cache?.read() || new Set();
  let complete = true;
  let conflict = false;
  let checks = 0;
  let fetches = 0;
  for (const pull of pulls) {
    const key = publicationKey(context.repository, base, local, pull);
    if (!key) { complete = false; continue; }
    if (clean.has(key)) continue;
    if (!hasTime(context.gh, 3000)) { complete = false; break; }
    let head = knownHead(git, pull.head);
    if (!head && fetches < 10) { fetches++; head = trees.fetchPull(remote, pull.number); }
    if (head !== pull.head) { complete = false; continue; }
    const files = trees.changedSince(base, head);
    if (!files || files.size > 1000000) { complete = false; continue; }
    if (!potentialOverlap(workingFiles, files)) {
      clean.add(key);
      continue;
    }
    if (checks >= (cache ? 10 : 300)) { complete = false; continue; }
    checks++;
    const result = attributeConflicts(trees, { commit: local.commit, other: head, base: () => base, mine: workingFiles });
    if (result.conflict === 'clean' && result.cacheable !== false) clean.add(key);
    else if (result.conflict === 'clean') continue;
    else if (result.conflict === 'conflicts') conflict = true;
    else complete = false;
  }
  cache?.write(clean);
  const inventory = trees.worktreeInventory();
  const peers = [];
  if (!inventory.complete) complete = false;
  for (const worktree of inventory.entries) {
    if (!hasTime(context.gh, 2000)) { complete = false; break; }
    const theirs = trees.snapshot(worktree.path);
    const files = theirs && trees.changedSince(base, theirs.commit, worktree.path);
    if (!files) { complete = false; continue; }
    peers.push({ ...worktree, head: theirs.head, tree: theirs.tree });
    if (!potentialOverlap(workingFiles, files)) continue;
    const result = attributeConflicts(trees, { commit: local.commit, other: theirs.commit, base: () => base, mine: workingFiles });
    if (result.conflict === 'conflicts') conflict = true;
    else if (result.conflict !== 'clean') complete = false;
  }
  if (complete && !conflict) {
    try {
      if (!hasTime(context.gh, 2000)) return unknown;
      const observed = context.reader.openPulls();
      const current = publicationPulls(observed.items, context.repository);
      const after = trees.snapshot();
      complete = !observed.partial && !observed.timed && samePublicationPulls(pulls, current)
        && after?.head === local.head && after?.tree === local.tree;
      const currentTrees = trees.worktreeInventory();
      if (!currentTrees.complete || JSON.stringify(currentTrees.entries) !== JSON.stringify(inventory.entries)) complete = false;
      for (const peer of peers) {
        const fresh = trees.snapshot(peer.path);
        if (!fresh || fresh.head !== peer.head || fresh.tree !== peer.tree) complete = false;
      }
    } catch { complete = false; }
  }
  return { complete, conflict };
}

function knownHead(git, head) {
  const result = git.exec(['cat-file', '-t', head]);
  return result?.status === 0 && result.stdout === 'commit\n' ? head : null;
}
