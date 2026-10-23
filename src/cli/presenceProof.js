import { createHash } from 'node:crypto';
import { ensure } from '../core/failure.js';
import { isRepository } from '../core/values.js';

const failure = 'Invalid public presence settings.';

export function proofText(token) {
  return `/atc presence ${createHash('sha256').update(token).digest('hex')}`;
}

export function removeProof(gh, repository, settings) {
  ensure(isRepository(repository), failure);
  const comment = gh.getOptional(`repos/${repository}/issues/comments/${settings.comment}`);
  if (comment === null) return;
  const issueUrl = `https://api.github.com/repos/${repository}/issues/${settings.issue}`.toLowerCase();
  ensure(comment?.id === settings.comment && comment.body === proofText(settings.token)
    && typeof comment.issue_url === 'string' && comment.issue_url.toLowerCase() === issueUrl, failure);
  gh.deleteComment(repository, settings.comment);
}
