// The .catspack archive (Platform SPEC-145 FR-A2, cats-plugins SPEC-002 FR-C3,
// FR-D3): a stored ZIP written and verified by streaming, so model files of
// any size up to ZIP32 never sit in memory. ADR-001's in-memory pack and
// verifyArchive are not used here.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { requireThat, safePath } from '../files.mjs';

export const MANIFEST_PATH = 'feature-pack.json';
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0;
const FILE_MODE = 0o100644; // the host sets modes from the manifest
const ZIP32 = 0xffffffff;
const MAX_ENTRIES = 4096;
const MAX_CENTRAL = 2 ** 20;
const MAX_MANIFEST = 2 ** 20;

const byPath = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

async function* chunks(entry) {
  if (entry.bytes) yield entry.bytes;
  else yield* createReadStream(entry.file, { highWaterMark: 2 ** 20 });
}

async function measure(entry) {
  let crc = 0;
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of chunks(entry)) {
    crc = crc32(chunk, crc);
    size += chunk.length;
    hash.update(chunk);
  }
  return { crc, size, sha256: hash.digest('hex') };
}

function localHeader(name, { crc, size }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL, 0);
  header.writeUInt16LE(10, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(name, { crc, size }, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL, 0);
  header.writeUInt16LE((3 << 8) | 10, 4);
  header.writeUInt16LE(10, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

// Writes entries ({ path, bytes } or { path, file }) in path order. Returns
// each entry's size and SHA-256 and the archive's total unpacked size.
export async function writeCatspack(outputPath, entries) {
  const sorted = [...entries].sort(byPath);
  requireThat(sorted.length > 0 && sorted.length <= MAX_ENTRIES, 'A pack needs 1-4096 entries');
  const measured = [];
  for (const entry of sorted) {
    safePath(entry.path);
    measured.push({ ...entry, ...(await measure(entry)) });
  }
  const paths = sorted.map(entry => entry.path.toLowerCase());
  requireThat(new Set(paths).size === paths.length, 'Duplicate or case-alias pack path');
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) requireThat(!paths.includes(parts.slice(0, i).join('/')), `Pack path collides: ${path}`);
  }
  const handle = await open(outputPath, 'wx');
  try {
    let offset = 0;
    const central = [];
    const write = async bytes => {
      for (let done = 0; done < bytes.length;) {
        const { bytesWritten } = await handle.write(bytes, done, bytes.length - done);
        requireThat(bytesWritten > 0, 'Cannot write the pack');
        done += bytesWritten;
      }
      offset += bytes.length;
    };
    for (const entry of measured) {
      const name = Buffer.from(entry.path);
      requireThat(entry.size < ZIP32 && offset < ZIP32, 'Pack exceeds ZIP32');
      central.push(centralHeader(name, entry, offset));
      await write(localHeader(name, entry));
      let crc = 0;
      let size = 0;
      for await (const chunk of chunks(entry)) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await write(chunk);
      }
      requireThat(crc === entry.crc && size === entry.size, `Pack input changed while writing: ${entry.path}`);
    }
    const directory = Buffer.concat(central);
    requireThat(directory.length <= MAX_CENTRAL && offset + directory.length < ZIP32, 'Pack central directory too large');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(measured.length, 8);
    end.writeUInt16LE(measured.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    await write(directory);
    await write(end);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    files: Object.fromEntries(measured.map(entry => [entry.path, { size: entry.size, sha256: entry.sha256 }])),
    unpackedSize: measured.reduce((total, entry) => total + entry.size, 0),
  };
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  requireThat(bytesRead === length, 'Truncated pack');
  return buffer;
}

