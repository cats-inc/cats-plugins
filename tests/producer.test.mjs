import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { convert, frontmatter, loadInputs, makeSkill, payload, PLUGIN } from '../src/agency.mjs';
import { pack, verifyArchive } from '../src/archive.mjs';
import { LIMIT, readRegular, safePath, sha256, writableDirectory } from '../src/files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function temporary(t) {
  const dir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'cats-plugins-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t) {
  const dir = temporary(t);
  cpSync(path.join(root, 'plugins'), path.join(dir, 'plugins'), { recursive: true });
  return dir;
}

test('pinned upstream converter produces exactly two complete role payloads; archive is reproducible', () => {
  const inputs = loadInputs(root);
  const converted = convert(inputs);
  const first = pack(payload(root, inputs, converted));
  const second = pack(payload(root, inputs, convert(inputs)));
  assert.deepEqual(first, second);
  const expected = payload(root, inputs);
  assert.equal(verifyArchive(first, expected, sha256(first)).files, 11);
  const files = unzipSync(first);
  for (const skill of inputs.recipe.skills) {
    const entry = `skills/work/${skill.slug}/SKILL.md`;
    const parsed = frontmatter(Buffer.from(files[entry]));
    assert.equal(parsed.data.name, skill.slug);
    assert.equal(parsed.data.slug, skill.slug);
    assert.equal(parsed.data.packageKind, 'role');
    assert.deepEqual(parsed.data.deliveryHints, ['filesystem', 'instructions']);
    assert.ok(parsed.body.length > 2000, 'Full upstream instructions retained');
    assert.deepEqual(Buffer.from(files[`provenance/originals/${skill.source}`]), inputs.sources[skill.source]);
  }
  assert.deepEqual(Buffer.from(files['licenses/agency-agents-MIT.txt']), inputs.sources.LICENSE);
  const manifest = JSON.parse(Buffer.from(files['plugin.json']));
  assert.equal(manifest.capabilities.length, 2);
  assert.deepEqual(manifest.lifecycle.hooks, {});
  assert.equal(manifest.hostCompatibility.desktopInstall, false);
  assert.deepEqual(manifest.permissions, []);
});

test('modified upstream script/content fails source verification before execution', t => {
  for (const file of ['scripts/convert.sh', 'engineering/engineering-code-reviewer.md']) {
    const dir = fixture(t);
    writeFileSync(path.join(dir, PLUGIN, 'upstream', file), 'tampered');
    assert.throws(() => loadInputs(dir), /Source digest mismatch/);
  }
});

test('unlisted files and mutable revision locks fail closed', t => {
  const dir = fixture(t);
  writeFileSync(path.join(dir, PLUGIN, 'upstream', 'extra.md'), 'unselected');
  assert.throws(() => loadInputs(dir), /file set mismatch/);
  const other = fixture(t);
  const file = path.join(other, PLUGIN, 'source-lock.json');
  const lock = JSON.parse(readFileSync(file));
  lock.commit = 'main';
  writeFileSync(file, JSON.stringify(lock));
  assert.throws(() => loadInputs(other), /Invalid source lock/);
});

test('duplicate skills and malformed frontmatter are rejected', t => {
  const dir = fixture(t);
  const file = path.join(dir, PLUGIN, 'recipe.json');
  const recipe = JSON.parse(readFileSync(file));
  recipe.skills[1].slug = recipe.skills[0].slug;
  writeFileSync(file, JSON.stringify(recipe));
  assert.throws(() => loadInputs(dir), /Duplicate/);
  const inputs = loadInputs(root);
  const skill = inputs.recipe.skills[0];
  assert.throws(() => makeSkill(inputs.sources[skill.source], skill, '0.1.0', Buffer.from('---\nname: bad\nname: other\n---\nx')), /Invalid skill YAML/);
  const changed = convert(inputs)[skill.slug].toString().replace('Code Reviewer Agent', 'Edited upstream body');
  assert.throws(() => makeSkill(inputs.sources[skill.source], skill, '0.1.0', Buffer.from(changed)), /Unexpected upstream conversion/);
});

test('recipe extras cannot override the validated skill identity or description', () => {
  const inputs = loadInputs(root);
  const skill = { ...inputs.recipe.skills[0], name: 'builtin-code-reviewer', description: 'replace me' };
  const result = frontmatter(makeSkill(inputs.sources[skill.source], skill, '0.1.0'));
  assert.equal(result.data.name, skill.slug);
  assert.equal(result.data.description, frontmatter(inputs.sources[skill.source]).data.description);
});

