import { isActorLogin, isNumber, isRecord, isRepository } from '../core/values.js';
import { isFilePath } from './reader.js';
import { hasTime, isTimeLimit } from './timeBudget.js';
import { createScopedPullCache, isPullHead, pullCacheKey } from './scopedPullCache.js';

export function readScopedPulls(context, numbers) {
  const cache = context.cache ? createScopedPullCache(context.repository, context.env) : null;
  const entries = cache?.read() || new Map();
  const files = [];
  const inspected = [];
  const limitations = [];
  let changed = false;
  for (const number of numbers) {
    if (!hasTime(context.gh, 2000)) { limitations.push('timeLimit'); break; }
    try {
      const pull = readMetadata(context, number);
      if (!pull) { limitations.push('selectedPullUnavailable'); continue; }
      const cached = entries.get(pullCacheKey(pull));
      let result;
      if (cached && cached.changedFiles === pull.changedFiles) result = { files: cached.files, partial: false, invalid: false };
      else {
        result = context.reader.pullFiles(number);
        if (result?.timed) { limitations.push('timeLimit'); break; }
        const confirmed = readMetadata(context, number);
        if (!confirmed || pullCacheKey(confirmed) !== pullCacheKey(pull) || confirmed.changedFiles !== pull.changedFiles) {
          limitations.push('selectedPullChanged'); continue;
        }
      }
      if (!validFiles(result, pull)) { limitations.push('invalidFiles'); continue; }
      if (result.partial) limitations.push('pullFilesLimit');
      if (result.invalid) limitations.push('invalidFiles');
      if (!result.partial && !result.invalid) {
        inspected.push(number);
        if (!cached) { entries.set(pullCacheKey(pull), { ...pull, files: [...new Set(result.files)].sort() }); changed = true; }
      }
      files.push({ number, head: pull.head, files: new Set(result.files) });
    } catch (error) {
      limitations.push(isTimeLimit(error) ? 'timeLimit' : 'selectedPullUnavailable');
      if (isTimeLimit(error)) break;
    }
  }
  if (cache && changed) cache.write(entries);
  return { files, inspected, limitations };
}

function readMetadata(context, number) {
  const value = context.gh.getOptional(`repos/${context.repository}/pulls/${number}`);
  if (!isRecord(value) || value.number !== number || value.state !== 'open' || !isRecord(value.user)
    || !['User', 'Bot'].includes(value.user.type) || !isActorLogin(value.user.login)
    || !isPullHead(value.head?.sha) || !isPullHead(value.base?.sha)
    || !isRepository(value.base?.repo?.full_name) || value.base.repo.full_name.toLowerCase() !== context.repository.toLowerCase()
    || !Number.isSafeInteger(value.changed_files) || value.changed_files < 0 || value.changed_files > 100000) return null;
  return { number, head: value.head.sha, base: value.base.sha, changedFiles: value.changed_files };
}

function validFiles(value, pull) {
  return isRecord(value) && Array.isArray(value.files) && value.files.length <= 600 && value.files.every(isFilePath)
    && typeof value.partial === 'boolean' && typeof value.invalid === 'boolean'
    && (value.partial || value.invalid || new Set(value.files).size >= pull.changedFiles
      && new Set(value.files).size <= pull.changedFiles * 2);
}
