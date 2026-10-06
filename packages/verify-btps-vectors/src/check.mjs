/**
 * A check is one named assertion over the vectors. Its id is stable, because
 * known-failing lists and CI logs refer to it.
 *
 * @typedef {object} Check
 * @property {string} id      e.g. "vectors/web/jcs/key-order-is-insignificant"
 * @property {number} [item]  the BTPS 1.1 addendum item it proves, if any
 * @property {string[]} [tickets] the tickets that own the fix
 * @property {() => Promise<void> | void} run throws CheckFailure (or anything) to fail
 */

export class CheckFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckFailure';
  }
}

/** @param {unknown} condition @param {string} message */
export function ensure(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

/**
 * Passes only if `fn` throws or rejects.
 * @param {() => unknown} fn
 * @param {string} message
 */
export async function ensureRejects(fn, message) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  ensure(threw, message);
}
