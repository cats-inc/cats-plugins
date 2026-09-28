import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert, loadInputs, payload, resolveBash } from './agency.mjs';
import { pack, verifyArchive } from './archive.mjs';
import { json, LIMIT, requireThat, sha256, writableDirectory } from './files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  requireThat(Number(process.versions.node.split('.')[0]) === 24, 'Use Node.js 24');
  const [command, customPath, ...extra] = process.argv.slice(2);
  requireThat(['build', 'verify'].includes(command) && extra.length === 0,
    'Usage: node src/cli.mjs build [NEW_OUTPUT_DIR] | verify [ARTIFACT_FILE]');
  const inputs = loadInputs(root);
  const artifactName = `${inputs.recipe.id}-${inputs.recipe.version}.catsplugin`;
  const defaultDir = path.join(root, 'dist', inputs.recipe.id);
  if (command === 'build') {
    const output = writableDirectory(customPath ?? defaultDir);
    // All validation and conversion finish before creating the output directory.
    // Existing output is reusable only if every byte is identical; never overwrite.
    const files = payload(root, inputs, convert(inputs));
    const bytes = pack(files);
    const verified = verifyArchive(bytes, payload(root, inputs));
    const results = {
      [artifactName]: bytes,
      [`${artifactName}.sha256`]: Buffer.from(`${sha256(bytes)}  ${artifactName}\n`),
    };
    if (existsSync(output)) {
      requireThat(lstatSync(output).isDirectory() && !lstatSync(output).isSymbolicLink(), 'Invalid output directory');
      for (const [name, data] of Object.entries(results)) {
        const file = path.join(output, name);
        requireThat(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() &&
          readFileSync(file).equals(data), 'Output exists with different/incomplete content; choose a new output directory');
      }
      const receiptPath = path.join(output, 'build-receipt.json');
      requireThat(existsSync(receiptPath) && lstatSync(receiptPath).isFile() && !lstatSync(receiptPath).isSymbolicLink() &&
        lstatSync(receiptPath).size <= LIMIT, 'Incomplete output: build receipt missing or invalid; choose a new output directory');
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      requireThat(receipt.artifact === artifactName && receipt.sha256 === verified.sha256 &&
        receipt.files === verified.files && receipt.bytes === verified.bytes && receipt.sourceCommit === inputs.lock.commit &&
        typeof receipt.node === 'string' && typeof receipt.platform === 'string' && typeof receipt.bash === 'string',
      'Incomplete output: build receipt does not match');
    } else {
      const receipt = {
        artifact: artifactName, ...verified, node: process.version, platform: process.platform,
        bash: execFileSync(resolveBash(), ['--version'], { encoding: 'utf8', timeout: 5000 }).split('\n')[0],
        sourceCommit: inputs.lock.commit,
      };
      mkdirSync(output, { recursive: true });
      for (const [name, data] of Object.entries(results)) writeFileSync(path.join(output, name), data, { flag: 'wx' });
      writeFileSync(path.join(output, 'build-receipt.json'), json(receipt), { flag: 'wx' });
    }
    console.log(json({ artifact: path.join(output, artifactName), ...verified }));
  } else {
    const artifact = path.resolve(customPath ?? path.join(defaultDir, artifactName));
    const stat = lstatSync(artifact);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * LIMIT, 'Not a bounded regular artifact');
    const checksum = readFileSync(`${artifact}.sha256`, 'utf8').trim();
    const expectedDigest = checksum.split('  ')[0];
    requireThat(checksum === `${expectedDigest}  ${path.basename(artifact)}`, 'Invalid checksum sidecar');
    console.log(json(verifyArchive(readFileSync(artifact), payload(root, inputs), expectedDigest)));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
