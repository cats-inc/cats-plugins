import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCatspack, writeCatspack } from '../src/packs/catspack.mjs';
import { checkBinary, parseReadelf } from '../src/packs/elf.mjs';
import {
  buildManifest, lockEntry, modelLanguageCount, packLanguages, prerequisitesFrom, verifyPack, whisperLanguageTable,
} from '../src/packs/manifest.mjs';

const hex = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = t => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cats-pack-archive-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const recipe = { version: '0.1.0', minUsableVersion: '0.1.0', helperProtocol: 1, minGlibc: '2.35' };
const lock = { whisper: { repository: 'https://github.com/ggml-org/whisper.cpp.git', commit: 'a'.repeat(40) } };
const model = { file: 'ggml-tiny.bin', sha256: hex(Buffer.from('model')) };

async function fixturePack(dir, change = manifest => manifest) {
  const payload = [
    { path: 'cats-stt-linux', bytes: Buffer.from('\x7fELF helper') },
    { path: 'model.bin', bytes: Buffer.from('model') },
    ...['whisper.cpp-LICENSE.txt', 'yarn-NOTICE.txt', 'model-LICENSE.txt', 'gcc-runtime-NOTICE.txt']
      .map(name => ({ path: `licenses/${name}`, bytes: Buffer.from(`${name}\n`) })),
  ];
  const measured = await writeCatspack(path.join(dir, 'measure.catspack'), payload);
  const manifest = change(buildManifest({
    recipe, lock, arch: 'arm64', files: measured.files, model, prerequisites: ['libpulse.so.0'], languages: ['en', 'zh', 'jv'],
  }));
  const archive = path.join(dir, 'pack.catspack');
  const written = await writeCatspack(archive, [...payload, { path: 'feature-pack.json', bytes: Buffer.from(JSON.stringify(manifest)) }]);
  const bytes = readFileSync(archive);
  const fragment = lockEntry({ recipe, arch: 'arm64', size: bytes.length, sha256: hex(bytes), unpackedSize: written.unpackedSize, manifest });
  return { archive, bytes, fragment, manifest };
}

test('the pack writer is deterministic and the verifier accepts its archive and fragment', async t => {
  const dir = temp(t);
  const first = await fixturePack(path.join(dir));
  const again = temp(t);
  const second = await fixturePack(again);
  assert.ok(first.bytes.equals(second.bytes));
  // Golden digest: the same bytes on Linux, macOS and Windows.
  assert.equal(hex(first.bytes), '69483c8480a53e94bababe80bac16391284f18f0b1292185cc27816fcfa2f9a0');
  const { manifest } = await verifyPack(first.archive, first.fragment, { sha256: hex(first.bytes) });
  assert.deepEqual(manifest.languages, ['en', 'zh', 'jv']);
  assert.equal(first.fragment.url, 'https://github.com/cats-inc/cats-plugins/releases/download/linux-stt-v0.1.0/linux-stt-0.1.0-linux-arm64.catspack');
  const { entries } = await readCatspack(first.archive);
  assert.deepEqual(entries.map(entry => entry.path), [
    'cats-stt-linux', 'feature-pack.json', 'licenses/gcc-runtime-NOTICE.txt', 'licenses/model-LICENSE.txt',
    'licenses/whisper.cpp-LICENSE.txt', 'licenses/yarn-NOTICE.txt', 'model.bin',
  ]);
});

