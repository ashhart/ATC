export function potentialOverlap(first, second) {
  for (const file of first) {
    if (second.has(file) || hasParent(file, second)) return true;
  }
  for (const file of second) if (hasParent(file, first)) return true;
  return false;
}

function hasParent(file, files) {
  for (let end = file.indexOf('/'); end !== -1; end = file.indexOf('/', end + 1)) {
    if (files.has(file.slice(0, end))) return true;
  }
  return false;
}
