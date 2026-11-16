import { existsSync } from 'node:fs';
import path from 'node:path';
import { listFiles, readRegular, requireThat, sha256 } from '../files.mjs';
import { readTar, writeTar } from './tar.mjs';
import { contentSha256 } from './tree.mjs';

export const PACK_ID = 'linux-stt';
export const PACK_DIR = `packs/${PACK_ID}`;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const HEX40 = /^[a-f0-9]{40}$/u;
const HEX64 = /^[a-f0-9]{64}$/u;
const MODEL_FILE = /^ggml-[a-z0-9.-]+(?:-q[0-9]_[0-9])?\.bin$/u;
// ADR-002 D1: the CPU baselines are fixed by decision, not by the recipe.
const CPU_BASELINE = { x64: 'x86-64-v3', arm64: 'armv8.2-a+dotprod+fp16' };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) {
  requireThat(isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `${label} must have exactly: ${keys.join(', ')}`);
}

// Values that only measurement (thread count, selected model) or the build
// image work (image digest, package snapshot) can set are null until then.
// Commands that need them refuse to run while they are null.
export function validateRecipe(recipe) {
  exactKeys(recipe, ['schemaVersion', 'id', 'version', 'minUsableVersion', 'helperProtocol', 'minGlibc',
    'cpuBaseline', 'models', 'threads', 'languageMapping', 'build'], 'recipe.json');
  requireThat(recipe.schemaVersion === 1 && recipe.id === PACK_ID, 'Unsupported linux-stt recipe');
  requireThat(SEMVER.test(recipe.version) && SEMVER.test(recipe.minUsableVersion), 'Recipe versions must be X.Y.Z');
  requireThat(recipe.helperProtocol === 1 && recipe.minGlibc === '2.35', 'Recipe must use helper protocol 1 and glibc 2.35');
  requireThat(JSON.stringify(recipe.cpuBaseline) === JSON.stringify(CPU_BASELINE), 'Recipe CPU baseline must follow ADR-002 D1');
  exactKeys(recipe.models, ['candidates', 'selected'], 'recipe models');
  const { candidates, selected } = recipe.models;
  requireThat(Array.isArray(candidates) && candidates.length > 0 && new Set(candidates).size === candidates.length &&
    candidates.every(file => MODEL_FILE.test(file)), 'Recipe model candidates must be distinct ggml model files');
  requireThat(selected === null || candidates.includes(selected), 'The selected model must be a candidate');
  requireThat(recipe.threads === null || (Number.isInteger(recipe.threads) && recipe.threads >= 1 && recipe.threads <= 64),
    'Recipe thread count must be null or 1-64');
  requireThat(isObject(recipe.languageMapping), 'Recipe language mapping must be an object');
  const targets = Object.values(recipe.languageMapping);
  requireThat(Object.entries(recipe.languageMapping).every(([from, to]) =>
    /^[a-z]{2,3}$/u.test(from) && /^[a-z]{2,3}$/u.test(to) && from !== to) && new Set(targets).size === targets.length,
  'Recipe language mapping must map distinct whisper.cpp codes to distinct primary subtags');
  exactKeys(recipe.build, ['image', 'packageSnapshot'], 'recipe build');
  requireThat(recipe.build.image === null || /^[a-z0-9][a-z0-9./-]*:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$/u.test(recipe.build.image),
    'Recipe build image must be null or pinned by digest');
  requireThat(recipe.build.packageSnapshot === null || /^\d{8}T\d{6}Z$/u.test(recipe.build.packageSnapshot),
    'Recipe package snapshot must be null or a snapshot id');
  return recipe;
}

