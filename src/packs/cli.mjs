import { createHash } from 'node:crypto';
import { constants, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { json, requireThat, sha256, writableDirectory } from '../files.mjs';
import { cmakeOptions, compile, ensureEnvironment, hostArch, stageSources } from './build.mjs';
import { writeCatspack } from './catspack.mjs';
import { checkBinary, readBinary } from './elf.mjs';
import { fetchVerifiedSource } from './git-source.mjs';
import { loadPack, PACK_DIR, PACK_ID, readBridge, sourceArchive, sourceArchiveName, verifySourceArchive } from './linux-stt.mjs';
import {
  archiveName, buildManifest, ENTRY, lockEntry, MODEL_PATH, modelLanguageCount, packLanguages, packLicenses,
  prerequisitesFrom, verifyPack, whisperLanguageTable,
} from './manifest.mjs';
import { downloadModel } from './model.mjs';

const USAGE = `Usage:
  node src/packs/cli.mjs check ${PACK_ID}
  node src/packs/cli.mjs fetch ${PACK_ID} --out NEW_DIR [--model FILE|all]
  node src/packs/cli.mjs verify-sources ${PACK_ID} ARCHIVE
  node src/packs/cli.mjs build ${PACK_ID} --out NEW_DIR [--model FILE] [--sources ARCHIVE --models DIR]
  node src/packs/cli.mjs verify ${PACK_ID} PACK LOCK_ENTRY
  node src/packs/cli.mjs environment ${PACK_ID}`;

const root = fileURLToPath(new URL('../../', import.meta.url));

// The output appears only complete: it is written beside its final path,
// then renamed. A failure removes the staging directory this run created.
function writeOutput(output, fill) {
  mkdirSync(path.dirname(output), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(output), `.${path.basename(output)}-`));
  try {
    fill(staging);
    requireThat(!existsSync(output), 'Output exists; choose a new output directory');
    renameSync(staging, output);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function localModel(model, dir) {
  const file = path.join(path.resolve(dir), model.file);
  requireThat(existsSync(file) && statSync(file).size === model.size && await fileSha256(file) === model.sha256,
    `Model ${model.file} in ${dir} does not match the lock`);
  return file;
}

async function readHeader(file) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, 8, 0);
    return header;
  } finally {
    await handle.close();
  }
}

