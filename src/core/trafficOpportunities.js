export function trafficOpportunities(issues, claims, config, me, complete) {
  const opportunities = [];
  for (const issue of issues) {
    if (issue.state !== 'open') continue;
    const here = claims.filter(claim => claim.issue === issue.issue);
    const work = here.filter(claim => claim.role === 'work');
    const free = work.length === 0 && issue.assignees.length === 0 && issue.pullRequests.length === 0;
    const otherWork = work.some(claim => claim.login !== me) && !here.some(claim => claim.login === me);
    const actions = ['check'];
    const writable = complete && config.enabled !== false;
    if (writable && free) actions.push('claim');
    else if (writable && otherWork) {
      actions.push('proposePair', 'proposeReview');
      if (canSplit(work, config)) actions.push('proposeSplit');
    }
    const add = (reason, signal) => opportunities.push({ issue: issue.issue, reason, signal, actions: [...actions] });
    if (issue.helpWanted) add('helpWanted', 'request');
    if (issue.goodFirstIssue) add('goodFirstIssue', 'candidate');
    if (free) add('unassigned', 'candidate');
    if (otherWork) add('activeClaim', 'candidate');
  }
  return opportunities;
}

function canSplit(work, config) {
  const scopes = work.map(claim => claim.areas.length > 0 ? claim.areas : Object.keys(config.areas));
  return scopes.some((scope, index) => scope.length > 1
    && scope.some(area => !scopes.some((other, otherIndex) => otherIndex !== index && other.includes(area))));
}
