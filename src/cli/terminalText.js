const unsafe = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿]/g;

export function safeText(value, maximum = 72) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(unsafe, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const characters = [...clean];
  return characters.length > maximum ? `${characters.slice(0, maximum - 1).join('')}…` : clean;
}

export function createStyle(enabled) {
  const wrap = code => text => enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
  return { bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33'), cyan: wrap('36') };
}

export function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

export function ago(iso, now) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function fileList(files, maximum = 3) {
  const names = (files || []).map(file => safeText(file, 60)).filter(Boolean);
  if (names.length === 0) return '';
  const shown = names.slice(0, maximum).join(', ');
  return names.length > maximum ? `${shown} and ${names.length - maximum} more` : shown;
}

export function createLabels() {
  return { repository: null, titles: new Map(), contributors: new Map(), shared: new Map(), conflicts: new Map(), worktrees: new Map(), agents: [] };
}
