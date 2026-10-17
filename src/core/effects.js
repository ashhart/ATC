export function result(outcome, effects = []) {
  return { outcome, effects };
}

export function comment(issue, template, values = {}) {
  return { type: 'comment', issue, template, values };
}

export function assign(issue, logins) {
  return { type: 'assign', issue, logins };
}

export function unassign(issue, logins) {
  return { type: 'unassign', issue, logins };
}
