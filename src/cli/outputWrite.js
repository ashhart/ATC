import { proposalKind } from './outputRecords.js';
import { areaList, artifactId, booleanValue, enumValue, issueNumber, nullable, record, rejectUnless, sessionId } from './outputTypes.js';

const common = ['dryRun', 'pending', 'incomplete', 'configurationUnpinned', 'uncertain', 'readOnly', 'invalid', 'notEnabled'];
const outcomes = {
  claim: ['claimed', 'claimUpdated', 'claimTaken', 'takenOutside', 'notClaimable', 'claimLimit', 'sharedClaim', 'unknownArea'],
  renew: ['renewed', 'nothingToRenew', 'notClaimable', 'notAuthorized'],
  release: ['released', 'nothingToRelease'],
  propose: ['proposed', 'notClaimed', 'notClaimable', 'alreadyInvolved', 'proposalExists', 'proposalLimit', 'unknownArea'],
  accept: ['accepted', 'proposalNotFound', 'notAuthorized', 'proposerAtLimit', 'participantLimit',
    'splitLeavesNothing', 'splitUnavailable', 'sharedClaim'],
  decline: ['declined', 'proposalNotFound', 'notAuthorized'],
  withdraw: ['withdrawn', 'proposalNotFound', 'notAuthorized'],
  flight: ['checkedIn', 'notClaimed', 'notClaimable', 'notAuthorized', 'flightLimit', 'roleMismatch'],
  land: ['landed', 'nothingToLand', 'notClaimed', 'notAuthorized', 'notClaimable']
};
const commands = enumValue(...Object.keys(outcomes));
const state = enumValue('working', 'reviewing', 'blocked');
const schema = record({ issue: nullable(issueNumber), command: commands, posted: nullable(booleanValue), outcome: value => value },
  { comment: artifactId, areas: areaList, kind: proposalKind, proposal: artifactId, session: sessionId, state });

export function writeOutput(value, context) {
  const result = schema(value, context);
  rejectUnless([...common, ...outcomes[result.command]].includes(result.outcome));
  const postedKeys = result.posted ? ['issue', 'command', 'posted', 'comment', 'outcome', 'session', 'state']
    : result.outcome === 'dryRun' ? ['issue', 'command', 'posted', 'outcome', 'areas', 'kind', 'proposal', 'session', 'state']
      : ['issue', 'command', 'posted', 'outcome', 'session', 'state'];
  rejectUnless(Object.keys(result).every(key => postedKeys.includes(key)));
  rejectUnless((result.posted === true) === Object.hasOwn(result, 'comment'));
  rejectUnless((result.posted === null) === (result.outcome === 'uncertain'));
  rejectUnless(result.issue !== null || ['accept', 'decline', 'withdraw'].includes(result.command));
  rejectUnless(!result.posted || result.outcome !== 'dryRun');
  rejectUnless(!Object.hasOwn(result, 'areas') || ['claim', 'propose'].includes(result.command));
  rejectUnless(!Object.hasOwn(result, 'kind') || result.command === 'propose');
  rejectUnless(!Object.hasOwn(result, 'proposal') || ['accept', 'decline', 'withdraw'].includes(result.command));
  rejectUnless(!Object.hasOwn(result, 'session') || ['flight', 'land'].includes(result.command));
  rejectUnless(!Object.hasOwn(result, 'state') || result.command === 'flight');
  if (result.outcome === 'dryRun') {
    if (result.command === 'claim') rejectUnless(Object.hasOwn(result, 'areas'));
    if (result.command === 'propose') rejectUnless(Object.hasOwn(result, 'areas') && Object.hasOwn(result, 'kind'));
    if (['accept', 'decline', 'withdraw'].includes(result.command)) rejectUnless(Object.hasOwn(result, 'proposal'));
    if (['flight', 'land'].includes(result.command)) rejectUnless(Object.hasOwn(result, 'session'));
    if (result.command === 'flight') rejectUnless(Object.hasOwn(result, 'state'));
  }
  return result;
}
