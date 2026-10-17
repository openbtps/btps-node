/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The DNS the journeys run against: TXT records as a domain publishes them,
// split into 255-character strings as DNS carries them. Each journey file
// mocks `dns/promises` with `dnsModule`, so every lookup the SDK makes reads
// the records' real published text.

const records = new Map<string, string>();

export const zone = {
  set(name: string, txt: string) {
    records.set(name, txt);
  },
  delete(name: string) {
    records.delete(name);
  },
  clear() {
    records.clear();
  },
};

export const dnsModule = {
  resolveTxt: async (name: string): Promise<string[][]> => {
    const txt = records.get(name);
    if (txt === undefined) {
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
    }
    return [txt.match(/.{1,255}/g) ?? []];
  },
};
