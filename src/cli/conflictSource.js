import fs from 'node:fs';
import path from 'node:path';

const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const limit = 1024 * 1024;
const marker = /^(?:<{7}|={7}|>{7}|\|{7})/m;

export function conflictSource(git) {
  function run(args) {
    const result = git.exec(args);
    return result?.status === 0 && typeof result.stdout === 'string' && Buffer.byteLength(result.stdout) <= limit ? result.stdout : null;
  }
  function regular(ref, file) {
    const row = run(['ls-tree', '-z', ref, '--', `:(literal)${file}`]);
    const match = row?.match(/^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/);
    return match && match[3] === file ? { mode: match[1], oid: match[2] } : null;
  }
  function text(ref, file, input = false) {
    const entry = regular(ref, file);
    const raw = entry && run(['cat-file', 'blob', entry.oid]);
    if (!raw || !raw.endsWith('\n') || /[\0\r\uFFFD]/.test(raw) || (input && marker.test(raw))) return null;
    return { ...entry, lines: raw.slice(0, -1).split('\n') };
  }
  function attributes(ref, file) {
    const args = ['check-attr', '-z', ...(ref ? [`--source=${ref}`] : []), 'merge', 'conflict-marker-size', 'working-tree-encoding', '--', file];
    const values = run(args)?.split('\0');
    if (!values || values.length !== 10 || values[9] !== '') return false;
    return ['merge', 'conflict-marker-size', 'working-tree-encoding'].every((name, i) => values[i * 3] === file && values[i * 3 + 1] === name
      && (values[i * 3 + 2] === 'unspecified' || (i === 0 && values[2] === 'text') || (i === 1 && values[5] === '7')));
  }
  function config() {
    for (const [name, allowed] of [['merge.renormalize', 'false'], ['merge.conflictstyle', 'merge'], ['merge.default', 'text']]) {
      const result = git.exec(['config', '--get', name]);
      if (!result || ![0, 1].includes(result.status) || (result.status === 1 && result.stdout !== '')
        || (result.status === 0 && result.stdout !== `${allowed}\n`)) return false;
    }
    return true;
  }
  function history() {
    if (['GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_REPLACE_REF_BASE'].some(name => Object.hasOwn(process.env, name))) return false;
    if (run(['replace', '--list']) !== '' || run(['rev-parse', '--is-shallow-repository']) !== 'false\n') return false;
    const file = run(['rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'])?.replace(/\r?\n$/, '');
    if (!file || !path.isAbsolute(file) || !/^[^\u0000-\u001f\u007f]{1,4096}$/.test(file)) return false;
    try { fs.lstatSync(file); return false; } catch (error) { return error.code === 'ENOENT'; }
  }
  function ancestor(first, second) {
    const value = run(['merge-base', '--all', first, second])?.trim();
    return value && sha.test(value) ? value : null;
  }
  return { run, text, attributes, config, history, ancestor };
}
