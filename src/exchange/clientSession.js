import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createReader } from '../cli/reader.js';
import { privateDirectory, readPrivate, atomicWrite } from './disk.js';
import { digest, exact, isDigest, isId, isNumber, isOrigin, isRepository, proofFor, requireValue } from './values.js';

export function clientSession({ git, repository, origin, pull }) {
  requireValue(isRepository(repository) && isOrigin(origin) && isNumber(pull));
  const parent = path.join(git.commonDir(), 'atc');
  const folder = path.join(parent, 'exchange');
  privateDirectory(parent); privateDirectory(folder);
  const file = path.join(folder, `${digest(`${repository.toLowerCase()}\n${origin}\n${pull}`)}.json`);
  function read() {
    try {
      const value = JSON.parse(readPrivate(file, 1024));
      requireValue(exact(value, { token: isDigest, comment: x => x === null || isId(x) }), 'storage', 503);
      return value;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    read,
    async connect(gh, request) {
      let settings = read();
      const previous = settings !== null;
      if (!settings) {
        settings = { token: randomBytes(32).toString('hex'), comment: null };
        fs.writeFileSync(file, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
      }
      const body = `/atc exchange ${proofFor(settings.token, origin, repository, pull)}`;
      if (settings.comment === null && previous) {
        const me = gh.get('user');
        requireValue(isId(me?.id), 'upstream', 502);
        const comments = createReader(gh, repository).issueComments(pull);
        requireValue(!comments.partial, 'upstream', 502);
        const found = comments.items.find(x => x.body === body && isId(x.id) && x.user?.id === me.id);
        if (found) { settings.comment = found.id; atomicWrite(file, JSON.stringify(settings)); }
        else requireValue(false, 'proofUncertain', 409);
      }
      if (settings.comment === null) {
        const posted = gh.post(`repos/${repository}/issues/${pull}/comments`, { body });
        requireValue(isId(posted?.id), 'proofUncertain', 409);
        settings.comment = posted.id;
        atomicWrite(file, JSON.stringify(settings));
      }
      return request('POST', '/sessions', { value: { ...settings, pull } });
    }
  };
}
