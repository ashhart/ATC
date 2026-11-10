import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createGit } from '../src/cli/git.js';
import { createPullFileCache } from '../src/cli/pullFileCache.js';
import { cli, setup } from './helpers.js';

const author = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgSign=false'];
const shared = 'z-shared.txt';
const minute = 60000;
const manyFiles = count => [...Array.from({ length: count }, (_, index) => `p${String(index).padStart(3, '0')}.txt`), shared];

function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-who-cache-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const clone = path.join(root, 'clone');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'init', '-q', '-b', 'main', clone);
  sh(clone, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(clone, shared), 'base\n');
  sh(clone, 'add', '.');
  sh(clone, ...author, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(clone, shared), 'local\n');
  const run = (args, env) => spawnSync('git', args, { cwd: clone, encoding: 'utf8', env: { ...process.env, ...env } });
  const git = { ...createGit(run), remoteFor: () => 'origin' };
  return { clone, git, file: path.join(clone, '.git', 'atc', 'traffic.json') };
}

const writers = {
  board: (fake, box) => cli(fake, 'alice', ['board'], { git: box.git, cwd: box.clone }),
  overlap: (fake, box) => cli(fake, 'alice', ['overlap', '--base', 'main'], { git: box.git, cwd: box.clone })
};
const who = (fake, box) => cli(fake, 'alice', ['who', shared], { git: box.git, cwd: box.clone });
const readText = box => fs.existsSync(box.file) ? fs.readFileSync(box.file, 'utf8') : null;
const readRows = box => { const text = readText(box); return text ? JSON.parse(text).pulls.map(pull => [pull.number, pull.files.length]) : null; };

for (const [name, write] of Object.entries(writers)) {
  test(`a partial ${name} refresh over a missing cache writes none, so who reports pull request files unavailable`, async t => {
    const box = sandbox(t);
    const fake = setup();
    const pull = fake.addPull({ author: 'bob', files: [shared, 'p000.txt'] });
    fake.store.files.set(pull.number, manyFiles(301));
    const report = await write(fake, box);
    assert.equal(report.limitations.includes('pullFilesLimit'), true);
    assert.equal(readRows(box), null);
    const answer = await who(fake, box);
    assert.deepEqual([answer.complete, answer.limitations, answer.pullRequests, answer.observedAt], [false, ['pullFilesUnavailable'], [], null]);
  });

  test(`a complete ${name} refresh still writes the cache that who reads`, async t => {
    const box = sandbox(t);
    const fake = setup();
    const pull = fake.addPull({ author: 'bob', files: ['p000.txt'] });
    await write(fake, box);
    assert.deepEqual(readRows(box), [[pull.number, 1]]);
    assert.deepEqual((await who(fake, box)).pullRequests, []);
    fake.clock.now += minute;
    fake.store.files.set(pull.number, [shared, 'p000.txt']);
    await write(fake, box);
    assert.deepEqual(readRows(box), [[pull.number, 2]]);
    const answer = await who(fake, box);
    assert.deepEqual([answer.complete, answer.limitations, answer.pullRequests], [true, [], [pull.number]]);
    assert.equal(answer.observedAt, new Date(fake.clock.now).toISOString());
  });

  test(`a partial read of my own pull request does not stop the ${name} from writing the cache`, async t => {
    const box = sandbox(t);
    const fake = setup();
    const other = fake.addPull({ author: 'bob', files: [shared] });
    const mine = fake.addPull({ author: 'alice', files: ['p000.txt'] });
    fake.store.files.set(mine.number, manyFiles(301));
    await write(fake, box);
    assert.deepEqual(readRows(box), [[other.number, 1]]);
    assert.deepEqual((await who(fake, box)).pullRequests, [other.number]);
  });

  for (const [goodName, writeGood] of Object.entries(writers)) {
    test(`a partial ${name} refresh keeps the cache that the ${goodName} wrote and who reports its true age`, async t => {
      const box = sandbox(t);
      const fake = setup();
      const pull = fake.addPull({ author: 'bob', files: [shared, 'p000.txt'] });
      await writeGood(fake, box);
      const good = readText(box);
      assert.deepEqual(readRows(box), [[pull.number, 2]]);
      const observed = new Date(fake.clock.now).toISOString();
      fake.clock.now += 10 * minute;
      fake.store.files.set(pull.number, manyFiles(301));
      const report = await write(fake, box);
      assert.equal(report.limitations.includes('pullFilesLimit'), true);
      assert.deepEqual(readRows(box), [[pull.number, 2]]);
      assert.equal(readText(box), good);
      const answer = await who(fake, box);
      assert.deepEqual([answer.complete, answer.pullRequests, answer.observedAt], [true, [pull.number], observed]);
    });
  }
}

