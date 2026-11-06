import { exact, isKey, isId, isHead, isNumber, isTime, isDigest, maximumEvidence } from './values.js';

export const capabilities = ['any', 'linux', 'macos', 'windows', 'cuda', 'metal', 'rocm', 'vulkan', 'cpu', 'docs', 'security'];
export const isCapability = value => capabilities.includes(value);
export const isConsumer = isKey;
const boolean = value => typeof value === 'boolean';
export const isOfferInput = value => exact(value, { capability: isCapability, public: boolean, required: boolean, independent: boolean });
export const isLeaseInput = value => exact(value, { consumer: isConsumer,
  seconds: x => Number.isInteger(x) && x >= 60 && x <= 3600 });
export const isConsumerInput = value => exact(value, { consumer: isConsumer });
export const isHandoffInput = value => exact(value, { id: isKey, issue: isNumber, head: isHead, base: isHead,
  recipient: isId, report: isKey });
export const isDecisionInput = value => exact(value, { decision: x => ['accepted', 'cancelled'].includes(x) });
export const isQueueInput = value => exact(value, { after: x => x === null || isKey(x),
  capability: x => x === null || isCapability(x) });

const offer = value => exact(value, { id: isKey, capability: isCapability, public: boolean, required: boolean,
  independent: boolean, createdAt: isTime });
const lease = value => exact(value, { id: isKey, author: isId, proof: isId, consumer: isConsumer,
  head: isHead, base: isHead, createdAt: isTime, expiresAt: isTime })
  && Date.parse(value.expiresAt) - Date.parse(value.createdAt) >= 60000
  && Date.parse(value.expiresAt) - Date.parse(value.createdAt) <= 3600000;
const handoff = value => exact(value, { id: isKey, pull: isNumber, issue: isNumber, head: isHead, base: isHead,
  author: isId, proof: isId, recipient: isId, report: isKey, digest: isDigest,
  size: x => Number.isInteger(x) && x > 0 && x <= maximumEvidence, createdAt: isTime,
  decision: x => x === null || exact(x, { decision: y => ['accepted', 'cancelled'].includes(y), at: isTime }) });
const list = (validator, maximum) => value => Array.isArray(value) && value.length <= maximum && value.every(validator)
  && new Set(value.map(x => x.id)).size === value.length;

export function isCollaborationState(value) {
  return exact(value, { offers: list(offer, 1000), leases: list(lease, 1000), handoffs: list(handoff, 100) });
}

export function collaborationState(state) {
  return state.collaboration ||= { offers: [], leases: [], handoffs: [] };
}
