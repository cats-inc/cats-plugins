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
  const seen = new Set();
  return [...entries].sort(byPath).map(entry => {
    upstreamPath(entry.path);
    if (!MODES.has(entry.mode)) throw new Error(`Unsupported upstream mode ${entry.mode}: ${entry.path}`);
    const folded = entry.path.toLowerCase();
    if (seen.has(folded)) throw new Error(`Duplicate or case-alias upstream path: ${entry.path}`);
    seen.add(folded);
    return `${entry.mode} ${sha256(entry.bytes)} ${entry.bytes.length} ${entry.path}\n`;
  }).join('');
}

export const contentSha256 = entries => sha256(contentManifest(entries));
