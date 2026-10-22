export const lineLimit = 1048576;

export function createFraming({ onLine, onOversize, limit = lineLimit }) {
  let buffer = '';
  let discarding = false;
  return {
    push(chunk) {
      const text = buffer + chunk;
      buffer = '';
      let start = 0;
      for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', start)) {
        const line = text.slice(start, end).replace(/\r$/, '');
        start = end + 1;
        if (discarding) discarding = false;
        else if (Buffer.byteLength(line) > limit) onOversize();
        else if (line.trim()) onLine(line);
      }
      if (discarding) return;
      const rest = text.slice(start);
      if (Buffer.byteLength(rest) > limit) {
        discarding = true;
        onOversize();
      } else buffer = rest;
    },
    end() {
      const rest = buffer.replace(/\r$/, '');
      buffer = '';
      if (!discarding && rest.trim()) onLine(rest);
    }
  };
}

export function parseLine(line) {
  try {
    return { ok: true, message: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}