// Reads the archive back by streaming and checks the ZIP subset the host
// reads, in this producer's canonical form: stored entries in path order,
// fixed time and mode, no gaps, no comment. Returns the entries with their
// SHA-256 and the parsed manifest.
export async function readCatspack(archivePath) {
  const handle = await open(archivePath, 'r');
  try {
    const { size } = await handle.stat();
    requireThat(size >= 22 && size < ZIP32, 'Pack size outside ZIP32');
    const end = await readAt(handle, size - 22, 22);
    requireThat(end.readUInt32LE(0) === END && end.readUInt16LE(4) === 0 && end.readUInt16LE(6) === 0 &&
      end.readUInt16LE(8) === end.readUInt16LE(10) && end.readUInt16LE(20) === 0, 'Unsupported pack end record');
    const count = end.readUInt16LE(10);
    const directorySize = end.readUInt32LE(12);
    const directoryOffset = end.readUInt32LE(16);
    requireThat(count > 0 && count <= MAX_ENTRIES && directorySize <= MAX_CENTRAL &&
      directoryOffset + directorySize === size - 22, 'Unsupported pack central directory');
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries = [];
    let at = 0;
    let expectedOffset = 0;
    for (let i = 0; i < count; i++) {
      requireThat(at + 46 <= directory.length && directory.readUInt32LE(at) === CENTRAL, 'Bad central record');
      const record = directory.subarray(at, at + 46);
      const nameLength = record.readUInt16LE(28);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString('latin1');
      requireThat(record.readUInt16LE(4) === ((3 << 8) | 10) && record.readUInt16LE(6) === 10 &&
        record.readUInt16LE(8) === 0 && record.readUInt16LE(10) === 0 && record.readUInt16LE(12) === DOS_TIME &&
        record.readUInt16LE(14) === DOS_DATE && record.readUInt32LE(20) === record.readUInt32LE(24) &&
        record.readUInt16LE(30) === 0 && record.readUInt16LE(32) === 0 && record.readUInt16LE(34) === 0 &&
        record.readUInt16LE(36) === 0 && record.readUInt32LE(38) === ((FILE_MODE << 16) >>> 0),
      `Noncanonical pack entry: ${name}`);
      safePath(name);
      const entry = { path: name, crc: record.readUInt32LE(16), size: record.readUInt32LE(24), offset: record.readUInt32LE(42) };
      requireThat(entry.offset === expectedOffset, `Pack entry out of place: ${name}`);
      const local = await readAt(handle, entry.offset, 30 + nameLength);
      requireThat(local.readUInt32LE(0) === LOCAL && local.subarray(4, 26).equals(Buffer.concat([
        record.subarray(6, 16), record.subarray(16, 28),
      ])) && local.readUInt16LE(26) === nameLength && local.readUInt16LE(28) === 0 &&
        local.subarray(30).toString('latin1') === name, `Pack local header mismatch: ${name}`);
      entry.dataOffset = entry.offset + 30 + nameLength;
      expectedOffset = entry.dataOffset + entry.size;
      entries.push(entry);
      at += 46 + nameLength;
    }
    requireThat(at === directory.length && expectedOffset === directoryOffset, 'Pack has gaps or trailing data');
    for (let i = 1; i < entries.length; i++) {
      requireThat(Buffer.compare(Buffer.from(entries[i - 1].path), Buffer.from(entries[i].path)) < 0, 'Pack entries out of order');
    }
    const lower = entries.map(entry => entry.path.toLowerCase());
    requireThat(new Set(lower).size === lower.length, 'Duplicate or case-alias pack path');
    for (const path of lower) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) requireThat(!lower.includes(parts.slice(0, i).join('/')), `Pack path collides: ${path}`);
    }
    let manifest = null;
    for (const entry of entries) {
      const hash = createHash('sha256');
      let crc = 0;
      const parts = [];
      for (let done = 0; done < entry.size;) {
        const length = Math.min(2 ** 20, entry.size - done);
        const chunk = await readAt(handle, entry.dataOffset + done, length);
        hash.update(chunk);
        crc = crc32(chunk, crc);
        if (entry.path === MANIFEST_PATH) parts.push(chunk);
        done += length;
      }
      requireThat(crc === entry.crc, `Pack CRC mismatch: ${entry.path}`);
      entry.sha256 = hash.digest('hex');
      if (entry.path === MANIFEST_PATH) {
        requireThat(entry.size <= MAX_MANIFEST, 'Pack manifest too large');
        manifest = JSON.parse(Buffer.concat(parts).toString('utf8'));
      }
    }
    requireThat(manifest !== null, 'Pack has no feature-pack.json');
    return { entries, manifest, size };
  } finally {
    await handle.close();
  }
}
