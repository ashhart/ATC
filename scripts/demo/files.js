export const backlog = [
  { number: 1, title: 'Router drops the trailing slash', labels: ['good first issue'] },
  { number: 2, title: 'Parser rejects unicode input', labels: [] },
  { number: 3, title: 'Document router options', labels: [] },
  { number: 4, title: 'Add router regression tests', labels: ['good first issue'] }
];

export const config = {
  areaIds: { router: 1, parser: 2, docs: 3, tests: 4 },
  areas: { router: ['src/router.js'], parser: ['src/parser.js'], docs: ['docs/'], tests: ['tests/'] }
};

const router = line => `export function normalize(path) {\n${line}\n}\n\nexport function route(table, path) {\n  return table[normalize(path)] || null;\n}\n`;
const parser = line => `export function parse(input) {\n${line}\n  return input.trim().split(/\\s+/);\n}\n`;
const guide = '# Guide\n\nRoutes map paths to handlers.\n';
const tests = "import { route } from '../src/router.js';\n\nconsole.assert(route({ '/a': 1 }, '/a') === 1);\n";

export const baseFiles = {
  'src/router.js': router("  return path.replace(/\\/+$/, '');"),
  'src/parser.js': parser("  if (!/^[\\x20-\\x7e]+$/.test(input)) throw new Error('unsupported');"),
  'docs/guide.md': guide,
  'tests/router.test.js': tests
};

export const changes = {
  keepSlash: { 'src/router.js': router("  return path.length > 1 ? path.replace(/\\/+$/, '/') : path;") },
  collapseSlash: { 'src/router.js': router("  return path === '/' ? path : path.replace(/\\/{2,}$/, '/');") },
  unicode: { 'src/parser.js': parser("  if (typeof input !== 'string') throw new Error('unsupported');") },
  routerDocs: { 'docs/guide.md': `${guide}\n## Router options\n\nnormalize keeps one trailing slash, so /a/ and /a are different routes.\n` },
  regressionTests: { 'tests/router.test.js': `${tests}console.assert(route({ '/a/': 2 }, '/a/') === 2);\nconsole.assert(route({ '/a/': 2 }, '/a//') === 2);\n` },
  routerHelper: { 'src/router.js': `${router('  return trimSlashes(path);')}\nexport function trimSlashes(path) {\n  return path.replace(/\\/+$/, '');\n}\n` }
};