export function validateLock(lock, recipe) {
  exactKeys(lock, ['schemaVersion', 'id', 'whisper', 'models'], 'source-lock.json');
  requireThat(lock.schemaVersion === 1 && lock.id === PACK_ID, 'Unsupported linux-stt source lock');
  const source = lock.whisper;
  exactKeys(source, ['repository', 'tag', 'commit', 'tree', 'contentSha256', 'files', 'license'], 'source lock whisper');
  requireThat(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u.test(source.repository),
    'whisper.cpp must come from an HTTPS GitHub repository');
  requireThat(HEX40.test(source.commit) && HEX40.test(source.tree),
    'whisper.cpp must be locked by full commit and tree hashes, never a branch or tag');
  requireThat(/^v\d+\.\d+\.\d+$/u.test(source.tag) && HEX64.test(source.contentSha256) &&
    Number.isInteger(source.files) && source.files > 0 && source.license === 'MIT', 'Invalid whisper.cpp lock entry');
  requireThat(Array.isArray(lock.models) && JSON.stringify(lock.models.map(model => model?.file)) ===
    JSON.stringify(recipe.models.candidates), 'The lock must list exactly the recipe candidates, in order');
  for (const model of lock.models) {
    exactKeys(model, ['file', 'url', 'size', 'sha256', 'license'], `source lock model ${model.file}`);
    const escaped = model.file.replace(/[.]/gu, '\\.');
    requireThat(new RegExp(`^https://huggingface\\.co/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/resolve/[a-f0-9]{40}/${escaped}$`, 'u')
      .test(model.url), `Model ${model.file} must use an HTTPS URL pinned to a revision`);
    requireThat(Number.isSafeInteger(model.size) && model.size > 0 && HEX64.test(model.sha256) && model.license === 'MIT',
      `Invalid model lock entry: ${model.file}`);
  }
  return lock;
}

export function loadPack(root) {
  const recipeBytes = readRegular(root, `${PACK_DIR}/recipe.json`);
  const lockBytes = readRegular(root, `${PACK_DIR}/source-lock.json`);
  const recipe = validateRecipe(JSON.parse(recipeBytes));
  const lock = validateLock(JSON.parse(lockBytes), recipe);
  return { recipe, lock, recipeBytes, lockBytes };
}

// The Cats-owned helper source. Until the helper exists (PLAN-002 Phase 3)
// the directory is absent and the archive carries no bridge files.
export function readBridge(root) {
  const dir = path.join(root, PACK_DIR, 'bridge');
  if (!existsSync(dir)) return [];
  return listFiles(dir).map(file => ({ path: file, bytes: readRegular(dir, file) }));
}

export const sourceArchiveName = recipe => `${PACK_ID}-${recipe.version}-sources.tar`;
const archivePrefix = recipe => `${PACK_ID}-${recipe.version}-sources`;

// FR-A4: the exact whisper.cpp tree, the bridge source, the recipe and the lock.
export function sourceArchive(pack, whisperEntries, bridge) {
  const prefix = archivePrefix(pack.recipe);
  return writeTar([
    ...whisperEntries.map(entry => ({
      path: `${prefix}/whisper.cpp/${entry.path}`, mode: entry.mode === '100755' ? 0o755 : 0o644, bytes: entry.bytes,
    })),
    ...bridge.map(file => ({ path: `${prefix}/bridge/${file.path}`, mode: 0o644, bytes: file.bytes })),
    { path: `${prefix}/recipe.json`, mode: 0o644, bytes: pack.recipeBytes },
    { path: `${prefix}/source-lock.json`, mode: 0o644, bytes: pack.lockBytes },
  ]);
}

// Checks a retained source archive against this checkout's recipe, lock and
// bridge, and checks its whisper.cpp tree against the lock's content hash.
export function verifySourceArchive(bytes, pack, bridge) {
  const entries = readTar(bytes);
  requireThat(writeTar(entries).equals(bytes), 'Source archive is not in canonical form');
  const prefix = `${archivePrefix(pack.recipe)}/`;
  const whisper = [];
  const rest = new Map();
  for (const entry of entries) {
    requireThat(entry.path.startsWith(prefix), `Source archive entry outside ${prefix}: ${entry.path}`);
    const relative = entry.path.slice(prefix.length);
    if (relative.startsWith('whisper.cpp/')) {
      whisper.push({ path: relative.slice('whisper.cpp/'.length), mode: entry.mode === 0o755 ? '100755' : '100644', bytes: entry.bytes });
    } else {
      requireThat(entry.mode === 0o644, `Unexpected mode in source archive: ${relative}`);
      rest.set(relative, entry.bytes);
    }
  }
  const expected = new Map([
    ['recipe.json', pack.recipeBytes], ['source-lock.json', pack.lockBytes],
    ...bridge.map(file => [`bridge/${file.path}`, file.bytes]),
  ]);
  requireThat(JSON.stringify([...rest.keys()].sort()) === JSON.stringify([...expected.keys()].sort()),
    'Source archive file set does not match the recipe, lock and bridge');
  for (const [file, data] of expected) requireThat(rest.get(file).equals(data), `Source archive content mismatch: ${file}`);
  requireThat(whisper.length === pack.lock.whisper.files && contentSha256(whisper) === pack.lock.whisper.contentSha256,
    'Source archive whisper.cpp tree does not match the lock');
  return { sha256: sha256(bytes), bytes: bytes.length, files: entries.length };
}
