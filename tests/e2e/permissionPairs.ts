/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// An all-pairs covering array over permission names: grants such that for
// every two names, each of the four ways (both granted, either alone, neither)
// is in at least one grant. Greedy over every possible grant, ties to the
// lowest, so the same names always give the same array.

/** The bit of each name a grant (a number) holds. */
const has = (grant: number, i: number) => ((grant >> i) & 1) === 1;

/** Every pair of names and each of its four ways, as `i,j,a,b`. */
const allWays = (count: number): Set<string> => {
  const ways = new Set<string>();
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      for (const a of [0, 1]) for (const b of [0, 1]) ways.add(`${i},${j},${a},${b}`);
    }
  }
  return ways;
};

const waysOf = (grant: number, count: number): string[] => {
  const ways: string[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      ways.push(`${i},${j},${Number(has(grant, i))},${Number(has(grant, j))}`);
    }
  }
  return ways;
};

/** The ways of every pair that `grants` leave out: empty when they cover all pairs. */
export const uncoveredPairs = (grants: readonly number[], count: number): string[] => {
  const left = allWays(count);
  for (const grant of grants) for (const way of waysOf(grant, count)) left.delete(way);
  return [...left];
};

/** The covering array over `count` names, as grants (bit i: name i granted). */
export const coveringArray = (count: number): number[] => {
  const left = allWays(count);
  const grants: number[] = [];
  while (left.size > 0) {
    let best = 0;
    let bestGain = -1;
    for (let grant = 0; grant < 2 ** count; grant++) {
      const gain = waysOf(grant, count).filter((way) => left.has(way)).length;
      if (gain > bestGain) {
        best = grant;
        bestGain = gain;
      }
    }
    grants.push(best);
    for (const way of waysOf(best, count)) left.delete(way);
  }
  return grants;
};

/** The names a grant holds. */
export const namesOf = <T>(grant: number, names: readonly T[]): T[] =>
  names.filter((_name, i) => has(grant, i));
