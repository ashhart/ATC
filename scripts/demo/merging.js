export async function mergeAll(world, pulls, say) {
  await say.note(say.style.dim('The maintainer merges the PRs in the order they were opened:'));
  let merged = 0;
  let conflicts = 0;
  for (const pull of pulls) {
    const result = world.merge(pull);
    if (result.merged) {
      merged += 1;
      await say.say('mae', `${say.style.green('merged')}   PR #${pull.number} by ${pull.author}`);
    } else {
      conflicts += 1;
      await say.say('mae', `${say.style.red('conflict')} PR #${pull.number} by ${pull.author} conflicts with main in ${result.conflicts.join(', ')}. Wasted.`);
    }
  }
  return { merged, wasted: pulls.length - merged, conflicts };
}
