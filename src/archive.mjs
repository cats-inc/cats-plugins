import { unzipSync, zipSync } from 'fflate';
import { LIMIT, requireThat, safePath, sameSet, sha256 } from './files.mjs';

export function pack(files) {
  // Stored ZIP (no compression), fixed local calendar date and lexicographic order.
  // No absolute paths, generated clocks or executable modes enter the artifact.
  const entries = Object.fromEntries(Object.keys(files).sort().map(name => [safePath(name), [files[name], {
    level: 0, mtime: new Date(2000, 0, 1, 0, 0, 0), os: 3, attrs: 0o100644 << 16,
  }]]));
  return Buffer.from(zipSync(entries));
}

export function verifyArchive(bytes, expectedFiles, expectedDigest) {
  requireThat(bytes.length <= 8 * LIMIT, 'Artifact too large');
  if (expectedDigest !== undefined) {
    requireThat(/^[a-f0-9]{64}$/.test(expectedDigest) && sha256(bytes) === expectedDigest, 'Artifact digest mismatch');
  }
  const seen = new Set();
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    safePath(entry.name);
    requireThat(!seen.has(entry.name.toLowerCase()), 'Duplicate/case-alias ZIP entry');
    seen.add(entry.name.toLowerCase());
    total += entry.originalSize;
    requireThat(seen.size <= 64 && entry.compression === 0 && entry.size === entry.originalSize &&
      entry.originalSize <= LIMIT && total <= 8 * LIMIT, 'Unsupported ZIP method or size');
    return true;
  } });
  sameSet(Object.keys(files), Object.keys(expectedFiles), 'Artifact');
  for (const [file, expected] of Object.entries(expectedFiles)) {
    requireThat(Buffer.from(files[file]).equals(expected), `Artifact content mismatch: ${file}`);
  }
  requireThat(Buffer.from(bytes).equals(pack(expectedFiles)), 'Noncanonical producer archive');
  return { sha256: sha256(bytes), files: Object.keys(files).length, bytes: bytes.length };
}