const layouts = [[true, 'small'], [true, 'large'], [false, 'small'], [false, 'large']];

function twoPulls(fake, smallFirst, newest) {
  const add = files => fake.addPull({ author: 'bob', files });
  const pulls = {};
  for (const kind of smallFirst ? ['small', 'large'] : ['large', 'small']) pulls[kind] = add(kind === 'small' ? [shared] : ['p000.txt']);
  const stamp = (pull, offset) => { fake.store.issues.get(pull.number).updated_at = new Date(fake.clock.now + offset).toISOString(); };
  stamp(pulls[newest], minute);
  stamp(pulls[newest === 'small' ? 'large' : 'small'], 0);
  return pulls;
}

for (const [name, write] of Object.entries(writers)) {
  for (const [smallFirst, newest] of layouts) {
    const order = `${smallFirst ? 'small then large' : 'large then small'} by number, ${newest} updated last`;
    test(`the ${name} over a small and a large pull request (${order}) writes no cache when none existed`, async t => {
      const box = sandbox(t);
      const fake = setup();
      const pulls = twoPulls(fake, smallFirst, newest);
      fake.store.files.set(pulls.large.number, manyFiles(301));
      const report = await write(fake, box);
      assert.equal(report.limitations.includes('pullFilesLimit'), true);
      assert.equal(readRows(box), null);
      assert.deepEqual((await who(fake, box)).limitations, ['pullFilesUnavailable']);
    });

    test(`the ${name} over a small and a large pull request (${order}) keeps the earlier cache`, async t => {
      const box = sandbox(t);
      const fake = setup();
      const pulls = twoPulls(fake, smallFirst, newest);
      await write(fake, box);
      const good = readText(box);
      assert.deepEqual(readRows(box).sort((first, second) => first[0] - second[0]), [[1, 1], [2, 1]]);
      fake.clock.now += minute;
      fake.store.files.set(pulls.large.number, manyFiles(301));
      await write(fake, box);
      assert.equal(readText(box), good);
      assert.deepEqual((await who(fake, box)).pullRequests, [pulls.small.number]);
    });
  }
}

test('a cache kept after a partial refresh is not renewed, so it expires 30 minutes after the last complete read', async t => {
  const box = sandbox(t);
  const fake = setup();
  const pull = fake.addPull({ author: 'bob', files: [shared] });
  await writers.board(fake, box);
  fake.clock.now += 20 * minute;
  fake.store.files.set(pull.number, manyFiles(301));
  await writers.overlap(fake, box);
  fake.clock.now += 9 * minute;
  assert.deepEqual([(await who(fake, box)).complete, (await who(fake, box)).pullRequests], [true, [pull.number]]);
  fake.clock.now += minute;
  const expired = await who(fake, box);
  assert.deepEqual([expired.complete, expired.limitations, expired.pullRequests], [false, ['pullFilesUnavailable'], []]);
});

test('the pull request file cache keeps what it wrote and ignores hostile or oversized documents', t => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atc-file-cache-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const env = { XDG_CACHE_HOME: folder };
  assert.equal(createPullFileCache('bad/repo\n', env), null);
  assert.equal(createPullFileCache('example/project', { ...env, ATC_CACHE: '0' }), null);
  const cache = createPullFileCache('example/project', env);
  assert.equal(cache.read().size, 0);
  cache.write(new Map([[1, { updatedAt: 5, files: ['src/a.js'] }], [2, { updatedAt: 6, files: [] }]]));
  assert.deepEqual([...cache.read()], [[1, { updatedAt: 5, files: ['src/a.js'] }], [2, { updatedAt: 6, files: [] }]]);
  const directory = path.join(folder, 'atc-github');
  assert.deepEqual(fs.readdirSync(directory), ['example__project.json']);
  const file = path.join(directory, 'example__project.json');
  const good = JSON.parse(fs.readFileSync(file));
  const reject = value => { fs.writeFileSync(file, JSON.stringify(value)); assert.equal(cache.read().size, 0); };
  reject({ ...good, version: 2 });
  reject({ ...good, pulls: [good.pulls[0], good.pulls[0]] });
  reject({ ...good, pulls: [{ ...good.pulls[0], files: ['bad\nname'] }] });
  reject({ ...good, pulls: [{ ...good.pulls[0], files: Array.from({ length: 601 }, (_, index) => `f${index}.js`) }] });
  reject({ ...good, pulls: Array.from({ length: 301 }, (_, index) => ({ number: index + 1, updatedAt: 1, files: [] })) });
  fs.writeFileSync(file, JSON.stringify(good));
  assert.equal(cache.read().size, 2);
  cache.write(new Map(Array.from({ length: 301 }, (_, index) => [index + 1, { updatedAt: 1, files: [] }])));
  assert.equal(cache.read().size, 300);
});
