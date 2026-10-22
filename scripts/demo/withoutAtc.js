import { renderHuman } from '../../src/cli/human/render.js';
import { changes } from './files.js';
import { createWorld } from './world.js';
import { mergeAll } from './merging.js';

export async function runWithoutAtc(root, say) {
  await say.heading('Run 1: four agents, one backlog, no coordination');
  const world = createWorld(root, { coordinated: false });
  const [ada, bo, cy, dee] = ['ada', 'bo', 'cy', 'dee'].map(world.agent);
  await say.note(say.style.dim('Backlog: #1 trailing slash (good first issue), #2 unicode, #3 router docs, #4 router tests (good first issue)'));
  await say.say('ada', 'reads the backlog: #1 is the top good first issue and nobody is assigned. Taking it.');
  await say.say('bo', 'reads the backlog at the same moment: #1 looks free. Taking it.');
  await say.say('cy', 'takes #2, the parser bug.');
  await say.say('dee', 'takes #4, the other good first issue.');
  const pulls = [];
  ada.work('ada/trailing-slash', changes.keepSlash, 'Keep one trailing slash');
  pulls.push(ada.openPull(1, 'Keep the trailing slash'));
  await say.say('ada', `changes src/router.js and opens PR #${pulls[0].number} (Fixes #1)`);
  bo.work('bo/trailing-slash', changes.collapseSlash, 'Collapse repeated slashes');
  pulls.push(bo.openPull(1, 'Stop dropping trailing slashes'));
  await say.say('bo', `changes the same line of src/router.js and opens PR #${pulls[1].number} (Fixes #1)`);
  cy.work('cy/unicode', changes.unicode, 'Accept unicode input');
  pulls.push(cy.openPull(2, 'Accept unicode input'));
  await say.say('cy', `changes src/parser.js and opens PR #${pulls[2].number} (Fixes #2)`);
  dee.work('dee/router-tests', { ...changes.regressionTests, ...changes.routerHelper }, 'Add router tests and a slash helper');
  pulls.push(dee.openPull(4, 'Router regression tests'));
  await say.say('dee', `adds tests, extracts a helper in src/router.js and opens PR #${pulls[3].number} (Fixes #4)`);
  await say.note(say.style.dim('Nobody saw the others. Later, the maintainer runs atc board to see what happened:'));
  const { result: board, labels } = await world.agent('mae').atc(['board']);
  await say.block(renderHuman(board, labels, { color: say.color, now: world.fake.clock.now }));
  const outcome = await mergeAll(world, pulls, say);
  return { ...outcome, duplicates: board.summary.duplicateAttempts };
}
