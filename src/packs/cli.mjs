import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { json, requireThat, sha256, writableDirectory } from '../files.mjs';
import { fetchVerifiedSource } from './git-source.mjs';
import { loadPack, PACK_ID, readBridge, sourceArchive, sourceArchiveName, verifySourceArchive } from './linux-stt.mjs';
import { downloadModel } from './model.mjs';

const USAGE = `Usage:
  node src/packs/cli.mjs check ${PACK_ID}
  node src/packs/cli.mjs fetch ${PACK_ID} --out NEW_DIR [--model FILE|all]
  node src/packs/cli.mjs verify-sources ${PACK_ID} ARCHIVE`;

const root = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  requireThat(Number(process.versions.node.split('.')[0]) === 24, 'Use Node.js 24');
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: true,
    options: { out: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) return console.log(USAGE);
  const [command, packId, ...rest] = positionals;
  requireThat(packId === PACK_ID, USAGE);
  const pack = loadPack(root);

  if (command === 'check' && rest.length === 0 && !values.out && !values.model) {
    return console.log(json({ id: pack.recipe.id, version: pack.recipe.version, commit: pack.lock.whisper.commit,
      models: pack.recipe.models.candidates, selected: pack.recipe.models.selected }));
  }

  if (command === 'verify-sources' && rest.length === 1 && !values.out && !values.model) {
    return console.log(json(verifySourceArchive(readFileSync(path.resolve(rest[0])), pack, readBridge(root))));
  }

  requireThat(command === 'fetch' && rest.length === 0 && values.out, USAGE);
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
    const verified = verifySourceArchive(archive, pack, readBridge(root));
    const name = sourceArchiveName(pack.recipe);
    // The output appears only complete: it is written beside its final path,
    // then renamed. A failure removes the staging directory this run created.
    mkdirSync(path.dirname(output), { recursive: true });
    const staging = mkdtempSync(path.join(path.dirname(output), `.${path.basename(output)}-`));
    try {
      mkdirSync(path.join(staging, 'models'));
      writeFileSync(path.join(staging, name), archive, { flag: 'wx' });
      writeFileSync(path.join(staging, `${name}.sha256`), `${sha256(archive)}  ${name}\n`, { flag: 'wx' });
      for (const model of models) {
        copyFileSync(path.join(scratch, model.file), path.join(staging, 'models', model.file), constants.COPYFILE_EXCL);
      }
      requireThat(!existsSync(output), 'Output exists; choose a new output directory');
      renameSync(staging, output);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    console.log(json({ sources: path.join(output, name), ...verified, models: models.map(model => model.file) }));
  } finally {
    // Only the exact mkdtemp-created directory, never a caller-provided path.
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
