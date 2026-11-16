import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fetchCommit, fetchVerifiedSource, isolatedGitEnv } from '../src/packs/git-source.mjs';
import { loadPack, sourceArchive, validateLock, validateRecipe, verifySourceArchive } from '../src/packs/linux-stt.mjs';
import { downloadModel } from '../src/packs/model.mjs';
import { readTar, writeTar } from '../src/packs/tar.mjs';
import { contentManifest, contentSha256, upstreamPath } from '../src/packs/tree.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = t => {
  // realpath: macOS's temporary directory sits behind a /var symbolic link.
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cats-packs-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// Builds a bare fixture repository from Git plumbing, so the same objects come
// out on every OS: no checkout, no file modes from the file system, no clocks.
function fixtureRepo(dir, entries) {
  const repo = path.join(dir, 'upstream.git');
  writeFileSync(path.join(dir, 'fixture-gitconfig'), '');
  const env = {
    ...isolatedGitEnv(path.join(dir, 'fixture-gitconfig')),
    GIT_INDEX_FILE: path.join(dir, 'fixture-index'), GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  };
  const git = (args, input) => execFileSync('git', ['--git-dir', repo, ...args], { env, input, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--bare', '--object-format=sha1']);
  for (const entry of entries) {
    const oid = entry.oid ?? git(['hash-object', '-w', '--stdin'], entry.content);
    git(['update-index', '--add', '--cacheinfo', `${entry.mode},${oid},${entry.path}`]);
  }
  const tree = git(['write-tree']);
  const commit = git(['commit-tree', '--no-gpg-sign', '-m', 'fixture', tree]);
  // A later commit makes the locked one a non-tip commit, as upstream tags are.
  const tip = git(['commit-tree', '--no-gpg-sign', '-m', 'later', '-p', commit, tree]);
  git(['update-ref', 'refs/heads/main', tip]);
  // A plain path uses the same local upload-pack transport as file:// on every
  // OS, without translating a Windows drive letter into a URL.
  return { url: repo, commit, tree };
}

const FILES = [
  { path: 'CMakeLists.txt', mode: '100644', content: 'project(fixture)\n' },
  { path: 'LICENSE', mode: '100644', content: 'MIT fixture\n' },
  { path: 'examples/name with spaces/Contents.json', mode: '100644', content: '{}\n' },
  { path: 'scripts/run.sh', mode: '100755', content: '#!/bin/sh\n' },
  { path: '.github/ci.yml', mode: '100644', content: 'on: push\n' },
];

function fixtureSource(t, entries = FILES) {
  const dir = temp(t);
  const repo = fixtureRepo(dir, entries);
  // Independent of contentManifest: each regular file, ordered by UTF-8 bytes.
  const lines = entries.filter(e => !e.oid).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map(e => `${e.mode} ${hex(Buffer.from(e.content))} ${Buffer.byteLength(e.content)} ${e.path}\n`).join('');
  const source = { commit: repo.commit, tree: repo.tree, files: entries.length, contentSha256: hex(lines) };
  return { dir, url: repo.url, source, work: path.join(dir, 'work') };
}

test('the upstream path check keeps real upstream names and rejects escapes', () => {
  for (const name of ['a', '.github/x.yml', 'examples/Supporting files/Contents.json', 'x/y+z/a.c']) {
    assert.equal(upstreamPath(name), name);
  }
  for (const name of ['', '/abs', 'a/../b', './a', 'a//b', 'a/', '.git/config', 'A/.GIT/x', 'a\\b', 'c:x', 'a\0b', 'a\nb']) {
    assert.throws(() => upstreamPath(name), /Unsafe upstream path/, JSON.stringify(name));
  }
  assert.throws(() => contentManifest([
    { path: 'Read.me', mode: '100644', bytes: Buffer.from('a') },
    { path: 'read.me', mode: '100644', bytes: Buffer.from('b') },
  ]), /case-alias/);
  assert.throws(() => contentManifest([
    { path: 'A', mode: '100644', bytes: Buffer.from('a') },
    { path: 'a/x', mode: '100644', bytes: Buffer.from('b') },
  ]), /collide by case: a/);
});

test('a locked commit is fetched by hash and its content hash matches an independent computation', t => {
  const { url, source, work } = fixtureSource(t);
  const entries = fetchVerifiedSource(source, work, url);
  assert.deepEqual(entries.map(e => [e.path, e.mode, e.bytes.toString()]).sort(),
    FILES.map(e => [e.path, e.mode, e.content]).sort());
  assert.equal(contentSha256(entries), source.contentSha256);
});

test('AC-01: a wrong commit stops the fetch', t => {
  const { url, source, dir } = fixtureSource(t);
  // The same repository serves the locked commit, so only the hash differs.
  assert.equal(fetchVerifiedSource(source, path.join(dir, 'work-good'), url).length, FILES.length);
  assert.throws(() => fetchVerifiedSource({ ...source, commit: '1'.repeat(40) }, path.join(dir, 'work-bad'), url),
    /Cannot fetch commit 1{40}/);
});

test('inherited Git configuration variables do not reach the fetch', t => {
  const { url, source, work } = fixtureSource(t);
  const saved = { ...process.env };
  t.after(() => {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  });
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'never',
    GIT_CONFIG_PARAMETERS: "'protocol.allow'='never'", GIT_DEFAULT_HASH: 'sha256',
  });
  assert.equal(fetchVerifiedSource(source, work, url).length, FILES.length);
});

