import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const LIMIT = 2 ** 20;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export function requireThat(value, message) {
  if (!value) throw new Error(message);
}

// Portable regular-file names only: no links, traversal, ADS, reserved device names,
// case-fold aliases or platform-specific separators in any producer input/output.
export function safePath(name) {
  requireThat(typeof name === 'string' && name.length <= 240 && name.split('/').every(part =>
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.') &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), `Unsafe path: ${name}`);
  return name;
}

export function readRegular(root, relative) {
  safePath(relative);
  let current = path.resolve(root);
  requireThat(lstatSync(current).isDirectory() && !lstatSync(current).isSymbolicLink(), 'Linked/non-directory root');
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = lstatSync(current);
    requireThat(!stat.isSymbolicLink(), `Linked path: ${relative}`);
    requireThat(i === parts.length - 1 ? stat.isFile() && stat.size <= LIMIT : stat.isDirectory(),
      `Not a bounded regular file: ${relative}`);
  }
  return readFileSync(current);
}

export function writableDirectory(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    // lstat also detects dangling links (existsSync follows them and returns false).
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    requireThat(!stat.isSymbolicLink() && stat.isDirectory(), `Linked/non-directory output ancestor: ${current}`);
  }
  return absolute;
}

export function listFiles(root, prefix = '') {
  requireThat(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Linked/non-directory tree');
  return readdirSync(root).sort().flatMap(name => {
    const relative = safePath(prefix + name);
    const stat = lstatSync(path.join(root, name));
    requireThat(!stat.isSymbolicLink(), `Linked path: ${relative}`);
    if (stat.isDirectory()) return listFiles(path.join(root, name), `${relative}/`);
    requireThat(stat.isFile(), `Not a regular file: ${relative}`);
    return [relative];
  });
}

export function sameSet(actual, expected, label) {
  requireThat(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `${label} file set mismatch`);
  requireThat(new Set(actual.map(p => p.toLowerCase())).size === actual.length, `${label} case alias`);
}
