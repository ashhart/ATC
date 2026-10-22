const successful = new Set(['claimed', 'claimUpdated', 'renewed', 'released', 'proposed', 'accepted', 'declined', 'withdrawn', 'dryRun', 'checkedIn', 'landed']);

export function resultExitCode(result, strict = false) {
  if (!strict) return 0;
  if (result.publication === 'unavailable') return 2;
  if (result.complete === false || result.ready === false || result.outcome === 'changesNeeded') return 2;
  if (result.advice && (!['free', 'yours'].includes(result.advice) || result.areaOverlaps.some(overlap => !overlap.mine))) return 2;
  if (result.overlaps?.length > 0 || result.fileOverlaps?.length > 0 || result.worktreeOverlaps?.length > 0) return 2;
  if (Object.hasOwn(result, 'posted') && !successful.has(result.outcome)) return 2;
  return 0;
}