test('the verifier rejects tampered archives, manifests and fragments', async t => {
  const dir = temp(t);
  const good = await fixturePack(dir);
  const tamper = async (name, mutate, error) => {
    const file = path.join(dir, name);
    const bytes = Buffer.from(good.bytes);
    mutate(bytes);
    writeFileSync(file, bytes);
    await assert.rejects(verifyPack(file, good.fragment), error, name);
  };
  const at = text => good.bytes.indexOf(text);
  await tamper('data.catspack', bytes => { bytes[at('\x7fELF helper') + 1] ^= 1; }, /CRC mismatch/);
  await tamper('name.catspack', bytes => { bytes[good.bytes.lastIndexOf('model.bin')] = 0x4d; }, /local header mismatch|out of order/);
  await tamper('end.catspack', bytes => { bytes[bytes.length - 2] = 1; }, /end record/);
  await tamper('mode.catspack', bytes => { bytes[bytes.lastIndexOf(Buffer.from('cats-stt-linux')) - 46 + 40] ^= 0x40; }, /Noncanonical/);

  const cases = [
    [m => ({ ...m, languages: ['en', 'en'] }), /languages/],
    [m => ({ ...m, languages: ['english'] }), /languages/],
    [m => ({ ...m, entry: 'other' }), /identity/],
    [m => ({ ...m, files: m.files.map(f => ({ ...f, executable: f.path === 'model.bin' })) }), /executable/],
    [m => ({ ...m, files: m.files.filter(f => f.path !== 'model.bin') }), /differ/],
    [m => ({ ...m, model: { ...m.model, sha256: 'b'.repeat(64) } }), /model/],
    [m => ({ ...m, licenses: [{ ...m.licenses[0], path: 'licenses/missing.txt' }] }), /licenses/],
  ];
  for (const [index, [change, error]] of cases.entries()) {
    const sub = path.join(dir, `m${index}`);
    rmSync(sub, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(sub);
    const bad = await fixturePack(sub, change);
    await assert.rejects(verifyPack(bad.archive, bad.fragment), error, String(error));
  }
  for (const [change, error] of [
    [f => ({ ...f, prerequisites: [] }), /prerequisites/],
    [f => ({ ...f, size: f.size + 1 }), /sizes/],
    [f => ({ ...f, unpackedSize: f.unpackedSize - 1 }), /sizes/],
    [f => ({ ...f, url: f.url.replace('v0.1.0', 'latest') }), /URL/],
    [f => ({ ...f, arch: 'x64' }), /identity/],
    [f => ({ ...f, licenses: f.licenses.slice(1) }), /licenses/],
  ]) await assert.rejects(verifyPack(good.archive, change(good.fragment)), error);
  await assert.rejects(verifyPack(good.archive, { ...good.fragment, sha256: 'c'.repeat(64) }, { sha256: hex(good.bytes) }), /SHA-256/);
});

test('languages come from the whisper.cpp table, the model count and the mapping', () => {
  const source = 'static const std::map<std::string, std::pair<int, std::string>> g_lang = {\n' +
    '    { "en",  { 0,  "english",  } },\n    { "zh",  { 1,  "chinese",  } },\n' +
    '    { "jw",  { 2,  "javanese", } },\n    { "yue", { 3,  "cantonese", } },\n};';
  const table = whisperLanguageTable(source);
  assert.deepEqual(table, ['en', 'zh', 'jw', 'yue']);
  assert.deepEqual(packLanguages(table, 3, { jw: 'jv' }), ['en', 'zh', 'jv']);
  assert.throws(() => packLanguages(table, 5, {}), /more languages/);
  assert.throws(() => packLanguages(table, 3, { jw: 'en' }), /distinct/);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x67676d6c, 0);
  header.writeInt32LE(51865, 4);
  assert.equal(modelLanguageCount(header), 99);
  header.writeInt32LE(51866, 4);
  assert.equal(modelLanguageCount(header), 100);
  header.writeInt32LE(51864, 4);
  assert.throws(() => modelLanguageCount(header), /not multilingual/);
  assert.throws(() => modelLanguageCount(Buffer.from('GGUF0000')), /Not a ggml/);
});

const READELF = `ELF Header:
  Class:                             ELF64
  Machine:                           AArch64
Dynamic section at offset 0x1 contains 3 entries:
 0x0000000000000001 (NEEDED)             Shared library: [libpulse.so.0]
 0x0000000000000001 (NEEDED)             Shared library: [libm.so.6]
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
Symbol table '.dynsym' contains 3 entries:
   Num:    Value          Size Type    Bind   Vis      Ndx Name
     1: 0000000000000000     0 FUNC    GLOBAL DEFAULT  UND pa_context_connect@PULSE_0 (2)
     2: 0000000000000000     0 FUNC    GLOBAL DEFAULT  UND memcpy@GLIBC_2.17 (3)
     3: 0000000000000000     0 FUNC    WEAK   DEFAULT  UND __cxa_finalize@GLIBC_2.17 (3)
Version needs section '.gnu.version_r' contains 2 entries:
  0x0010:   Name: GLIBC_2.34  Flags: none  Version: 4
`;

test('binary checks: machine, NEEDED, glibc versions and the socket API', () => {
  const info = parseReadelf(READELF);
  assert.deepEqual(info.needed, ['libpulse.so.0', 'libm.so.6', 'libc.so.6']);
  assert.deepEqual(info.undefinedSymbols, ['pa_context_connect', 'memcpy', '__cxa_finalize']);
  assert.equal(checkBinary(info, 'arm64', '2.35'), info);
  assert.deepEqual(prerequisitesFrom(info.needed), ['libpulse.so.0']);
  assert.throws(() => checkBinary(info, 'x64', '2.35'), /not x64/);
  assert.throws(() => checkBinary(parseReadelf(READELF.replace('libm.so.6', 'libstdc++.so.6')), 'arm64', '2.35'), /NEEDED outside/);
  assert.throws(() => checkBinary(parseReadelf(READELF.replace('GLIBC_2.34', 'GLIBC_2.36')), 'arm64', '2.35'), /newer than 2.35: 2.36/);
  assert.throws(() => checkBinary(parseReadelf(READELF.replace('memcpy@', 'connect@')), 'arm64', '2.35'), /socket API: connect/);
  assert.throws(() => checkBinary(parseReadelf(READELF.replace('memcpy@', 'getaddrinfo@')), 'arm64', '2.35'), /socket API/);
});
