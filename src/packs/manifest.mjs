// feature-pack.json and the lock fragment (Platform SPEC-145 FR-A1, FR-A3;
// cats-plugins SPEC-002 FR-B5, FR-C4, FR-C5, FR-D3).
import { requireThat, safePath } from '../files.mjs';
import { MANIFEST_PATH, readCatspack } from './catspack.mjs';
import { PACK_ID } from './linux-stt.mjs';

export const ENTRY = 'cats-stt-linux';
export const MODEL_PATH = 'model.bin';
export const RELEASE_BASE = 'https://github.com/cats-inc/cats-plugins/releases/download';
// glibc's own libraries, covered by minGlibc (SPEC-002 FR-C4).
const GLIBC_LIBRARIES = new Set([
  'libc.so.6', 'libm.so.6', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1', 'ld-linux-x86-64.so.2',
  'ld-linux-aarch64.so.1', 'libresolv.so.2', 'libutil.so.1',
]);
const LANGUAGE = /^[a-z]{2,3}$/u;
const TEXT_LIMIT = 200;

// A multilingual whisper.cpp model knows n_vocab - 51765 - 1 languages.
export function modelLanguageCount(header) {
  requireThat(header.length >= 8 && header.readUInt32LE(0) === 0x67676d6c, 'Not a ggml whisper model');
  const vocabulary = header.readInt32LE(4);
  requireThat(vocabulary >= 51865, 'The model is not multilingual');
  return vocabulary - 51765 - 1;
}

