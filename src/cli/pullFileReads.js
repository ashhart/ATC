import { readPullFilesByNumber } from './graphPullFiles.js';
import { readPullFileSets } from './graphPulls.js';
import { createPullFileCache } from './pullFileCache.js';

export function readPullFiles(context, wanted, open = wanted) {
  const cache = context.cache ? createPullFileCache(context.repository, context.env) : null;
  const cached = cache ? cache.read() : new Map();
  const hit = pull => cached.get(pull.number)?.updatedAt === pull.updatedAt;
  const missing = wanted.filter(pull => !hit(pull)).map(pull => pull.number);
  const batched = missing.length === 0 ? new Map() : Math.ceil(missing.length / 15) < Math.ceil(open.length / 50)
    ? readPullFilesByNumber(context.gh, context.repository, missing) : readPullFileSets(context.gh, context.repository, missing);
  const stillOpen = new Map(open.map(pull => [pull.number, pull.updatedAt]));
  const keep = new Map([...cached].filter(([number, entry]) => stillOpen.get(number) === entry.updatedAt));
  const results = new Map();
  for (const pull of wanted) {
    const files = hit(pull) ? { files: cached.get(pull.number).files, partial: false, invalid: false }
      : batched.get(pull.number) || context.reader.pullFiles(pull.number);
    if (!files.partial && !files.invalid) keep.set(pull.number, { updatedAt: pull.updatedAt, files: files.files });
    results.set(pull.number, files);
  }
  if (cache && missing.length > 0) cache.write(keep);
  return results;
}
