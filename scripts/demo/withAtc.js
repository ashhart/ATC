import { renderHuman } from '../../src/cli/human/render.js';
import { changes } from './files.js';
import { mergeAll } from './merging.js';
import { createWorld } from './world.js';

const unexpected = 'The demo saw an unexpected ATC result.';
const areaFor = { 1: '1', 2: '2', 3: '3', 4: '4' };
const plans = {
  ada: { branch: 'ada/trailing-slash', change: changes.keepSlash, message: 'Keep one trailing slash', title: 'Keep the trailing slash' },
  bo: { branch: 'bo/unicode', change: changes.unicode, message: 'Accept unicode input', title: 'Accept unicode input' },
  cy: { branch: 'cy/router-docs', change: changes.routerDocs, message: 'Document router options', title: 'Document router options' },
  dee: { branch: 'dee/router-tests', change: { ...changes.regressionTests, ...changes.routerHelper },
    message: 'Add router tests and a slash helper', title: 'Router regression tests' }
};

export async function runWithAtc(root, say) {
  await say.heading('Run 2: the same agents and backlog, with ATC');
  const world = createWorld(root, { coordinated: true });
  const agents = ['ada', 'bo', 'cy', 'dee'].map(world.agent);
  await say.note(say.style.dim('This repository has .github/atc.json with areas 1 router, 2 parser, 3 docs, 4 tests. Agents check and claim first.'));
  const claimed = new Map();
  for (const agent of agents) claimed.set(agent.name, await claimFirstFree(agent, say, world));
  for (const agent of agents) {
    const { result } = await agent.atc(['start', String(claimed.get(agent.name))]);
    if (result.outcome !== 'checkedIn') throw new Error(unexpected);
    await say.say(agent.name, `$ atc start ${claimed.get(agent.name)}   ${say.style.dim('working session recorded on this machine')}`);
  }
  const pulls = [];
  for (const agent of agents) {
    const plan = plans[agent.name];
    agent.work(plan.branch, plan.change, plan.message);
    let overlap = await showOverlap(agent, say, world);
    if (agent.name === 'dee') {
      if (!overlap.overlaps.some(row => row.conflict === 'conflicts')) throw new Error(unexpected);
      await say.say('dee', 'keeps src/router.js out of this PR and tests through the public route() function instead.');
      agent.undo('src/router.js', 'Leave the router alone; test through route()');
      overlap = await showOverlap(agent, say, world);
    }
    if (overlap.overlaps.length || overlap.worktreeOverlaps.length) throw new Error(unexpected);
    const pull = agent.openPull(claimed.get(agent.name), plan.title);
    pulls.push(pull);
    await say.say(agent.name, `opens PR #${pull.number} (Fixes #${pull.issue})`);
  }
  await say.say('ada', '$ atc board');
  const { result: board, labels } = await agents[0].atc(['board']);
  await say.block(renderHuman(board, labels, { color: say.color, now: world.fake.clock.now }));
  const outcome = await mergeAll(world, pulls, say);
  return { ...outcome, duplicates: board.summary.duplicateAttempts, caught: 1 };
}

async function claimFirstFree(agent, say, world) {
  const taken = [];
  for (const issue of [1, 2, 3, 4]) {
    const check = await agent.atc(['check', String(issue), areaFor[issue]]);
    if (check.result.advice !== 'free') {
      if (agent.name === 'bo') {
        await say.say('bo', `$ atc check ${issue} ${areaFor[issue]}`);
        await say.block(renderHuman(check.result, check.labels, { color: say.color }));
      } else taken.push(issue);
      continue;
    }
    if (taken.length) await say.say(agent.name, say.style.dim(`checks ${taken.map(number => `#${number}`).join(', ')}: claimed by others, moving on`));
    await say.say(agent.name, `$ atc check ${issue} ${areaFor[issue]}`);
    await say.block(renderHuman(check.result, check.labels, { color: say.color }));
    const claim = await agent.atc(['claim', String(issue), areaFor[issue]]);
    await say.say(agent.name, `$ atc claim ${issue} ${areaFor[issue]}`);
    await say.block(renderHuman(claim.result, claim.labels, { color: say.color, now: world.fake.clock.now }));
    if (claim.result.outcome !== 'claimed') throw new Error(unexpected);
    return issue;
  }
  throw new Error(unexpected);
}

async function showOverlap(agent, say, world) {
  const { result, labels } = await agent.atc(['overlap', '--base', 'main']);
  await say.say(agent.name, '$ atc overlap');
  await say.block(renderHuman(result, labels, { color: say.color, now: world.fake.clock.now }));
  return result;
}
