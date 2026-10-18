/**
 * The document a case in documents.vectors.json describes: its `document`,
 * with each `fill` (a string of `length` characters at `path`, `prefix` and
 * `suffix` included, the rest "a") and each `repeat` (`times` copies of
 * `item` at `path`) applied. A fresh copy every time.
 */
export function caseDocument(c) {
  const doc = structuredClone(c.document);
  const at = (path, value) => {
    let node = doc;
    for (const key of path.slice(0, -1)) {
      node[key] ??= typeof key === 'number' ? [] : {};
      node = node[key];
    }
    node[path[path.length - 1]] = value;
  };
  for (const { path, length, prefix = '', suffix = '' } of c.fill ?? []) {
    at(path, prefix + 'a'.repeat(length - prefix.length - suffix.length) + suffix);
  }
  for (const { path, times, item } of c.repeat ?? []) {
    at(
      path,
      Array.from({ length: times }, () => structuredClone(item)),
    );
  }
  return doc;
}