// whisper.cpp's g_lang table, as codes by id.
export function whisperLanguageTable(source) {
  const block = /g_lang\s*=\s*\{([\s\S]*?)\n\};/u.exec(source);
  requireThat(block, 'whisper.cpp language table not found');
  const codes = [];
  for (const match of block[1].matchAll(/\{\s*"([a-z]{2,3})",\s*\{\s*(\d+),/gu)) {
    const id = Number(match[2]);
    requireThat(codes[id] === undefined, `Duplicate language id ${id}`);
    codes[id] = match[1];
  }
  requireThat(codes.length > 0 && codes.every(Boolean), 'whisper.cpp language ids are not contiguous');
  return codes;
}

// SPEC-002 FR-B5: the model's languages, mapped to BCP 47 primary subtags.
export function packLanguages(table, count, mapping) {
  requireThat(count <= table.length, 'The model knows more languages than the table');
  const languages = table.slice(0, count).map(code => mapping[code] ?? code);
  requireThat(languages.every(code => LANGUAGE.test(code)) && new Set(languages).size === languages.length,
    'Pack languages must be distinct primary subtags');
  return languages;
}

// FR-C4: NEEDED minus glibc's own libraries.
export const prerequisitesFrom = needed => [...new Set(needed.filter(library => !GLIBC_LIBRARIES.has(library)))].sort();

export function packLicenses() {
  return [
    { name: 'MIT', component: 'whisper.cpp and ggml', path: 'licenses/whisper.cpp-LICENSE.txt' },
    { name: 'MIT', component: 'YaRN code in ggml', path: 'licenses/yarn-NOTICE.txt' },
    { name: 'MIT', component: 'Whisper model weights (OpenAI), ggml conversion', path: 'licenses/model-LICENSE.txt' },
    { name: 'GPL-3.0 with GCC Runtime Library Exception', component: 'GCC C++ runtime, statically linked', path: 'licenses/gcc-runtime-NOTICE.txt' },
  ];
}

export function buildManifest({ recipe, lock, arch, files, model, prerequisites, languages }) {
  return {
    schemaVersion: 1,
    id: PACK_ID,
    version: recipe.version,
    os: 'linux',
    arch,
    helperProtocol: recipe.helperProtocol,
    entry: ENTRY,
    files: Object.entries(files).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([path, file]) => ({ path, size: file.size, sha256: file.sha256, executable: path === ENTRY })),
    upstream: [{ name: 'whisper.cpp', repository: lock.whisper.repository.replace(/\.git$/u, ''), commit: lock.whisper.commit }],
    model: { name: model.file.replace(/\.bin$/u, ''), path: MODEL_PATH, sha256: model.sha256 },
    prerequisites,
    minGlibc: recipe.minGlibc,
    licenses: packLicenses().map(({ name, component, path }) => ({ name, component, path })),
    languages,
  };
}

export const archiveName = (recipe, arch) => `${PACK_ID}-${recipe.version}-linux-${arch}.catspack`;

export function lockEntry({ recipe, arch, size, sha256, unpackedSize, manifest }) {
  return {
    id: PACK_ID,
    version: recipe.version,
    minUsableVersion: recipe.minUsableVersion,
    os: 'linux',
    arch,
    url: `${RELEASE_BASE}/${PACK_ID}-v${recipe.version}/${archiveName(recipe, arch)}`,
    size,
    sha256,
    unpackedSize,
    helperProtocol: manifest.helperProtocol,
    minGlibc: manifest.minGlibc,
    prerequisites: manifest.prerequisites,
    licenses: manifest.licenses.map(({ name, component }) => ({ name, component })),
  };
}

const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= TEXT_LIMIT;

// SPEC-145 FR-A3 as the host checks it, plus this producer's exact entry,
// model and language rules.
export function checkManifest(manifest, entries) {
  requireThat(manifest?.schemaVersion === 1 && manifest.id === PACK_ID && manifest.os === 'linux' &&
    ['x64', 'arm64'].includes(manifest.arch) && manifest.helperProtocol === 1 && manifest.entry === ENTRY &&
    /^\d+\.\d+$/u.test(manifest.minGlibc), 'Invalid pack manifest identity');
  requireThat(Array.isArray(manifest.files) && manifest.files.length > 0, 'Pack manifest has no files');
  const byPath = new Map();
  for (const file of manifest.files) {
    safePath(file.path);
    requireThat(file.path !== MANIFEST_PATH && !byPath.has(file.path) && Number.isSafeInteger(file.size) && file.size >= 0 &&
      /^[a-f0-9]{64}$/u.test(file.sha256) && typeof file.executable === 'boolean', `Invalid manifest file: ${file.path}`);
    byPath.set(file.path, file);
  }
  const archived = entries.filter(entry => entry.path !== MANIFEST_PATH);
  requireThat(archived.length === byPath.size, 'Pack entries and manifest files differ');
  for (const entry of archived) {
    const file = byPath.get(entry.path);
    requireThat(file && file.size === entry.size && file.sha256 === entry.sha256, `Pack entry does not match the manifest: ${entry.path}`);
  }
  requireThat(byPath.get(ENTRY)?.executable === true && manifest.files.every(file => file.executable === (file.path === ENTRY)),
    'Only the entry is executable');
  requireThat(Array.isArray(manifest.upstream) && manifest.upstream.length > 0 && manifest.upstream.every(item =>
    text(item.name) && /^https:\/\//u.test(item.repository) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(item.commit)), 'Invalid manifest upstream');
  requireThat(text(manifest.model?.name) && manifest.model.path === MODEL_PATH &&
    byPath.get(MODEL_PATH)?.sha256 === manifest.model.sha256, 'Invalid manifest model');
  requireThat(Array.isArray(manifest.prerequisites) && new Set(manifest.prerequisites).size === manifest.prerequisites.length &&
    manifest.prerequisites.every(library => /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(library)), 'Invalid manifest prerequisites');
  requireThat(Array.isArray(manifest.licenses) && manifest.licenses.length > 0 && manifest.licenses.every(license =>
    text(license.name) && text(license.component) && byPath.has(license.path)), 'Invalid manifest licenses');
  requireThat(Array.isArray(manifest.languages) && manifest.languages.length > 0 &&
    new Set(manifest.languages).size === manifest.languages.length && manifest.languages.every(code => LANGUAGE.test(code)),
  'Invalid manifest languages');
}

// FR-D3: the archive, its manifest and its lock fragment agree.
export async function verifyPack(archivePath, fragment, { sha256 } = {}) {
  const { entries, manifest, size } = await readCatspack(archivePath);
  checkManifest(manifest, entries);
  if (fragment) {
    requireThat(fragment.id === manifest.id && fragment.version === manifest.version && fragment.os === manifest.os &&
      fragment.arch === manifest.arch && fragment.helperProtocol === manifest.helperProtocol &&
      fragment.minGlibc === manifest.minGlibc, 'Lock fragment identity does not match the manifest');
    requireThat(JSON.stringify([...fragment.prerequisites].sort()) === JSON.stringify([...manifest.prerequisites].sort()),
      'Lock fragment prerequisites do not match the manifest');
    requireThat(JSON.stringify(fragment.licenses) ===
      JSON.stringify(manifest.licenses.map(({ name, component }) => ({ name, component }))), 'Lock fragment licenses do not match the manifest');
    requireThat(fragment.size === size && fragment.unpackedSize === entries.reduce((total, entry) => total + entry.size, 0),
      'Lock fragment sizes do not match the archive');
    requireThat(fragment.url === `${RELEASE_BASE}/${PACK_ID}-v${manifest.version}/${PACK_ID}-${manifest.version}-linux-${manifest.arch}.catspack`,
      'Lock fragment URL is not the planned release asset');
    requireThat(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(fragment.minUsableVersion), 'Invalid lock fragment minUsableVersion');
  }
  if (sha256 !== undefined) requireThat(sha256 === (fragment?.sha256 ?? sha256), 'Lock fragment SHA-256 does not match the archive');
  return { manifest, entries, size };
}
