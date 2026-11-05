export function renderWork(result, style) {
  const lines = [style.bold(`ATC ${result.command}: ${result.outcome}`)];
  if (result.issue !== null) lines.push(`  Issue #${result.issue}, ${result.files} planned files`);
  if (result.session !== null) lines.push(`  Session ${result.session}${result.plan !== null ? `, plan ${result.plan}` : ''}`);
  for (const row of result.conflicts) lines.push(`  ${row.sharedFiles} files also planned on #${row.issue}, session ${row.session}`);
  if (!result.ready) lines.push('  Work is not cleared; inspect the result before continuing.');
  if (result.outcome === 'noTicket') lines.push('  No work ticket exists in this worktree.');
  return lines.join('\n');
}

export function renderLanding(result, style) {
  if (result.command === 'depends') return `${style.bold(`PR #${result.pull}: ${result.outcome}`)}\n  Dependencies: ${result.dependencies.map(x => `#${x}`).join(', ') || 'none'}`;
  const lines = [style.bold(`Landing guidance: ${result.advice}`), `  Suggested order: ${result.order.map(x => `#${x}`).join(', ') || 'none'}`];
  if (result.cycles.length) lines.push(`  Dependency cycle: ${result.cycles.map(x => `#${x}`).join(', ')}`);
  if (result.blocked.length) lines.push(`  Blocked: ${result.blocked.map(x => `#${x}`).join(', ')}`);
  if (!result.complete) lines.push(`  Incomplete: ${result.limitations.join(', ')}`);
  lines.push('  GitHub reviews and required checks govern merging.');
  return lines.join('\n');
}
