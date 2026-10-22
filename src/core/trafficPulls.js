import { areasForPath } from './config.js';
import { sharedFiles } from './pulls.js';

export function pullTraffic(pulls, config, pullFiles, actor, limitations) {
  const rows = [...pulls].sort((first, second) => first.number - second.number).map(pull => {
    const files = pullFiles.get(pull.number);
    if (!(files instanceof Set)) limitations.add('pullFilesUnavailable');
    return { pullRequest: pull.number, ...actor(pull.author), draft: pull.draft,
      issues: [...pull.issues].sort((first, second) => first - second),
      areas: files instanceof Set ? [...new Set([...files].flatMap(file => areasForPath(config, file)))].sort() : [],
      changedFiles: files instanceof Set ? files.size : null,
      createdAt: new Date(pull.createdAt).toISOString(), updatedAt: new Date(pull.updatedAt).toISOString() };
  });
  const authors = new Map(pulls.map(pull => [pull.number, pull.author]));
  const fileOverlaps = [];
  const areaOverlaps = [];
  for (let index = 0; index < rows.length; index += 1) {
    const first = rows[index];
    for (const second of rows.slice(index + 1)) {
      if (authors.get(first.pullRequest) === authors.get(second.pullRequest)) continue;
      if (first.contributor !== null && first.contributor === second.contributor) continue;
      const pair = [first.pullRequest, second.pullRequest];
      const areas = first.areas.filter(area => second.areas.includes(area));
      if (areas.length > 0) areaOverlaps.push({ pullRequests: pair, areas });
      const firstFiles = pullFiles.get(first.pullRequest);
      const secondFiles = pullFiles.get(second.pullRequest);
      if (!(firstFiles instanceof Set) || !(secondFiles instanceof Set)) continue;
      const shared = sharedFiles(firstFiles, secondFiles, config);
      if (shared.sharedFiles > 0) fileOverlaps.push({ pullRequests: pair, ...shared });
    }
  }
  return { pullRequests: rows, fileOverlaps, areaOverlaps };
}
