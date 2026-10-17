export class Failure extends Error {}

export function ensure(condition, message) {
  if (!condition) throw new Failure(message);
}
