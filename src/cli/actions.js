import { ensure } from '../core/failure.js';
import { isLogin, isRepository } from '../core/values.js';
import { checkView, statusView } from '../core/view.js';
import { areaArgs, issueArg, kindArg, presenceArg, proposalArg, sessionArg } from './args.js';
import { doctor } from './doctor.js';
import { reportPresence } from './presenceCommand.js';
import { inspectWho } from './who.js';
import { inspectTraffic } from './traffic.js';
import { displayResult } from './output.js';
import { inspectOverlap } from './overlap.js';
import { createReader } from './reader.js';
import { initRepository } from './setup.js';
import { postAndConfirm, takeSnapshot } from './snapshot.js';
import { isTimeLimit } from './timeBudget.js';

export { helpText } from './help.js';

const arity = { board: count => count === 0, status: count => count === 0, check: count => count >= 1 && count <= 9, claim: count => count >= 1 && count <= 9,
  renew: count => count === 1, release: count => count === 1, propose: count => count >= 2 && count <= 10,
  accept: count => count === 1, decline: count => count === 1, withdraw: count => count === 1,
  overlap: count => count === 0, doctor: count => count === 0, init: count => count === 0,
  start: count => count === 1, pulse: count => count === 3, land: count => count === 2, who: count => count === 1 };

export async function runCli({ command, rest, flags }, { gh, git, sleep, now = Date.now, env = {}, cwd = process.cwd(), labels, cache = false } = {}) {
  ensure(Object.hasOwn(arity, command) && arity[command](rest.length), 'Unknown command or wrong number of arguments. Run atc help.');
  if (command === 'init') return displayResult(initRepository({ cwd, check: Boolean(flags.check) }));
  if (command === 'doctor') return displayResult(doctor({ gh, git, flags, env, cwd }));
  if (command === 'who') return displayResult(inspectWho({ git, now, cwd, labels }, rest[0]));
  const input = readInput(command, rest);
  ensure(!env.ATC_SIGNATURE, 'ATC_SIGNATURE is not supported. Comments contain commands only.');
  ensure(env.ATC_READ_ONLY === undefined || ['0', '1'].includes(env.ATC_READ_ONLY), 'Invalid ATC_READ_ONLY setting');
  if (['start', 'pulse', 'land'].includes(command)) {
    return displayResult(reportPresence(command, input, { git, now, dryRun: Boolean(flags.dryRun), readOnly: env.ATC_READ_ONLY === '1' }));
  }
  const repository = resolveRepository(gh, flags, env);
  if (labels) labels.repository = repository;
  const context = { gh, git, sleep, now, env, repository, labels, cache: cache === true, dryRun: Boolean(flags.dryRun), readOnly: env.ATC_READ_ONLY === '1',
    reader: createReader(gh, repository) };
  context.me = currentUser(gh);
  const snapshot = takeSnapshot(context);
  context.snapshot = snapshot;
  const known = snapshot.config;
  const areas = areaArgs(input.areas || [], known);
  if (command === 'board') return displayResult(inspectTraffic(context, snapshot), known);
  if (command === 'status') return displayResult(statusView(snapshot, { me: context.me, repository, now: snapshot.now }), known);
  if (command === 'overlap') return displayResult(inspectOverlap(context, snapshot, flags), known);
  if (command === 'check' || command === 'claim') {
    const read = issueDetails(context, snapshot, input.issue);
    const view = checkView(read.snapshot, { me: context.me, issue: input.issue, areas, details: read.details });
    if (command === 'check') return displayResult(view, known);
    if (!known.enabled) return displayResult(skipped(view.issue, 'claim', 'notEnabled'), known);
    return displayResult(await claim(context, snapshot, view, areas), known);
  }
  if (!known.enabled) return displayResult(skipped(input.issue ?? null, command, 'notEnabled'), known);
  if (snapshot.partial) return displayResult(skipped(input.issue ?? null, command, 'incomplete'));
  if (command === 'release') return displayResult(await release(context, snapshot, input.issue), known);
  if (command === 'renew') return displayResult(await renew(context, snapshot, input.issue), known);
  if (command === 'propose') return displayResult(await propose(context, snapshot, { ...input, areas }), known);
  return displayResult(await decide(context, snapshot, command, input.proposal), known);
}

