import { boardLabel, pickBoard, readBoard } from '../core/board.js';
import { commandText } from '../core/commands.js';
import { ensure } from '../core/failure.js';
import { isBotLogin, isId, isLogin, isRepository } from '../core/values.js';
import { areaArgs, issueArg, kindArg, proposalArg } from './args.js';
import { checkView, statusView } from './view.js';

export const helpText = `atc-gh: coordinate work on a GitHub repository with other people's agents.

  atc-gh status                          board summary, your claims, proposals for you
  atc-gh check <issue> [areas...]        is the issue free, and does other work cover these areas?
  atc-gh claim <issue> [areas...]        claim an issue, optionally only some areas
  atc-gh release <issue>                 give up your claim
  atc-gh propose <issue> <kind> [areas]  kind is split (with areas), pair, takeover or review
  atc-gh accept <proposal>               accept a proposal on an issue you claimed
  atc-gh decline <proposal>              decline one
  atc-gh withdraw <proposal>             take back your own proposal

Options: --wait waits for the bot's answer, --repo owner/name, --bot login.
Output is JSON made of numbers and fixed words only.
`;

const arity = {
  status: count => count === 0,
  check: count => count >= 1,
  claim: count => count >= 1,
  release: count => count === 1,
  propose: count => count >= 2,
  accept: count => count === 1,
  decline: count => count === 1,
  withdraw: count => count === 1
};

export async function runCli({ command, rest, flags }, { gh, sleep, env = {} }) {
  ensure(Object.hasOwn(arity, command) && arity[command](rest.length), 'Unknown command or wrong number of arguments. Run atc-gh help.');
  const botLogin = flags.bot || env.ATC_BOT || 'github-actions[bot]';
  ensure(isBotLogin(botLogin), 'ATC_BOT must be a bot login such as github-actions[bot]');
  const context = { gh, sleep, wait: flags.wait, botLogin, repository: resolveRepository(gh, flags, env) };
  context.me = currentUser(gh);
  context.read = () => loadBoard(context);
  const { state } = context.read();
  if (command === 'status') return statusView(state, context.me, context.repository);
  if (command === 'check') return checkView(state, context.me, issueArg(rest[0]), areaArgs(rest.slice(1), state.areas));
  if (command === 'claim') return send(context, issueArg(rest[0]), { verb: 'claim', areas: areaArgs(rest.slice(1), state.areas) });
  if (command === 'release') return send(context, issueArg(rest[0]), { verb: 'release' });
  if (command === 'propose') {
    const kind = kindArg(rest[1]);
    const areas = areaArgs(rest.slice(2), state.areas);
    ensure((kind === 'split') === (areas.length > 0), 'A split needs areas; the other kinds take none');
    return send(context, issueArg(rest[0]), { verb: 'propose', kind, areas });
  }
  const id = proposalArg(rest[0]);
  const proposal = state.proposals.find(entry => entry.id === id);
  ensure(proposal, 'No pending proposal with that number');
  return send(context, proposal.issue, { verb: command, proposal: id });
}

async function send(context, issue, command) {
  const created = context.gh.post(`repos/${context.repository}/issues/${issue}/comments`, { body: commandText(command) });
  ensure(isId(created?.id), 'GitHub did not return the new comment');
  const reply = { issue, command: command.verb, posted: true, outcome: 'pending' };
  if (!context.wait) return reply;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await context.sleep(10000);
    const entry = context.read().state.recent.find(item => item.comment === created.id);
    if (entry) return { ...reply, outcome: entry.outcome };
  }
  return reply;
}

function loadBoard({ gh, repository, botLogin }) {
  const issues = gh.get(`repos/${repository}/issues?labels=${boardLabel}&state=open&per_page=20`);
  const board = pickBoard(Array.isArray(issues) ? issues : [], botLogin);
  ensure(board, 'No ATC board on this repository. Ask a maintainer to install the ATC workflow.');
  return { number: board.number, state: readBoard(board.body) };
}

function resolveRepository(gh, flags, env) {
  const chosen = flags.repo || env.ATC_REPO;
  if (chosen !== undefined) {
    ensure(isRepository(chosen), 'ATC_REPO must be owner/name');
    return chosen;
  }
  const view = gh.repoView();
  const repository = view?.isFork && view.parent ? `${view.parent.owner?.login}/${view.parent.name}` : view?.nameWithOwner;
  ensure(isRepository(repository), 'Could not tell which repository to use. Pass --repo owner/name.');
  return repository;
}

function currentUser(gh) {
  const user = gh.get('user');
  ensure(isLogin(user?.login), 'Could not read your GitHub login. Check `gh auth status`.');
  return user.login;
}
