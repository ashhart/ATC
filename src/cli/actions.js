import { ensure } from '../core/failure.js';
import { isLogin, isRepository } from '../core/values.js';
import { checkView, overlapView, statusView } from '../core/view.js';
import { areaArgs, issueArg, kindArg, proposalArg } from './args.js';
import { createReader } from './reader.js';
import { commentBody, postAndConfirm, takeSnapshot } from './snapshot.js';

export const helpText = `atc: coordinate work on a GitHub repository with other people's agents.

  atc status                          claims, proposals for you, claims to refresh
  atc check <issue> [areas...]        is the issue free, and does other work cover these areas?
  atc claim <issue> [areas...]        claim an issue, optionally only some areas
  atc release <issue>                 give up your claim
  atc propose <issue> <kind> [areas]  kind is split (with areas), pair, takeover or review
  atc accept <id>                     accept a proposal on an issue you claimed
  atc decline <id>                    decline one
  atc withdraw <id>                   take back your own proposal
  atc overlap [--base <ref>]          do your changes or pull requests touch files in other open pull requests?

Options: --repo owner/name. Set ATC_SIGNATURE to add one line to the end of the comments it posts.
Output is JSON made of numbers and fixed words only.
`;

const arity = { status: count => count === 0, check: count => count >= 1, claim: count => count >= 1, release: count => count === 1,
  propose: count => count >= 2, accept: count => count === 1, decline: count => count === 1, withdraw: count => count === 1,
  overlap: count => count === 0 };

export async function runCli({ command, rest, flags }, { gh, git, sleep, now = Date.now, env = {} }) {
  ensure(Object.hasOwn(arity, command) && arity[command](rest.length), 'Unknown command or wrong number of arguments. Run atc help.');
  const repository = resolveRepository(gh, flags, env);
  const context = { gh, git, sleep, now, repository, signature: env.ATC_SIGNATURE, reader: createReader(gh, repository) };
  if (context.signature) commentBody({ verb: 'release' }, [], context.signature);
  context.me = currentUser(gh);
  const snapshot = takeSnapshot(context);
  const known = Object.keys(snapshot.config.areas);
  if (command === 'status') return statusView(snapshot, { me: context.me, repository, now: now() });
  if (command === 'overlap') return overlap(context, snapshot, flags);
  if (command === 'release') return release(context, snapshot, issueArg(rest[0]));
  if (command === 'propose') return propose(context, snapshot, { issue: issueArg(rest[0]), kind: kindArg(rest[1]), areas: areaArgs(rest.slice(2), known) });
  if (command === 'check' || command === 'claim') {
    const issue = issueArg(rest[0]);
    const areas = areaArgs(rest.slice(1), known);
    const view = checkView(snapshot, { me: context.me, issue, areas, details: context.reader.issue(issue) });
    return command === 'check' ? view : claim(context, snapshot, view, areas);
  }
  return decide(context, snapshot, command, proposalArg(rest[0]));
}

function skipped(issue, verb, outcome) {
  return { issue, command: verb, posted: false, outcome };
}

function claim(context, snapshot, view, areas) {
  const refusal = { proposeInstead: 'claimTaken', takenOutside: 'takenOutside', notOpen: 'notClaimable' }[view.advice];
  if (refusal) return skipped(view.issue, 'claim', refusal);
  const held = snapshot.state.claims.filter(entry => entry.login === context.me && entry.role === 'work' && entry.issue !== view.issue).length;
  if (view.advice === 'free' && held >= snapshot.config.maxClaimsPerUser) return skipped(view.issue, 'claim', 'claimLimit');
  return postAndConfirm(context, view.issue, { verb: 'claim', areas });
}

function release(context, snapshot, issue) {
  if (!snapshot.state.claims.some(entry => entry.issue === issue && entry.login === context.me)) return skipped(issue, 'release', 'nothingToRelease');
  return postAndConfirm(context, issue, { verb: 'release' });
}

function propose(context, snapshot, { issue, kind, areas }) {
  ensure((kind === 'split') === (areas.length > 0), 'A split needs areas; the other kinds take none');
  const here = snapshot.state.claims.filter(entry => entry.issue === issue);
  const claimants = here.filter(entry => entry.role === 'work').map(entry => entry.login);
  if (claimants.length === 0) return skipped(issue, 'propose', 'notClaimed');
  if (here.some(entry => entry.login === context.me)) return skipped(issue, 'propose', 'alreadyInvolved');
  return postAndConfirm(context, issue, { verb: 'propose', kind, areas }, claimants);
}

function decide(context, snapshot, verb, id) {
  const proposal = snapshot.state.proposals.find(entry => entry.id === id);
  if (!proposal) return skipped(null, verb, 'proposalNotFound');
  const deciding = verb !== 'withdraw';
  const allowed = deciding
    ? snapshot.state.claims.some(entry => entry.issue === proposal.issue && entry.role === 'work' && entry.login === context.me)
    : proposal.from === context.me;
  if (!allowed) return skipped(proposal.issue, verb, 'notAuthorized');
  return postAndConfirm(context, proposal.issue, { verb, proposal: id }, deciding ? [proposal.from] : []);
}

function overlap(context, snapshot, flags) {
  let workingTree = null;
  try {
    workingTree = context.git.changedFiles(context.git.mergeBase(flags.base || defaultBase(context)));
  } catch (error) {
    if (flags.base) throw error;
  }
  const withFiles = pulls => pulls.map(pull => ({ number: pull.number, files: new Set(context.reader.pullFiles(pull.number)) }));
  const myPulls = withFiles(snapshot.pulls.filter(pull => pull.author === context.me).slice(0, 10));
  const otherPulls = withFiles(snapshot.pulls.filter(pull => pull.author !== context.me).slice(0, 30));
  return overlapView({ workingTree, myPulls, otherPulls }, snapshot.config);
}

function defaultBase(context) {
  const remote = context.git.remoteFor(context.repository);
  ensure(remote, 'No git remote points at the repository. Pass --base.');
  return `${remote}/${context.reader.defaultBranch()}`;
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
  const login = gh.get('user')?.login;
  ensure(isLogin(login), 'Could not read your GitHub login. Check `gh auth status`.');
  return login;
}
