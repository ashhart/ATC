import { readPullFilesByNumber } from './graphPullFiles.js';
import { readPullFileSets } from './graphPulls.js';
import { createPullFileCache } from './pullFileCache.js';
import { hasTime } from './timeBudget.js';

export function readPullFiles(context, wanted, open = wanted) {
  const cache = context.cache ? createPullFileCache(context.repository, context.env) : null;
  const cached = cache ? cache.read() : new Map();
  const hit = pull => cached.get(pull.number)?.updatedAt === pull.updatedAt;
  const missing = wanted.filter(pull => !hit(pull)).map(pull => pull.number);
  const batched = missing.length === 0 ? { sets: new Map(), timed: false } : Math.ceil(missing.length / 15) < Math.ceil(open.length / 50)
    ? readPullFilesByNumber(context.gh, context.repository, missing) : readPullFileSets(context.gh, context.repository, missing);
  const stillOpen = new Map(open.map(pull => [pull.number, pull.updatedAt]));
  const keep = new Map([...cached].filter(([number, entry]) => stillOpen.get(number) === entry.updatedAt));
  const files = new Map();
  let timed = batched.timed;
  for (const pull of wanted) {
    let result = hit(pull) ? { files: cached.get(pull.number).files, partial: false, invalid: false } : batched.sets.get(pull.number);
    if (!result && !timed && hasTime(context.gh, 2000)) result = context.reader.pullFiles(pull.number);
    if (!result || result.timed) {
      timed = true;
      continue;
    }
    if (!result.partial && !result.invalid) keep.set(pull.number, { updatedAt: pull.updatedAt, files: result.files });
    files.set(pull.number, result);
  }
  if (cache && missing.length > 0) cache.write(keep);
  return { files, timed };
}
