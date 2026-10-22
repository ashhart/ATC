import { booleanValue, enumValue, record } from './outputTypes.js';

export const initOutput = record({ command: enumValue('init'), outcome: enumValue('initialized', 'ready', 'changesNeeded'), check: booleanValue,
  config: enumValue('created', 'present', 'planned'), skill: enumValue('created', 'present', 'planned'),
  agents: enumValue('created', 'updated', 'present', 'planned'), contributing: enumValue('created', 'updated', 'present', 'planned'),
  cursor: enumValue('created', 'present', 'planned') });

export const doctorOutput = record({ command: enumValue('doctor'), ready: booleanValue, checks: record({
  node: enumValue('ok', 'unsupported'), git: enumValue('ok', 'missing'), clone: enumValue('ok', 'missing', 'skipped'),
  gh: enumValue('ok', 'missing'), authentication: enumValue('ok', 'failed', 'skipped'), repository: enumValue('ok', 'failed', 'skipped'),
  remote: enumValue('ok', 'missing', 'failed', 'skipped', 'notRequired'), configuration: enumValue('ok', 'missing', 'invalid', 'unpinned', 'skipped')
}) });
