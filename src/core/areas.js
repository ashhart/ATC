export function areaEntries(config) {
  return config?.areasPinned ? Object.entries(config.areaIds).sort((first, second) => first[1] - second[1]) : [];
}

export function areaReference(config, name) {
  return areaEntries(config).find(([area]) => area === name)?.[1] ?? null;
}

export function areaName(config, reference) {
  if (typeof reference !== 'number' && typeof reference !== 'string') return null;
  const number = typeof reference === 'number' ? reference : Number(reference);
  if (!Number.isSafeInteger(number) || number < 1 || number > 24
    || typeof reference !== 'number' && (typeof reference !== 'string' || String(number) !== reference)) return null;
  return areaEntries(config).find(([, id]) => id === number)?.[0] ?? null;
}
