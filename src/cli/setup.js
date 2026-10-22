import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../core/config.js';
import { Failure, ensure } from '../core/failure.js';
import { canonicalFolder } from './localPaths.js';
import { appendText, createDirectory, createFile, failed, inspectDirectory, readFile, unsafe } from './safeFiles.js';
import { contributingStanza, cursorRule } from './setupGuides.js';

const stanza = '\n## Agent Traffic Control\n\nBefore working on an issue, follow [the ATC contributor skill](skills/atc/SKILL.md).\n';
const defaults = { areaIds: { code: 1, docs: 2, tests: 3 }, areas: { code: ['src/'], docs: ['docs/', 'README.md'], tests: ['tests/', 'test/'] } };
const packageSkill = fileURLToPath(new URL('../../skills/atc/SKILL.md', import.meta.url));

export function initRepository({ cwd = process.cwd(), check = false } = {}) {
  ensure(typeof check === 'boolean', 'Invalid initialization options.');
  const created = [];
  try {
    const root = repositoryRoot(cwd);
    for (const relative of ['.github', 'skills', 'skills/atc', '.cursor', '.cursor/rules']) inspectDirectory(path.join(root, relative));
    const files = {
      config: path.join(root, '.github/atc.json'),
      skill: path.join(root, 'skills/atc/SKILL.md'),
      agents: path.join(root, 'AGENTS.md'),
      contributing: path.join(root, readFile(path.join(root, '.github/CONTRIBUTING.md'), 262144) === null ? 'CONTRIBUTING.md' : '.github/CONTRIBUTING.md'),
      cursor: path.join(root, '.cursor/rules/atc.mdc')
    };
    const config = readFile(files.config, 65536);
    if (config !== null) validateConfig(config);
    const skill = readFile(files.skill, 65536);
    const agents = readText(files.agents);
    const contributing = readText(files.contributing);
    const cursor = readFile(files.cursor, 65536);
    const linked = agents?.includes('skills/atc/SKILL.md') === true;
    const guided = contributing?.includes('Agent Traffic Control') === true;
    const skillContent = skill === null ? readFile(packageSkill, 65536) : null;
    ensure(skill !== null || skillContent !== null, failed);
    const needed = config === null || skill === null || !linked || !guided || cursor === null;
    const status = (missing, existing) => missing ? (check ? 'planned' : existing === null ? 'created' : 'updated') : 'present';
    const result = {
      command: 'init', outcome: needed ? (check ? 'changesNeeded' : 'initialized') : 'ready', check,
      config: config === null ? (check ? 'planned' : 'created') : 'present',
      skill: skill === null ? (check ? 'planned' : 'created') : 'present',
      agents: status(!linked, agents), contributing: status(!guided, contributing),
      cursor: cursor === null ? (check ? 'planned' : 'created') : 'present'
    };
    if (check || !needed) return result;
    for (const relative of ['.github', 'skills', 'skills/atc']) createDirectory(path.join(root, relative), created);
    if (config === null) createFile(files.config, `${JSON.stringify(defaults, null, 2)}\n`, created);
    if (skill === null) createFile(files.skill, skillContent, created);
    if (!linked && agents === null) createFile(files.agents, `# Contributor instructions\n${stanza}`, created);
    else if (!linked) appendText(files.agents, agents, stanza);
    if (!guided && contributing === null) createFile(files.contributing, `# Contributing\n${contributingStanza}`, created);
    else if (!guided) appendText(files.contributing, contributing, contributingStanza);
    if (cursor === null) {
      for (const relative of ['.cursor', '.cursor/rules']) createDirectory(path.join(root, relative), created);
      createFile(files.cursor, cursorRule, created);
    }
    return result;
  } catch (error) {
    for (const entry of created.reverse()) {
      try { entry.directory ? fs.rmdirSync(entry.file) : fs.unlinkSync(entry.file); } catch {}
    }
    throw error instanceof Failure ? error : new Failure(failed);
  }
}

function readText(file) {
  const content = readFile(file, 262144);
  ensure(content === null || !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content), unsafe);
  return content;
}

function repositoryRoot(cwd) {
  ensure(typeof cwd === 'string' && path.isAbsolute(cwd) && safePath(cwd), unsafe);
  inspectAncestors(cwd);
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 8192, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  ensure(result.status === 0 && typeof result.stdout === 'string', 'Run atc init inside a git repository.');
  const reported = result.stdout.replace(/\r?\n$/, '');
  ensure(path.isAbsolute(reported) && safePath(reported), unsafe);
  inspectAncestors(path.resolve(reported));
  const root = canonicalFolder(reported);
  ensure(safePath(root), unsafe);
  inspectAncestors(root);
  const relative = path.relative(root, canonicalFolder(cwd));
  ensure(relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)), unsafe);
  return root;
}

function safePath(value) {
  return /^[^\u0000-\u001f\u007f]{1,4096}$/.test(value) && !/[\u0000-\u001f\u007f]/.test(value)
    && !value.split(path.sep).some(part => part === '.' || part === '..');
}

function inspectAncestors(folder) {
  const parsed = path.parse(folder);
  let current = parsed.root;
  for (const part of folder.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), unsafe);
  }
}

function validateConfig(content) {
  try { readConfig(JSON.parse(content)); } catch { throw new Failure('Invalid .github/atc.json'); }
}
