import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { createGh } from '../src/cli/gh.js';
import { createGit } from '../src/cli/git.js';
import { parseCliArgs } from '../src/cli/args.js';
import { runCli } from '../src/cli/actions.js';

export function fixture(t) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-publication-')));
  const origin = folder + '-origin.git';
  t.after(() => { fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(origin, { recursive: true, force: true }); });
  const command = args => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  command(['init', '-q', '-b', 'main']); command(['init', '-q', '--bare', origin]);
  command(['config', 'user.name', 'Fixture']); command(['config', 'user.email', 'fixture@example.invalid']);
  fs.mkdirSync(path.join(folder, 'src'));
  const original = 'export const value = 1;\n' + Array.from({ length: 30 }, (_, i) => `// line ${i}\n`).join('');
  fs.writeFileSync(path.join(folder, 'src/a.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(folder, 'src/b.js'), original);
  command(['add', '.']); command(['commit', '-qm', 'Fixture']); command(['remote', 'add', 'origin', origin]);
  const base = command(['rev-parse', 'HEAD']);
  const steps = { afterGit: null };
  const git = createGit((args, env, input, limits) => {
    const result = spawnSync('git', args, { cwd: folder, encoding: 'utf8', input, timeout: limits?.timeout ?? 30000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env } });
    steps.afterGit?.(args, limits);
    return result;
  });
  git.remoteFor = () => 'origin';
  const fake = setup(); fake.addIssue();
  const add = fake.addPull;
  fake.addPull = options => {
    const pull = add(options);
    pull.head = { sha: options.files?.length ? 'f'.repeat(40) : base };
    pull.base = { sha: base, repo: { full_name: fake.repository } };
    return pull;
  };
  const run = (args, options = {}) => runCli(parseCliArgs(args), { gh: createGh(fake.runGh, options.transport), git, now: () => fake.clock.now,
    cache: options.cache !== false, env: options.env || {},
    sleep: async () => { fake.clock.now += 1000; }, cwd: folder, doctorCheck: () => ({ ready: true }) });
  const update = (pull, files, content) => {
    command(['checkout', '-qB', 'peer-' + pull.number, 'main']);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), typeof content === 'string' ? content : `export const value = ${content};\n`);
    }
    command(['add', '.']); command(['commit', '-qm', 'Peer change ' + pull.number]);
    pull.head = { sha: command(['rev-parse', 'HEAD']) };
    command(['push', '-q', '--force', 'origin', `HEAD:refs/pull/${pull.number}/head`]); command(['checkout', '-q', 'main']);
    return pull;
  };
  const peer = (author, files, content, body = '') => update(fake.addPull({ author, files, body }), files, content);
  const change = (content = 'export const value = 40;\n') => fs.writeFileSync(path.join(folder, 'src/b.js'), content);
  return { folder, fake, run, peer, change, update, original, command, git, steps };
}
