const done = {
  claimed: 'Claimed. Start work.', claimUpdated: 'Claim updated.', renewed: 'Renewed.', released: 'Released.',
  proposed: 'Proposal posted. Wait for the holder to accept.', accepted: 'Accepted.', declined: 'Declined.', withdrawn: 'Withdrawn.',
  checkedIn: 'Checked in on this machine.', landed: 'Session ended.', dryRun: 'Preview only. Nothing was posted.'
};
const refused = {
  pending: 'Posted, not yet confirmed. Run atc status before starting.', incomplete: 'Not posted: coverage was incomplete.',
  uncertain: 'GitHub may or may not have the comment. Check the issue before retrying.', readOnly: 'Not posted: writes are disabled here.',
  notEnabled: 'Not posted: this repository has no .github/atc.json, so claims are off.', configurationUnpinned: 'Not posted: the area config has no areaIds.',
  claimTaken: 'Someone else holds it. Offer to pair, split or review instead.', takenOutside: 'Assigned or linked to someone else. Talk to them first.',
  notClaimable: 'Not an open issue.', claimLimit: 'You hold the maximum number of claims.', sharedClaim: 'That would change shared work.',
  unknownArea: 'Unknown area.', nothingToRenew: 'You hold no claim there.', nothingToRelease: 'You hold no claim there.',
  notClaimed: 'Nobody holds a claim there. Claim it instead.', alreadyInvolved: 'You are already involved.', proposalExists: 'You already offered that.',
  proposalLimit: 'Too many pending proposals.', proposalNotFound: 'No such pending proposal.', notAuthorized: 'Not yours to decide.',
  proposerAtLimit: 'The proposer holds too many claims.', participantLimit: 'Too many workers on this issue.',
  splitLeavesNothing: 'That split leaves the holder nothing.', splitUnavailable: 'Those areas are not held.', flightLimit: 'Five sessions already run on this issue.',
  nothingToLand: 'No such session.', roleMismatch: 'Wrong state for the claim.', invalid: 'Rejected.'
};

export function renderWrite(result, style) {
  const subject = result.issue ? `#${result.issue}` : `proposal ${result.proposal || ''}`.trim();
  const ok = Object.hasOwn(done, result.outcome);
  const message = ok ? done[result.outcome] : refused[result.outcome] || result.outcome;
  const session = result.session ? style.dim(`  session ${result.session}${result.state ? ` ${result.state}` : ''}`) : '';
  const publication = result.publication ? `\n${result.publication === 'public' ? 'Public flight board updated.' : 'Public flight board unavailable; local presence was updated.'}` : '';
  const sharing = result.sharing ? `\n${result.sharing === 'git' ? 'Shared with everyone on this repository through git.' : 'Could not share through git; local presence was updated.'}` : '';
  return `${ok ? style.green('✓') : style.yellow('✗')} ${result.command} ${subject}: ${message}${session}${publication}${sharing}`;
}

export function renderDoctor(result, style) {
  const lines = [result.ready ? style.green('Ready.') : style.yellow('Not ready yet.')];
  for (const [name, value] of Object.entries(result.checks)) {
    lines.push(`  ${value === 'ok' ? style.green('ok') : style.yellow(value)}  ${name}`);
  }
  return lines.join('\n');
}

export function renderInit(result, style) {
  const files = ['config', 'skill', 'agents', 'contributing', 'cursor'].filter(key => Object.hasOwn(result, key));
  return [style.bold(`init: ${result.outcome}`), ...files.map(key => `  ${result[key]}  ${key}`)].join('\n');
}
