import { renderMessage } from '../core/messages.js';

export async function applyEffects(github, effects, log) {
  for (const effect of effects) {
    try {
      if (effect.type === 'comment') await github.createComment(effect.issue, renderMessage(effect.template, effect.values));
      if (effect.type === 'assign') await github.addAssignees(effect.issue, effect.logins);
      if (effect.type === 'unassign') await github.removeAssignees(effect.issue, effect.logins);
      if (effect.type === 'react') await github.react(effect.comment, effect.content);
    } catch {
      log(`ATC: a ${effect.type} step failed`);
    }
  }
}
