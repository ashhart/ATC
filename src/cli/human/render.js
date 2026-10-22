import { createLabels, createStyle } from '../terminalText.js';
import { renderBoard } from './board.js';
import { boardNumbers } from './boardRows.js';
import { renderCheck, renderOverlap, renderStatus, renderWho } from './reads.js';
import { renderDoctor, renderInit, renderWrite } from './writes.js';

export function renderHuman(result, labels, { color = false, now = Date.now() } = {}) {
  const style = createStyle(color);
  const command = result.command;
  if (command === 'init') return renderInit(result, style);
  if (command === 'doctor') return renderDoctor(result, style);
  if (command === 'who') return renderWho(result, labels, style);
  if (command !== undefined) return renderWrite(result, style);
  if (Object.hasOwn(result, 'observedAt')) return renderBoard(result, labels, style, now);
  if (Object.hasOwn(result, 'advice')) return renderCheck(result, labels, style);
  if (Object.hasOwn(result, 'overlaps')) return renderOverlap(result, labels, style);
  return renderStatus(result, labels, style);
}

export function referencedNumbers(result, labels = createLabels()) {
  const numbers = new Set();
  const add = value => { if (Number.isSafeInteger(value) && value > 0) numbers.add(value); };
  if (Object.hasOwn(result, 'observedAt')) return boardNumbers(result, labels);
  for (const pull of result.pullRequests || []) add(pull);
  for (const overlap of result.overlaps || []) add(overlap.pullRequest);
  for (const claim of result.claims || []) add(claim.issue);
  for (const proposal of result.proposalsForMe || []) add(proposal.issue);
  for (const overlap of result.areaOverlaps || []) add(overlap.issue);
  add(result.issue);
  return [...numbers].sort((first, second) => first - second);
}