test('AC-01: a wrong tree, file count or content hash stops the fetch', t => {
  const { url, source, dir } = fixtureSource(t);
  const cases = [
    [{ tree: '2'.repeat(40) }, /does not match the locked tree/],
    [{ files: source.files + 1 }, /the lock expects 6/],
    [{ contentSha256: '3'.repeat(64) }, /content hash .* does not match the lock/],
  ];
  cases.forEach(([change, error], index) =>
    assert.throws(() => fetchVerifiedSource({ ...source, ...change }, path.join(dir, `work-${index}`), url), error));
});

test('branch names, tags and short hashes are never fetched', t => {
  const { url, dir } = fixtureSource(t);
  ['main', 'v1.0.0', 'HEAD', 'abc1234', 'A'.repeat(40)].forEach((ref, index) =>
    assert.throws(() => fetchCommit(url, ref, path.join(dir, `work-${index}`)), /full 40-character hash/));
});

test('symbolic links and submodules in the upstream tree stop the read', t => {
  const link = fixtureSource(t, [...FILES, { path: 'ggml/link', mode: '120000', content: 'LICENSE' }]);
  assert.throws(() => fetchVerifiedSource(link.source, link.work, link.url), /Unsupported upstream entry 120000 blob: ggml\/link/);
  const sub = fixtureSource(t, [...FILES, { path: 'ggml/sub', mode: '160000', oid: '4'.repeat(40) }]);
  assert.throws(() => fetchVerifiedSource(sub.source, sub.work, sub.url), /Unsupported upstream entry 160000 commit: ggml\/sub/);
});

const recipe = () => JSON.parse(readFileSync(path.join(root, 'packs/linux-stt/recipe.json'), 'utf8'));
const lock = () => JSON.parse(readFileSync(path.join(root, 'packs/linux-stt/source-lock.json'), 'utf8'));

test('the checked-in recipe and lock validate, with the measured model and the pinned build image', () => {
  const pack = loadPack(root);
  assert.equal(pack.lock.whisper.commit, 'd1be6fde11ac6e0407606b4e42fe72d34add8037');
  assert.deepEqual(pack.recipe.models.candidates, pack.lock.models.map(model => model.file));
  // ADR-002 D3: the first candidate that passes the reference-board measurement.
  assert.equal(pack.recipe.models.selected, 'ggml-base.bin');
  assert.equal(pack.recipe.threads, 4);
  assert.match(pack.recipe.build.image, /^ubuntu:22\.04@sha256:[a-f0-9]{64}$/);
  assert.match(pack.recipe.build.packageSnapshot, /^\d{8}T\d{6}Z$/);
});

test('the recipe validator rejects values outside SPEC-002 FR-A2', () => {
  const cases = [
    [r => { r.cpuBaseline.x64 = 'native'; }, /ADR-002 D1/],
    [r => { r.models.selected = 'ggml-small.bin'; }, /must be a candidate/],
    [r => { r.models.candidates.push('ggml-base.bin'); }, /distinct/],
    [r => { r.threads = 0; }, /thread count/],
    [r => { r.languageMapping.jw = 'jw'; }, /language mapping/],
    [r => { r.build.image = 'ubuntu:22.04'; }, /pinned by digest/],
    [r => { r.build.packageSnapshot = 'latest'; }, /snapshot id/],
    [r => { r.minGlibc = '2.31'; }, /glibc 2.35/],
    [r => { r.languages = ['en']; }, /exactly/],
  ];
  for (const [change, error] of cases) {
    const value = recipe();
    change(value);
    assert.throws(() => validateRecipe(value), error);
  }
});

