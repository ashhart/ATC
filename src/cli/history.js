import { readIssue, readOpenIssues } from './graphIssues.js';

export function readOpenHistory(context) {
  const opened = readOpenIssues(context.gh, context.repository);
  const comments = [];
  let remaining = 120;
  let partial = false;
  let inconsistent = false;
  for (const { issue, comments: inline, overflow } of opened.items) {
    if (!overflow) {
      comments.push(...inline);
      if (inline.length !== issue.commentCount) inconsistent = true;
      continue;
    }
    if (remaining < 2) { partial = true; continue; }
    const fetched = context.reader.issueComments(issue.number, Math.min(30, remaining - 1));
    comments.push(...fetched.items);
    partial ||= fetched.partial;
    if (!fetched.partial && fetched.items.length !== issue.commentCount) inconsistent = true;
    remaining -= fetched.requests;
  }
  return { issues: opened.items.map(item => item.issue), comments, issuesPartial: opened.partial, commentsPartial: partial, inconsistent };
}

export function readIssueHistory(context, number) {
  const read = readIssue(context.gh, context.repository, number);
  if (!read.open || !read.overflow) return { open: read.open, comments: read.comments, complete: read.comments.length === read.commentCount };
  const fetched = context.reader.issueComments(number, 30);
  return { open: true, comments: fetched.items, complete: !fetched.partial && fetched.items.length === read.commentCount };
}
