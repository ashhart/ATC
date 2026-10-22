import { isRepository } from '../core/values.js';

export function isPublicOrigin(value) {
  return typeof value === 'string' && value.length <= 253 && !/\s/.test(value)
    && /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value);
}

export function presencePolicy(git) {
  if (typeof git?.exec !== 'function') return null;
  try {
    const shown = git.exec(['cat-file', '-p', 'HEAD:.github/atc-presence.json']);
    if (shown?.status !== 0 || typeof shown.stdout !== 'string' || shown.stdout.length > 1024) return null;
    const value = JSON.parse(shown.stdout);
    if (!value || Array.isArray(value) || Object.keys(value).length !== 3 || value.version !== 1
      || !isRepository(value.repository) || !isPublicOrigin(value.origin)) return null;
    return { repository: value.repository.toLowerCase(), origin: value.origin };
  } catch { return null; }
}