test('the lock validator rejects branches, unpinned or plain-HTTP URLs and candidate drift', () => {
  const cases = [
    [l => { l.whisper.commit = 'master'; }, /full commit and tree hashes/],
    [l => { l.whisper.tree = l.whisper.tree.slice(0, 7); }, /full commit and tree hashes/],
    [l => { l.whisper.repository = 'http://github.com/ggml-org/whisper.cpp.git'; }, /HTTPS GitHub/],
    [l => { l.models[0].url = l.models[0].url.replace(/resolve\/[a-f0-9]{40}/, 'resolve/main'); }, /pinned to a revision/],
    [l => { l.models[0].url = l.models[0].url.replace('https:', 'http:'); }, /pinned to a revision/],
    [l => { l.models[1].url = l.models[1].url.replace('q5_1', 'q8_0'); }, /pinned to a revision/],
    [l => { l.models.reverse(); }, /exactly the recipe candidates/],
    [l => { l.models.pop(); }, /exactly the recipe candidates/],
    [l => { l.models[0].sha256 = 'latest'; }, /Invalid model lock entry/],
    [l => { l.whisper.branch = 'master'; }, /exactly/],
  ];
  for (const [change, error] of cases) {
    const value = lock();
    change(value);
    assert.throws(() => validateLock(value, recipe()), error);
  }
});