test('import retains original Git blobs despite replacement refs and dirty working files', t => {
  const dir = temporary(t);
  const checkout = path.join(dir, 'upstream');
  mkdirSync(checkout);
  const hooks = path.join(dir, 'empty-hooks');
  mkdirSync(hooks);
  const git = (...args) => execFileSync('git', ['-C', checkout, '-c', `core.hooksPath=${hooks}`,
    '-c', 'commit.gpgsign=false', '-c', 'user.name=Producer test', '-c', 'user.email=test@example.invalid', ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  const paths = Object.keys(loadInputs(root).lock.files);
  for (const file of paths) {
    mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
    writeFileSync(path.join(checkout, file), `original ${file}\n`);
  }
  git('add', '.');
  git('commit', '-m', 'test original snapshot');
  const original = git('rev-parse', 'HEAD');
  const file = 'engineering/engineering-code-reviewer.md';
  writeFileSync(path.join(checkout, file), 'replacement\n');
  git('add', '.');
  git('commit', '-m', 'test replacement snapshot');
  const replacement = git('rev-parse', 'HEAD');
  git('replace', original, replacement);
  assert.equal(git('show', `${original}:${file}`), 'replacement', 'Fixture replacement must be effective');
  writeFileSync(path.join(checkout, file), 'dirty checkout\n');
  const destination = path.join(dir, 'import');
  execFileSync(process.execPath, [path.join(root, 'scripts/import-agency.mjs'), checkout, original, destination], { stdio: 'pipe' });
  assert.equal(readFileSync(path.join(destination, 'upstream', file), 'utf8'), `original ${file}\n`);
  assert.equal(JSON.parse(readFileSync(path.join(destination, 'source-lock.json'))).commit, original);
});

test('unsupported delivery hints are rejected', t => {
  const dir = fixture(t);
  const file = path.join(dir, PLUGIN, 'recipe.json');
  const recipe = JSON.parse(readFileSync(file));
  recipe.skills[0].deliveryHints = ['magic'];
  writeFileSync(file, JSON.stringify(recipe));
  assert.throws(() => loadInputs(dir), /Invalid delivery hint/);
});

test('portable paths and linked source directories are rejected', t => {
  for (const name of ['../x', '/tmp/x', 'C:/x', 'a\\b', 'a//b', 'a/../b', 'x:stream', 'NUL.txt', 'a.']) {
    assert.throws(() => safePath(name), /Unsafe path/);
  }
  const dir = temporary(t);
  const target = path.join(dir, 'target');
  mkdirSync(target);
  writeFileSync(path.join(target, 'x.txt'), 'x');
  symlinkSync(target, path.join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readRegular(dir, 'link/x.txt'), /Linked path/);
  assert.throws(() => writableDirectory(path.join(dir, 'link', 'new')), /output ancestor/);
  const importer = spawnSync(process.execPath, [path.join(root, 'scripts/import-agency.mjs'), dir, 'a'.repeat(40), path.join(dir, 'link')], { encoding: 'utf8' });
  assert.equal(importer.status, 1);
  assert.match(importer.stderr, /output ancestor/);
  const cli = spawnSync(process.execPath, [path.join(root, 'src/cli.mjs'), 'build', path.join(dir, 'link', 'new')], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /output ancestor/);
  assert.equal(existsSync(path.join(target, 'new')), false);
});

test('artifact alterations cannot be blessed by rewriting its checksum or integrity manifest', () => {
  const expected = payload(root, loadInputs(root));
  const changed = { ...expected, 'NOTICE.txt': Buffer.from('changed') };
  let bytes = pack(changed);
  assert.throws(() => verifyArchive(bytes, expected, sha256(bytes)), /content mismatch/);
  bytes = pack({ ...expected, 'extra.txt': Buffer.from('extra') });
  assert.throws(() => verifyArchive(bytes, expected), /file set mismatch/);
  assert.throws(() => verifyArchive(pack(expected), expected, 'a'.repeat(64)), /digest mismatch/);
  assert.throws(() => verifyArchive(Buffer.alloc(8 * LIMIT + 1), expected), /too large/);
});

test('compressed, traversal, oversized and case-alias ZIP entries fail before use', () => {
  for (const [files, options, pattern] of [
    [{ 'a.txt': Buffer.from('compressed') }, { level: 6 }, /Unsupported ZIP/],
    [{ '../escape.txt': Buffer.from('bad') }, { level: 0 }, /Unsafe path/],
    [{ 'a.txt': Buffer.alloc(LIMIT + 1) }, { level: 0 }, /Unsupported ZIP/],
    [{ 'a.txt': Buffer.from('a'), 'A.txt': Buffer.from('b') }, { level: 0 }, /case-alias/],
  ]) assert.throws(() => verifyArchive(zipSync(files, options), {}), pattern);
});

test('CLI can rebuild into a fresh path, verify offline, and refuses to overwrite different content', t => {
  const dir = temporary(t);
  const output = path.join(dir, 'artifact');
  const cli = path.join(root, 'src', 'cli.mjs');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const built = JSON.parse(run('build', output));
  assert.equal(JSON.parse(run('verify', built.artifact)).sha256, built.sha256);
  assert.equal(JSON.parse(run('build', output)).sha256, built.sha256);
  // A crash after the artifact/sidecar writes must not count as a complete build.
  const incomplete = path.join(dir, 'incomplete');
  mkdirSync(incomplete);
  cpSync(built.artifact, path.join(incomplete, path.basename(built.artifact)));
  cpSync(`${built.artifact}.sha256`, path.join(incomplete, `${path.basename(built.artifact)}.sha256`));
  const missingReceipt = spawnSync(process.execPath, [cli, 'build', incomplete], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  assert.equal(missingReceipt.status, 1);
  assert.match(missingReceipt.stderr, /build receipt missing/);
  writeFileSync(built.artifact, 'keep this file');
  const failed = spawnSync(process.execPath, [cli, 'build', output], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Output exists/);
  assert.equal(readFileSync(built.artifact, 'utf8'), 'keep this file');
});
