import { sha256 } from '../files.mjs';

export const MODES = new Set(['100644', '100755']);

// Upstream trees use names that the producer's own safePath rejects (spaces,
// leading dots). This check keeps only what cannot escape or collide when
// extracted: relative, forward-slash, no traversal, no NUL or control
// characters, no backslash, no Git metadata, no case-folded duplicates.
export function upstreamPath(name) {
  if (typeof name !== 'string' || name.length === 0 || Buffer.byteLength(name) > 255 ||
    name.startsWith('/') || name.endsWith('/') || /[\0-\x1f\x7f\\:]/u.test(name)) {
    throw new Error(`Unsafe upstream path: ${JSON.stringify(name)}`);
  }
  for (const part of name.split('/')) {
    if (part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git') {
      throw new Error(`Unsafe upstream path: ${JSON.stringify(name)}`);
    }
  }
  return name;
}

export const byPath = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

// The content hash covers every file of the tree: one line per file, ordered by
// the path's UTF-8 bytes, "<git mode> <sha256> <size> <path>\n". The hash is
// the SHA-256 of those lines. Only regular files exist (no links or submodules).
export function contentManifest(entries) {
  const files = new Set();
  const directories = new Set();
  const lines = [...entries].sort(byPath).map(entry => {
    upstreamPath(entry.path);
    if (!MODES.has(entry.mode)) throw new Error(`Unsupported upstream mode ${entry.mode}: ${entry.path}`);
    const folded = entry.path.toLowerCase();
    if (files.has(folded)) throw new Error(`Duplicate or case-alias upstream path: ${entry.path}`);
    files.add(folded);
    const parts = folded.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
    return `${entry.mode} ${sha256(entry.bytes)} ${entry.bytes.length} ${entry.path}\n`;
  });
  // A file and a directory whose names differ only in case collide on
  // case-insensitive file systems.
  for (const file of files) {
    if (directories.has(file)) throw new Error(`Upstream file and directory collide by case: ${file}`);
  }
  return lines.join('');
}

export const contentSha256 = entries => sha256(contentManifest(entries));