const MODEL = Buffer.from('fixture model bytes');
const model = { file: 'ggml-fixture.bin', url: 'https://example.invalid/resolve/x/ggml-fixture.bin', size: MODEL.length, sha256: hex(MODEL) };
const respond = (bytes, init = {}) => async () => new Response(bytes, { status: init.status ?? 200 });
const respondWithUrl = (bytes, url) => async () => {
  const response = new Response(bytes);
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

test('a model is kept only when its size and SHA-256 match', async t => {
  const dir = temp(t);
  const target = path.join(dir, model.file);
  await downloadModel(model, target, { fetch: respond(MODEL) });
  assert.ok(readFileSync(target).equals(MODEL));
});

test('AC-01: a wrong model size or hash, an HTTP error or a redirect off HTTPS leaves no file', async t => {
  const dir = temp(t);
  const cases = [
    [respond(MODEL.subarray(1)), /has 18 bytes; the lock expects 19/],
    [respond(Buffer.concat([MODEL, Buffer.from('!')])), /larger than the locked 19 bytes/],
    [respond(Buffer.from('fixture model bytez')), /SHA-256 .* does not match the lock/],
    [respond(MODEL, { status: 404 }), /HTTP 404/],
    [respondWithUrl(MODEL, 'http://example.invalid/ggml-fixture.bin'), /left HTTPS/],
  ];
  for (const [fetch, error] of cases) {
    await assert.rejects(downloadModel(model, path.join(dir, model.file), { fetch }), error);
    assert.deepEqual(readdirSync(dir), []);
  }
});

test('the tar writer is deterministic, splits long paths and refuses what ustar cannot hold', () => {
  const entries = [
    { path: 'b/run.sh', mode: 0o755, bytes: Buffer.from('#!/bin/sh\n') },
    { path: 'a.txt', mode: 0o644, bytes: Buffer.from('a') },
    { path: `${'d'.repeat(60)}/${'e'.repeat(58)}`, mode: 0o644, bytes: Buffer.alloc(513, 1) },
  ];
  const bytes = writeTar(entries);
  // Golden digest: the same bytes on Linux, macOS and Windows.
  assert.equal(hex(bytes), '93d4a0e4124f117374a561ba72c4afda9a0d63916f253b937b814172ef9fc95a');
  assert.ok(writeTar([...entries].reverse()).equals(bytes));
  assert.deepEqual(readTar(bytes).map(e => [e.path, e.mode, e.bytes.length]),
    [['a.txt', 0o644, 1], ['b/run.sh', 0o755, 10], [entries[2].path, 0o644, 513]]);
  assert.throws(() => writeTar([{ path: 'x'.repeat(101), mode: 0o644, bytes: Buffer.alloc(0) }]), /does not fit ustar/);
  assert.throws(() => writeTar([{ path: 'a', mode: 0o777, bytes: Buffer.alloc(0) }]), /Unsupported archive mode/);
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 1;
  assert.throws(() => readTar(tampered), /checksum/);
  assert.throws(() => readTar(Buffer.concat([bytes, Buffer.alloc(512, 1)])), /after ustar end/);
});

test('the retained source archive is deterministic and holds the tree, bridge, recipe and lock', t => {
  const { url, source, work } = fixtureSource(t);
  const entries = fetchVerifiedSource(source, work, url);
  const pack = {
    recipe: recipe(), lock: { whisper: { files: source.files, contentSha256: source.contentSha256 } },
    recipeBytes: Buffer.from('{"recipe":true}\n'), lockBytes: Buffer.from('{"lock":true}\n'),
  };
  const bridge = [{ path: 'CMakeLists.txt', bytes: Buffer.from('project(bridge)\n') }, { path: 'src/main.c', bytes: Buffer.from('int main;\n') }];
  const bytes = sourceArchive(pack, entries, bridge);
  assert.ok(sourceArchive(pack, [...entries].reverse(), bridge).equals(bytes));
  assert.equal(verifySourceArchive(bytes, pack, bridge).files, FILES.length + 4);
  const prefix = 'linux-stt-0.1.0-sources/';
  assert.deepEqual(readTar(bytes).map(e => [e.path.slice(prefix.length), e.mode.toString(8)]), [
    ['bridge/CMakeLists.txt', '644'], ['bridge/src/main.c', '644'], ['recipe.json', '644'], ['source-lock.json', '644'],
    ['whisper.cpp/.github/ci.yml', '644'], ['whisper.cpp/CMakeLists.txt', '644'], ['whisper.cpp/LICENSE', '644'],
    ['whisper.cpp/examples/name with spaces/Contents.json', '644'], ['whisper.cpp/scripts/run.sh', '755'],
  ]);

  const rewrite = change => writeTar(readTar(bytes).map(e => change({ ...e, path: e.path.slice(prefix.length) }))
    .filter(Boolean).map(e => ({ ...e, path: prefix + e.path })));
  const cases = [
    [e => e.path === 'whisper.cpp/LICENSE' ? { ...e, bytes: Buffer.from('MIT fixturE\n') } : e, /tree does not match the lock/],
    [e => e.path === 'whisper.cpp/scripts/run.sh' ? { ...e, mode: 0o644 } : e, /tree does not match the lock/],
    [e => e.path === 'whisper.cpp/LICENSE' ? null : e, /tree does not match the lock/],
    [e => e.path === 'recipe.json' ? { ...e, bytes: Buffer.from('{}\n') } : e, /content mismatch: recipe.json/],
    [e => e.path === 'bridge/src/main.c' ? null : e, /file set does not match/],
    [e => e.path === 'source-lock.json' ? { ...e, mode: 0o755 } : e, /Unexpected mode/],
  ];
  for (const [change, error] of cases) assert.throws(() => verifySourceArchive(rewrite(change), pack, bridge), error);
  assert.throws(() => verifySourceArchive(writeTar([...readTar(bytes), { path: 'outside.txt', mode: 0o644, bytes: Buffer.alloc(0) }]), pack, bridge),
    /outside linux-stt-0.1.0-sources/);
});

test('the pack command checks the lock and exposes only its implemented subcommands', t => {
  const cli = path.join(root, 'src/packs/cli.mjs');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const check = run('check', 'linux-stt');
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).commit, 'd1be6fde11ac6e0407606b4e42fe72d34add8037');
  for (const args of [['build', 'linux-stt'], ['check', 'agency-agents'], ['fetch', 'linux-stt'], ['check', 'linux-stt', 'extra']]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage:/);
  }
  assert.match(run('fetch', 'linux-stt', '--out', path.join(temp(t), 'x'), '--model', 'ggml-small.bin').stderr, /Unknown model/);
  const existing = temp(t);
  assert.match(run('fetch', 'linux-stt', '--out', existing).stderr, /Output exists/);
});
