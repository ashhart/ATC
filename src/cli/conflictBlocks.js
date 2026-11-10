const marker = /^(?:<{7}|={7}|>{7}|\|{7})/;

export function conflictBlocks(lines, first, second) {
  const blocks = [];
  let block = null;
  let side = null;
  for (const line of lines) {
    if (line === `<<<<<<< ${first}` && !block) { block = { ours: [], theirs: [] }; side = 'ours'; }
    else if (line === '=======' && side === 'ours') side = 'theirs';
    else if (line === `>>>>>>> ${second}` && side === 'theirs') {
      if (!block.ours.length || !block.theirs.length || blocks.length >= 100) return null;
      blocks.push(block); block = null; side = null;
    } else if (marker.test(line)) return null;
    else if (side) block[side].push(line);
  }
  return !block && blocks.length ? blocks : null;
}

export function uniqueRange(lines, needle) {
  if (!needle.length) return null;
  const prefix = new Array(needle.length).fill(0);
  for (let i = 1, j = 0; i < needle.length; i++) {
    while (j && needle[i] !== needle[j]) j = prefix[j - 1];
    if (needle[i] === needle[j]) j++;
    prefix[i] = j;
  }
  let found = null;
  for (let i = 0, j = 0; i < lines.length; i++) {
    while (j && lines[i] !== needle[j]) j = prefix[j - 1];
    if (lines[i] === needle[j]) j++;
    if (j === needle.length) {
      if (found) return null;
      found = { start: i + 1 - j, end: i + 1 }; j = prefix[j - 1];
    }
  }
  return found;
}

export function mappedRanges(diff, before, after, ranges) {
  if (typeof diff !== 'string') return false;
  const lines = diff.split('\n');
  let oldPos = 0;
  let newPos = 0;
  let seen = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('@@')) continue;
    const match = lines[i].match(/^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@(?: .*)?$/);
    if (!match) return false;
    const [oldLine, oldCount, newLine, newCount] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3]), Number(match[4] ?? 1)];
    if (![oldLine, oldCount, newLine, newCount].every(Number.isSafeInteger)) return false;
    const start = oldCount ? oldLine - 1 : oldLine;
    const next = newCount ? newLine - 1 : newLine;
    if (start < oldPos || next < newPos || start > before.length || next > after.length
      || !same(before.slice(oldPos, start), after.slice(newPos, next))) return false;
    if (ranges.some(range => start <= range.end && start + oldCount >= range.start)) return false;
    let removed = 0;
    let added = 0;
    while (removed < oldCount || added < newCount) {
      const line = lines[++i];
      if (typeof line !== 'string') return false;
      if (line.startsWith('-') && removed < oldCount && line.slice(1) === before[start + removed]) removed++;
      else if (line.startsWith('+') && added < newCount && line.slice(1) === after[next + added]) added++;
      else return false;
    }
    oldPos = start + oldCount; newPos = next + newCount; seen = true;
  }
  return seen && same(before.slice(oldPos), after.slice(newPos));
}

export function same(first, second) {
  return first.length === second.length && first.every((value, i) => value === second[i]);
}