function readInput(command, rest) {
  if (['start', 'pulse', 'land'].includes(command)) return { issue: issueArg(rest[0]),
    ...(command === 'start' ? {} : { session: sessionArg(rest[1]) }),
    ...(command === 'pulse' ? { state: presenceArg(rest[2]) } : {}) };
  if (['check', 'claim', 'renew', 'release', 'propose'].includes(command)) {
    const issue = issueArg(rest[0]);
    if (command === 'propose') {
      const kind = kindArg(rest[1]);
      const areas = rest.slice(2);
      ensure((kind === 'split') === (areas.length > 0), 'A split needs areas; the other kinds take none');
      return { issue, kind, areas };
    }
    return { issue, areas: rest.slice(1) };
  }
  return ['accept', 'decline', 'withdraw'].includes(command) ? { proposal: proposalArg(rest[0]) } : {};
}

function issueDetails(context, snapshot, issue) {
  try {
    return { snapshot, details: context.reader.issue(issue) };
  } catch (error) {
    if (!isTimeLimit(error)) throw error;
    return { snapshot: { ...snapshot, partial: true, limitations: [...new Set([...snapshot.limitations, 'timeLimit'])].sort() }, details: null };
  }
}

function skipped(issue, verb, outcome) {
  return { issue, command: verb, posted: false, outcome };
}

function claim(context, snapshot, view, areas) {
  const refusal = { incomplete: 'incomplete', proposeInstead: 'claimTaken', takenOutside: 'takenOutside', notOpen: 'notClaimable' }[view.advice];
  if (refusal) return skipped(view.issue, 'claim', refusal);
  const held = snapshot.state.claims.filter(entry => entry.login === context.me && entry.role === 'work' && entry.issue !== view.issue).length;
  if (view.advice === 'free' && held >= snapshot.config.maxClaimsPerUser) return skipped(view.issue, 'claim', 'claimLimit');
  return postAndConfirm(context, view.issue, { verb: 'claim', areas });
}

function renew(context, snapshot, issue) {
  if (!snapshot.state.claims.some(entry => entry.issue === issue && entry.login === context.me)) return skipped(issue, 'renew', 'nothingToRenew');
  const details = context.reader.issue(issue);
  if (!details || details.state !== 'open' || details.pull_request) return skipped(issue, 'renew', 'notClaimable');
  return postAndConfirm(context, issue, { verb: 'renew' });
}

function release(context, snapshot, issue) {
  if (!snapshot.state.claims.some(entry => entry.issue === issue && entry.login === context.me)) return skipped(issue, 'release', 'nothingToRelease');
  return postAndConfirm(context, issue, { verb: 'release' });
}

function propose(context, snapshot, { issue, kind, areas }) {
  const here = snapshot.state.claims.filter(entry => entry.issue === issue);
  const claimants = here.filter(entry => entry.role === 'work').map(entry => entry.login);
  if (claimants.length === 0) return skipped(issue, 'propose', 'notClaimed');
  if (here.some(entry => entry.login === context.me)) return skipped(issue, 'propose', 'alreadyInvolved');
  if (snapshot.state.proposals.filter(entry => entry.from === context.me).length >= snapshot.config.maxPendingProposalsPerUser) return skipped(issue, 'propose', 'proposalLimit');
  return postAndConfirm(context, issue, { verb: 'propose', kind, areas });
}

function decide(context, snapshot, verb, id) {
  const proposal = snapshot.state.proposals.find(entry => entry.id === id);
  if (!proposal) return skipped(null, verb, 'proposalNotFound');
  const deciding = verb !== 'withdraw';
  const allowed = deciding
    ? snapshot.state.claims.some(entry => entry.issue === proposal.issue && entry.role === 'work' && entry.login === context.me)
    : proposal.from === context.me;
  if (!allowed) return skipped(proposal.issue, verb, 'notAuthorized');
  if (verb === 'accept' && proposal.kind !== 'review'
    && snapshot.state.claims.filter(entry => entry.login === proposal.from && entry.role === 'work').length >= snapshot.config.maxClaimsPerUser) {
    return skipped(proposal.issue, verb, 'proposerAtLimit');
  }
  return postAndConfirm(context, proposal.issue, { verb, proposal: id });
}

function resolveRepository(gh, flags, env) {
  const chosen = flags.repo === undefined ? env.ATC_REPO : flags.repo;
  if (chosen !== undefined) {
    ensure(isRepository(chosen), 'ATC_REPO must be owner/name');
    return chosen;
  }
  const view = gh.repoView();
  ensure(typeof view?.isFork === 'boolean', 'Could not tell which repository to use. Pass --repo owner/name.');
  const repository = view.isFork && view.parent ? `${view.parent.owner?.login}/${view.parent.name}` : view.nameWithOwner;
  ensure(isRepository(repository), 'Could not tell which repository to use. Pass --repo owner/name.');
  return repository;
}

function currentUser(gh) {
  const login = gh.get('user')?.login;
  ensure(isLogin(login), 'Could not read your GitHub login. Check `gh auth status`.');
  return login.toLowerCase();
}
