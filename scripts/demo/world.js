import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../../src/cli/actions.js';
import { parseCliArgs } from '../../src/cli/args.js';
import { createGh } from '../../src/cli/gh.js';
import { createGit } from '../../src/cli/git.js';
import { createLabels } from '../../src/cli/terminalText.js';
import { createFakeGithub } from '../../tests/fakeGithub.js';
import { backlog, baseFiles, config } from './files.js';

const failed = 'The demo could not run a local git step.';

export function createWorld(root, { coordinated }) {
  const isolation = path.join(root, 'gitconfig');
  fs.writeFileSync(isolation, '');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (cwd, args, extra = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000,
    env: { ...cleanEnv, GIT_CONFIG_GLOBAL: isolation, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra } });
  const sh = (cwd, args, extra) => {
    const result = git(cwd, args, extra);
    if (result.status !== 0) throw new Error(failed);
    return result.stdout;
  };
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  sh(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  sh(root, ['init', '-q', '-b', 'main', seed]);
  writeFiles(seed, baseFiles);
  sh(seed, ['add', '-A']);
  sh(seed, ['commit', '-q', '-m', 'Router, parser, guide and tests'], identity('mae'));
  sh(seed, ['push', '-q', origin, 'HEAD:main']);
  const fake = createFakeGithub();
  fake.store.config = coordinated ? config : null;
  const titles = new Map();
  for (const issue of backlog) {
    fake.addIssue({ title: issue.title, labels: issue.labels.map(name => ({ name })) });
    titles.set(issue.number, issue.title);
  }

  function agent(name) {
    const dir = path.join(root, name);
    sh(root, ['clone', '-q', origin, dir]);
    const cliGit = { ...createGit((args, env) => git(dir, args, env)), remoteFor: () => 'origin' };
    return {
      name,
      async atc(args) {
        fake.store.cliUser = name;
        const labels = createLabels();
        for (const [number, title] of titles) labels.titles.set(number, title);
        const result = await runCli(parseCliArgs(args), { gh: createGh(fake.runGh), git: cliGit, cwd: dir, env: {}, labels,
          sleep: async () => { fake.clock.now += 1000; }, now: () => fake.clock.now });
        return { result, labels };
      },
      work(branch, change, message) {
        if (branch) sh(dir, ['checkout', '-q', '-b', branch]);
        writeFiles(dir, change);
        sh(dir, ['add', '-A']);
        sh(dir, ['commit', '-q', '-m', message], identity(name));
      },
      undo(file, message) {
        sh(dir, ['checkout', '-q', 'main', '--', file]);
        sh(dir, ['commit', '-q', '-m', message], identity(name));
      },
      openPull(issue, title) {
        const files = sh(dir, ['diff', '--name-only', 'main...HEAD']).split('\n').filter(Boolean);
        const pull = fake.addPull({ author: name, body: `Fixes #${issue}`, files });
        sh(dir, ['push', '-q', 'origin', `HEAD:refs/pull/${pull.number}/head`]);
        titles.set(pull.number, title);
        return { number: pull.number, issue, author: name, files };
      }
    };
  }

  function merge(pull) {
    const head = `refs/pull/${pull.number}/head`;
    const result = git(origin, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', 'main', head]);
    if (result.status === 1) return { merged: false, conflicts: result.stdout.split('\0').slice(1).filter(Boolean) };
    if (result.status !== 0) throw new Error(failed);
    const tree = result.stdout.split('\0')[0];
    const commit = sh(origin, ['commit-tree', tree, '-p', 'main', '-p', head, '-m', `Merge pull request #${pull.number}`], identity('mae')).trim();
    sh(origin, ['update-ref', 'refs/heads/main', commit]);
    fake.closeIssue(pull.number);
    fake.closeIssue(pull.issue);
    return { merged: true, conflicts: [] };
  }

  return { fake, agent, merge, titles };
}

function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
}

function identity(name) {
  const email = `${name}@example.com`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}
