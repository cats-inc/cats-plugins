/** Import a reviewed Git object snapshot; never execute or follow upstream installers.
 * Usage: node scripts/import-agency.mjs CHECKOUT FULL_COMMIT EMPTY_DESTINATION
 * This is a maintainer operation. Review scripts/content/license before building.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writableDirectory } from '../src/files.mjs';

const [checkout, commit, destination, ...extra] = process.argv.slice(2);
if (!checkout || !/^[a-f0-9]{40}$/.test(commit ?? '') || !destination || extra.length) {
  throw new Error('Usage: node scripts/import-agency.mjs CHECKOUT FULL_COMMIT EMPTY_DESTINATION');
}
const dest = writableDirectory(destination);
if (existsSync(dest) && readdirSync(dest).length) throw new Error('Destination must be empty');
const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', path.resolve(checkout), ...args], { maxBuffer: 2 ** 20 });
if (git('rev-parse', '--verify', `${commit}^{commit}`).toString().trim() !== commit) {
  throw new Error('Expected exact commit');
}
const paths = [
  'LICENSE', 'design/design-ux-researcher.md', 'engineering/engineering-code-reviewer.md',
  'scripts/convert.sh', 'scripts/lib.sh',
];
// Validate the complete set before writing anything. Read blobs, not the working tree.
const blobs = paths.map(file => {
  const tree = git('ls-tree', commit, '--', file).toString();
  if (!/^100(644|755) blob [a-f0-9]{40}\t/.test(tree)) throw new Error(`Not a regular Git blob: ${file}`);
  return [file, git('show', `${commit}:${file}`)];
});
const files = Object.fromEntries(blobs.map(([file, bytes]) => [file, {
  sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
}]));
const lock = {
  schemaVersion: 1, repository: 'https://github.com/msitarzewski/agency-agents.git',
  commit, license: 'MIT', files,
};
mkdirSync(dest, { recursive: true });
for (const [file, bytes] of blobs) {
  const target = path.join(dest, 'upstream', file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
}
writeFileSync(path.join(dest, 'source-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
console.log(`Retained ${blobs.length} Git blobs from ${commit} at ${dest}`);