async function build(pack, values) {
  const arch = hostArch();
  requireThat(arch, `Unsupported build architecture ${process.arch}`);
  const modelFile = values.model ?? pack.recipe.models.selected;
  requireThat(modelFile, 'The recipe has no selected model yet; pass --model');
  const model = pack.lock.models.find(candidate => candidate.file === modelFile);
  requireThat(model, `Unknown model ${modelFile}`);
  requireThat(Boolean(values.sources) === Boolean(values.models), '--sources and --models go together');
  const output = writableDirectory(values.out);
  requireThat(!existsSync(output), 'Output exists; choose a new output directory');
  const bridge = readBridge(root);
  requireThat(bridge.length > 0, 'The bridge is missing');

  const scratch = mkdtempSync(path.join(os.tmpdir(), 'cats-packs-build-'));
  try {
    // 1. Verified inputs: the locked tree and model, offline when given.
    let entries;
    let sourceBytes;
    if (values.sources) {
      sourceBytes = readFileSync(path.resolve(values.sources));
      entries = verifySourceArchive(sourceBytes, pack, bridge).whisper;
    } else {
      entries = fetchVerifiedSource(pack.lock.whisper, path.join(scratch, 'git'));
      sourceBytes = sourceArchive(pack, entries, bridge);
      verifySourceArchive(sourceBytes, pack, bridge);
    }
    const modelPath = values.models ? await localModel(model, values.models) : await downloadModel(model, path.join(scratch, model.file));
    const languageCount = modelLanguageCount(await readHeader(modelPath));
    const table = whisperLanguageTable(entries.find(entry => entry.path === 'src/whisper.cpp').bytes.toString('utf8'));
    const languages = packLanguages(table, languageCount, pack.recipe.languageMapping);

    // 2. Native build in the pinned image, networking disabled.
    const work = path.join(scratch, 'work');
    mkdirSync(work);
    stageSources(work, entries, bridge);
    const tag = ensureEnvironment(pack.recipe, scratch);
    const built = compile(tag, work, cmakeOptions(pack.recipe, arch, languageCount));

    // 3. Binary checks (FR-D1).
    const binary = checkBinary(readBinary(built.helper), arch, pack.recipe.minGlibc);

    // 4. Archive, manifest, fragment (FR-C3-FR-C5).
    const licenseSources = {
      'licenses/whisper.cpp-LICENSE.txt': entries.find(entry => entry.path === 'LICENSE').bytes,
      'licenses/yarn-NOTICE.txt': readFileSync(path.join(root, PACK_DIR, 'notices/yarn-NOTICE.txt')),
      'licenses/model-LICENSE.txt': readFileSync(path.join(root, PACK_DIR, 'notices/model-LICENSE.txt')),
      'licenses/gcc-runtime-NOTICE.txt': readFileSync(path.join(root, PACK_DIR, 'notices/gcc-runtime-NOTICE.txt')),
    };
    requireThat(JSON.stringify(Object.keys(licenseSources).sort()) === JSON.stringify(packLicenses().map(l => l.path).sort()),
      'License files do not match the manifest licenses');
    const payload = [
      { path: ENTRY, file: built.helper },
      { path: MODEL_PATH, file: modelPath },
      ...Object.entries(licenseSources).map(([file, bytes]) => ({ path: file, bytes })),
    ];
    const measured = await writeCatspack(path.join(scratch, 'measure.catspack'), payload);
    const manifest = buildManifest({
      recipe: pack.recipe, lock: pack.lock, arch, files: measured.files, model,
      prerequisites: prerequisitesFrom(binary.needed), languages,
    });
    const manifestBytes = Buffer.from(json(manifest));
    const name = archiveName(pack.recipe, arch);
    const archivePath = path.join(scratch, name);
    const written = await writeCatspack(archivePath, [...payload, { path: 'feature-pack.json', bytes: manifestBytes }]);
    const archiveSha256 = await fileSha256(archivePath);
    const fragment = lockEntry({
      recipe: pack.recipe, arch, size: statSync(archivePath).size, sha256: archiveSha256,
      unpackedSize: written.unpackedSize, manifest,
    });
    await verifyPack(archivePath, fragment, { sha256: archiveSha256 });
    const receipt = {
      pack: PACK_ID, version: pack.recipe.version, arch, archive: name, sha256: archiveSha256,
      image: pack.recipe.build.image, packageSnapshot: pack.recipe.build.packageSnapshot, environment: tag,
      compiler: built.compiler, cmake: built.cmake, flags: built.flags,
      whisper: { repository: pack.lock.whisper.repository, commit: pack.lock.whisper.commit, contentSha256: pack.lock.whisper.contentSha256 },
      model: { file: model.file, sha256: model.sha256 }, languages: languages.length,
      needed: binary.needed, glibc: binary.glibc.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      node: process.version,
    };
    const sourcesName = sourceArchiveName(pack.recipe);
    writeOutput(output, staging => {
      copyFileSync(archivePath, path.join(staging, name), constants.COPYFILE_EXCL);
      writeFileSync(path.join(staging, `${name}.sha256`), `${archiveSha256}  ${name}\n`, { flag: 'wx' });
      writeFileSync(path.join(staging, `feature-pack-linux-${arch}.json`), manifestBytes, { flag: 'wx' });
      writeFileSync(path.join(staging, `build-receipt-linux-${arch}.json`), json(receipt), { flag: 'wx' });
      writeFileSync(path.join(staging, `lock-entry-${arch}.json`), json(fragment), { flag: 'wx' });
      writeFileSync(path.join(staging, sourcesName), sourceBytes, { flag: 'wx' });
      writeFileSync(path.join(staging, `${sourcesName}.sha256`), `${sha256(sourceBytes)}  ${sourcesName}\n`, { flag: 'wx' });
    });
    console.log(json({ archive: path.join(output, name), sha256: archiveSha256, size: fragment.size, model: model.file, languages: languages.length }));
  } finally {
    // Only the exact mkdtemp-created directory, never a caller-provided path.
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  requireThat(Number(process.versions.node.split('.')[0]) === 24, 'Use Node.js 24');
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: true,
    options: {
      out: { type: 'string' }, model: { type: 'string' }, sources: { type: 'string' }, models: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(USAGE);
  const [command, packId, ...rest] = positionals;
  requireThat(packId === PACK_ID, USAGE);
  const pack = loadPack(root);
  const only = (...allowed) => Object.keys(values).every(key => allowed.includes(key));

  if (command === 'check' && rest.length === 0 && only()) {
    return console.log(json({ id: pack.recipe.id, version: pack.recipe.version, commit: pack.lock.whisper.commit,
      models: pack.recipe.models.candidates, selected: pack.recipe.models.selected }));
  }
  if (command === 'verify-sources' && rest.length === 1 && only()) {
    const { whisper, ...summary } = verifySourceArchive(readFileSync(path.resolve(rest[0])), pack, readBridge(root));
    return console.log(json({ ...summary, whisperFiles: whisper.length }));
  }
  if (command === 'verify' && rest.length === 2 && only()) {
    const fragment = JSON.parse(readFileSync(path.resolve(rest[1]), 'utf8'));
    const archive = path.resolve(rest[0]);
    const { manifest, size } = await verifyPack(archive, fragment, { sha256: await fileSha256(archive) });
    return console.log(json({ archive, arch: manifest.arch, size, languages: manifest.languages.length }));
  }
  if (command === 'environment' && rest.length === 0 && only()) {
    // Creates the build environment image; this step needs the network.
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'cats-packs-env-'));
    try {
      return console.log(json({ environment: ensureEnvironment(pack.recipe, scratch) }));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  if (command === 'build' && rest.length === 0 && values.out && only('out', 'model', 'sources', 'models')) {
    return build(pack, values);
  }

  requireThat(command === 'fetch' && rest.length === 0 && values.out && only('out', 'model'), USAGE);
  const choice = values.model ?? pack.recipe.models.selected ?? 'all';
  const models = choice === 'all' ? pack.lock.models : pack.lock.models.filter(model => model.file === choice);
  requireThat(models.length > 0, `Unknown model ${choice}; choose a recipe candidate or all`);
  const output = writableDirectory(values.out);
  requireThat(!existsSync(output), 'Output exists; choose a new output directory');

  // Every hash is checked before the output directory exists.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'cats-packs-fetch-'));
  try {
    const entries = fetchVerifiedSource(pack.lock.whisper, path.join(scratch, 'git'));
    for (const model of models) await downloadModel(model, path.join(scratch, model.file));
    const archive = sourceArchive(pack, entries, readBridge(root));
    const { whisper, ...verified } = verifySourceArchive(archive, pack, readBridge(root));
    const name = sourceArchiveName(pack.recipe);
    writeOutput(output, staging => {
      mkdirSync(path.join(staging, 'models'));
      writeFileSync(path.join(staging, name), archive, { flag: 'wx' });
      writeFileSync(path.join(staging, `${name}.sha256`), `${sha256(archive)}  ${name}\n`, { flag: 'wx' });
      for (const model of models) {
        copyFileSync(path.join(scratch, model.file), path.join(staging, 'models', model.file), constants.COPYFILE_EXCL);
      }
    });
    console.log(json({ sources: path.join(output, name), ...verified, whisperFiles: whisper.length, models: models.map(model => model.file) }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
