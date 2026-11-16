// Deterministic POSIX ustar, uncompressed. Every entry is a regular file with
// mode 0644 or 0755, uid/gid 0, empty owner names and mtime 0, in UTF-8 byte
// order of its path. A path that ustar cannot hold is an error, never PAX.
const BLOCK = 512;
const PERMISSIONS = new Set([0o644, 0o755]);

function splitPath(path) {
  const bytes = Buffer.from(path);
  if (bytes.length <= 100) return { name: bytes, prefix: Buffer.alloc(0) };
  for (let i = bytes.length - 1; i > 0; i--) {
    if (bytes[i] !== 0x2f) continue;
    const prefix = bytes.subarray(0, i);
    const name = bytes.subarray(i + 1);
    if (prefix.length <= 155 && name.length <= 100 && name.length > 0) return { name, prefix };
  }
  throw new Error(`Path does not fit ustar: ${path}`);
}

const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;

function header(path, mode, size) {
  if (!PERMISSIONS.has(mode)) throw new Error(`Unsupported archive mode ${mode.toString(8)}: ${path}`);
  if (!Number.isSafeInteger(size) || size < 0 || size >= 8 ** 11) throw new Error(`Unsupported archive size: ${path}`);
  const { name, prefix } = splitPath(path);
  const block = Buffer.alloc(BLOCK);
  name.copy(block, 0);
  block.write(octal(mode, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.fill(0x20, 148, 156);
  block.write('0', 156, 'ascii');
  block.write('ustar\0' + '00', 257, 'ascii');
  prefix.copy(block, 345);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

export function writeTar(entries) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const { path, mode, bytes } = sorted[i];
    if (i > 0 && sorted[i - 1].path === path) throw new Error(`Duplicate archive path: ${path}`);
    parts.push(header(path, mode, bytes.length), bytes, Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

const field = (block, start, length) => {
  const end = block.indexOf(0, start);
  return block.subarray(start, end === -1 || end > start + length ? start + length : end);
};

// Reads only what writeTar writes; the caller compares writeTar(readTar(x))
// with x to reject any other encoding of the same files.
export function readTar(bytes) {
  if (bytes.length % BLOCK !== 0 || bytes.length < 2 * BLOCK) throw new Error('Not a ustar archive');
  const entries = [];
  let offset = 0;
  for (;;) {
    if (offset + BLOCK > bytes.length) throw new Error('Truncated ustar archive');
    const block = bytes.subarray(offset, offset + BLOCK);
    if (block.every(byte => byte === 0)) break;
    if (field(block, 257, 6).toString('latin1') !== 'ustar' || block.toString('latin1', 263, 265) !== '00' ||
      block.toString('latin1', 156, 157) !== '0') throw new Error('Unsupported ustar entry');
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
    if (parseInt(field(block, 148, 8).toString('latin1'), 8) !== sum) throw new Error('Bad ustar checksum');
    const name = field(block, 0, 100).toString('utf8');
    const prefix = field(block, 345, 155).toString('utf8');
    const path = prefix ? `${prefix}/${name}` : name;
    const mode = parseInt(field(block, 100, 8).toString('latin1'), 8);
    const size = parseInt(field(block, 124, 12).toString('latin1'), 8);
    if (!Number.isSafeInteger(size) || offset + BLOCK + size > bytes.length) throw new Error(`Truncated ustar entry: ${path}`);
    entries.push({ path, mode, bytes: Buffer.from(bytes.subarray(offset + BLOCK, offset + BLOCK + size)) });
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (offset + 2 * BLOCK !== bytes.length || !bytes.subarray(offset).every(byte => byte === 0)) {
    throw new Error('Unexpected data after ustar end');
  }
  return entries;
}
