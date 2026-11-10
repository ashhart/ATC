import { TimeLimit } from './ghTransport.js';

export function publicationGit(context) {
  const original = context.git;
  if (typeof original?.exec !== 'function') return original;
  const limits = () => {
    const left = typeof context.gh.timeLeft === 'function' ? context.gh.timeLeft() : 30000;
    if (!Number.isFinite(left) || left < 1000) throw new TimeLimit('Publication request deadline exceeded.');
    return { timeout: Math.max(1, Math.min(10000, Math.floor(left) - 500)) };
  };
  return { ...original,
    changedFiles: base => original.changedFiles(base, limits),
    commonDir: () => original.commonDir(limits),
    mergeBase: ref => original.mergeBase(ref, limits),
    remoteFor: repository => original.remoteFor(repository, limits),
    exec(args, env, input) {
      const cleanup = args[0] === 'update-ref' && args[1] === '-d' && /^refs\/atc\/[a-f0-9]{16}\/pull\/[1-9][0-9]{0,8}$/.test(args[2]);
      let options;
      try { options = cleanup ? { timeout: 1000 } : limits(); } catch { return null; }
      return original.exec(args, env, input, options);
    }
  };
}
