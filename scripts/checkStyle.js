import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'scripts'];
const files = [];
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
for (const root of roots) visit(root);
let errors = 0;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  if (lines.length > 220) {
    process.stderr.write(`${file}: too many lines (${lines.length}, max 220)\n`);
    errors += 1;
  }
  if (/\/\*|\*\//.test(content)) {
    process.stderr.write(`${file}: multiline comment syntax is disallowed\n`);
    errors += 1;
  }
  const names = [...content.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z][A-Za-z0-9]*)/g)];
  for (const [, name] of names) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
      process.stderr.write(`${file}: function ${name} must use camelCase\n`);
      errors += 1;
    }
  }
}
process.stdout.write(`Checked ${files.length} JavaScript modules for modularity and style.\n`);
if (errors) process.exitCode = 1;
