import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const step = (id) => workflow.jobs.changes.steps.find((item) => item.id === id);
const detector = step('paths').run;
const bash = process.platform === 'win32'
  ? resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../../bin/bash.exe')
  : 'bash';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cats-ci-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, content = 'fixture\n') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const detect = (event, before = '') => {
    const output = join(root, '.git', 'ci-output');
    writeFileSync(output, '');
    const result = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', detector], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, EVENT: event, BEFORE: before, GITHUB_OUTPUT: output.replaceAll('\\', '/') },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return readFileSync(output, 'utf8').trim();
  };
  git('init', '--initial-branch=main');
  write('src/code.ts');
  write('README.md');
  const base = commit();
  return { root, git, write, commit, detect, base };
}

test('workflow detects the complete push range and both sides of docs boundary renames', t => {
  const f = fixture(t);
  f.write('docs/guide.md');
  f.write('docs/使用說明.md');
  const docs = f.commit();
  assert.equal(f.detect('push', f.base), 'code=false');

  f.write('src/code.ts', 'changed\n');
  f.write('docs/guide.md', 'changed docs\n');
  const mixed = f.commit();
  assert.equal(f.detect('push', docs), 'code=true');

  f.write('docs/guide.md', 'more docs\n');
  const latest = f.commit();
  assert.equal(f.detect('push', mixed), 'code=false');
  assert.equal(f.detect('push', docs), 'code=true', 'a multi-commit push includes earlier code changes');

  f.git('mv', 'src/code.ts', 'docs/moved.ts');
  const movedIn = f.commit();
  assert.equal(f.detect('push', latest), 'code=true', 'moving code into docs still removes executable input');

  f.git('mv', 'docs/moved.ts', 'src/moved.ts');
  const movedOut = f.commit();
  assert.equal(f.detect('push', movedIn), 'code=true');

  f.git('rm', 'docs/guide.md');
  f.commit();
  assert.equal(f.detect('push', movedOut), 'code=false');

  const previous = f.git('rev-parse', 'HEAD');
  f.write('nested/docs/guide.md');
  f.commit();
  assert.equal(f.detect('push', previous), 'code=true', 'only the root docs directory is excluded');
});

test('workflow compares the PR merge to its current base and defaults to full checks when unknown', t => {
  const f = fixture(t);
  f.git('switch', '-c', 'docs-change');
  f.write('docs/guide.md');
  f.commit();
  f.git('switch', 'main');
  f.write('src/code.ts', 'new base code\n');
  f.commit();
  f.git('merge', '--no-ff', 'docs-change', '-m', 'synthetic PR merge');
  assert.equal(f.detect('pull_request'), 'code=false', 'base branch code changes are already in HEAD^1');
  assert.equal(f.detect('push', ''), 'code=true');
  assert.equal(f.detect('push', '0'.repeat(40)), 'code=true');
  assert.equal(f.detect('push', 'a'.repeat(40)), 'code=true');
  assert.equal(f.detect('push', f.git('rev-parse', 'HEAD')), 'code=true', 'empty diff never skips CI');
  assert.equal(f.detect('workflow_dispatch', f.base), 'code=true');

  f.git('switch', '-c', 'mixed-change');
  f.write('README.md', 'root docs are outside the excluded directory\n');
  f.write('docs/guide.md', 'more docs\n');
  f.commit();
  f.git('switch', 'main');
  f.git('merge', '--no-ff', 'mixed-change', '-m', 'synthetic mixed PR merge');
  assert.equal(f.detect('pull_request'), 'code=true');
});

test('root agent instructions count as documentation only while they still exist at HEAD', t => {
  const f = fixture(t);
  f.write('AGENTS.md');
  f.write('CLAUDE.md');
  const added = f.commit();
  assert.equal(f.detect('push', f.base), 'code=false', 'adding root agent files is documentation');

  f.write('AGENTS.md', 'edited\n');
  const edited = f.commit();
  assert.equal(f.detect('push', added), 'code=false', 'an AGENTS.md-only edit is documentation');

  f.write('CODEX.md');
  f.write('GEMINI.md');
  f.write('docs/guide.md');
  const withDocs = f.commit();
  assert.equal(f.detect('push', edited), 'code=false', 'agent files and docs/ together are documentation');

  f.write('docs/使用說明.md');
  const unicodeDocs = f.commit();
  assert.equal(f.detect('push', withDocs), 'code=false', 'a non-ASCII docs/ path is documentation');

  f.write('AGENTS.md', 'edited with code\n');
  f.write('src/code.ts', 'changed\n');
  const withCode = f.commit();
  assert.equal(f.detect('push', unicodeDocs), 'code=true');

  f.git('rm', '--quiet', 'CLAUDE.md');
  const deleted = f.commit();
  assert.equal(f.detect('push', withCode), 'code=true', 'a deleted root CLAUDE.md is code');

  f.git('mv', 'GEMINI.md', 'docs/GEMINI.md');
  const renamed = f.commit();
  assert.equal(f.detect('push', deleted), 'code=true', 'renaming a root agent file away is code');

  f.write('sub/AGENTS.md');
  const nested = f.commit();
  assert.equal(f.detect('push', renamed), 'code=true', 'a nested sub/AGENTS.md is code');
  f.write('sub/AGENTS.md', 'edited\n');
  f.commit();
  assert.equal(f.detect('push', nested), 'code=true', 'editing a nested sub/AGENTS.md is code');

  f.git('switch', '--quiet', '-c', 'agents-change');
  f.write('CODEX.md', 'reviewed\n');
  f.commit();
  f.git('switch', '--quiet', 'main');
  f.write('src/code.ts', 'new base code\n');
  f.commit();
  f.git('merge', '--no-ff', 'agents-change', '-m', 'synthetic agent instructions PR merge');
  assert.equal(f.detect('pull_request'), 'code=false');

  // Replace the root AGENTS.md with a symbolic link in the index only.
  const merge = f.git('rev-parse', 'HEAD');
  const target = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.root, input: 'README.md', encoding: 'utf8' }).trim();
  f.git('update-index', '--cacheinfo', `120000,${target},AGENTS.md`);
  f.git('commit', '-m', 'agent file type change');
  assert.equal(f.detect('push', merge), 'code=true', 'a type change of a root agent file is code');
});

test('the fingerprint covers code outside docs/ and root agent files by path, not content', t => {
  const fingerprint = step('fingerprint').run;
  if (spawnSync(bash, ['-c', 'command -v sha256sum']).status !== 0) {
    t.skip('sha256sum is not available');
    return;
  }
  const f = fixture(t);
  // Hosted runners quote non-ASCII paths by default; the step must undo that.
  f.git('config', 'core.quotePath', 'true');
  const print = () => {
    const output = runStep(fingerprint, f.root, {});
    assert.match(output, /^fingerprint=[0-9a-f]{64}$/u);
    return output;
  };
  f.write('AGENTS.md');
  f.write('CLAUDE.md');
  f.write('sub/AGENTS.md');
  f.write('docs/guide.md');
  f.write('docs/使用說明.md');
  f.commit();
  const initial = print();

  f.write('AGENTS.md', 'edited\n');
  f.write('CLAUDE.md', 'edited\n');
  f.write('docs/guide.md', 'edited\n');
  f.write('docs/使用說明.md', 'edited\n');
  f.write('docs/new.md');
  f.commit();
  assert.equal(print(), initial, 'documentation and root agent file edits keep the fingerprint');

  f.write('GEMINI.md');
  f.commit();
  const withGemini = print();
  assert.notEqual(withGemini, initial, 'adding a root agent file changes its presence');

  f.git('rm', '--quiet', 'CLAUDE.md');
  f.commit();
  const deleted = print();
  assert.notEqual(deleted, withGemini, 'deleting a root agent file changes its presence');

  chmodSync(join(f.root, 'AGENTS.md'), 0o755);
  f.git('update-index', '--chmod=+x', 'AGENTS.md');
  f.commit();
  const executable = print();
  assert.notEqual(executable, deleted, 'a root agent file keeps its mode');

  f.write('sub/AGENTS.md', 'edited\n');
  f.commit();
  const nested = print();
  assert.notEqual(nested, executable, 'a nested sub/AGENTS.md is code');

  f.write('src/code.ts', 'changed\n');
  f.commit();
  assert.notEqual(print(), nested, 'code changes change the fingerprint');
});

test('an earlier green run is found by fingerprint and recorded only after every check passed', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['changes', 'producer', 'linux-stt', 'reproducibility']);
  assert.deepEqual(workflow.jobs.producer.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
  const changes = workflow.jobs.changes;
  assert.equal(changes.outputs.fingerprint, '${{ steps.fingerprint.outputs.fingerprint }}');
  assert.deepEqual(changes.steps.map(item => item.id).filter(Boolean), ['paths', 'fingerprint', 'green', 'merged', 'plan']);
  const green = step('green');
  assert.equal(green.uses, 'actions/cache/restore@v4');
  assert.equal(green.if, "steps.paths.outputs.code == 'true' && github.event_name != 'workflow_dispatch'",
    'manual runs and documentation-only changes never look up a marker');
  assert.deepEqual(green.with, {
    path: '.ci-green', key: 'ci-green-v1-${{ steps.fingerprint.outputs.fingerprint }}', 'lookup-only': true,
  });
  assert.equal(step('plan').env.GREEN, '${{ steps.green.outputs.cache-hit }}');
  assert.equal(step('plan').env.MERGED, '${{ steps.merged.outputs.tested }}');

  const producer = workflow.jobs.producer.steps;
  assert.ok(!producer.some(item => String(item.uses).startsWith('actions/cache/')),
    'producer legs never save the marker before every leg passed');
  const reproducibility = workflow.jobs.reproducibility;
  assert.deepEqual(reproducibility.needs, ['changes', 'producer', 'linux-stt']);
  const steps = reproducibility.steps;
  const compare = steps.findIndex(item => item.name === 'Compare artifact hashes across operating systems');
  const record = steps.findIndex(item => item.name === 'Record this code as tested');
  const save = steps.findIndex(item => item.name === 'Save the tested marker');
  assert.ok(compare > 0 && record === compare + 1 && save === steps.length - 1 && save === record + 1);
  for (const item of [steps[record], steps[save]]) {
    assert.equal(item.if, "env.SKIP == '' && needs.changes.outputs.fingerprint != ''");
  }
  assert.equal(steps[record].env.FINGERPRINT, '${{ needs.changes.outputs.fingerprint }}');
  assert.equal(steps[save].uses, 'actions/cache/save@v4');
  assert.deepEqual(steps[save].with, { path: '.ci-green', key: 'ci-green-v1-${{ needs.changes.outputs.fingerprint }}' });
  assert.equal(reproducibility.env.SKIP, "${{ needs.changes.result == 'success' && needs.changes.outputs.skip || '' }}",
    'a failed detection runs every step');
});

test('the linux-stt jobs follow the skip plan and build without a network on each architecture', () => {
  const job = workflow.jobs['linux-stt'];
  assert.deepEqual(job.needs, 'changes');
  assert.deepEqual(job.strategy.matrix.include, [
    { arch: 'x64', runner: 'ubuntu-24.04' }, { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
  ]);
  assert.equal(job['runs-on'], "${{ needs.changes.result == 'success' && needs.changes.outputs.skip != '' && 'ubuntu-latest' || matrix.runner }}",
    'a skip allocates no native runner');
  assert.equal(job.env.SKIP, workflow.jobs.producer.env.SKIP);
  const work = job.steps.filter(item => !['Documentation-only change', 'Already tested'].includes(item.name));
  assert.ok(work.every(item => item.if === "env.SKIP == ''"), 'every work step honours the skip');
  const build = job.steps.find(item => item.name === 'Build without a network');
  assert.match(build.run, /unshare --net/);
  assert.match(build.run, /--sources inputs\/linux-stt-\*-sources\.tar --models inputs\/models/);
  assert.ok(job.steps.some(item => /scripts\/linux-stt-protocol\.mjs/.test(item.run ?? '')));
  assert.ok(!job.steps.some(item => String(item.uses).startsWith('actions/cache/')), 'only reproducibility records a green run');
});

test('required reproducibility gate rejects failed, cancelled or missing producers', () => {
  const gate = workflow.jobs.reproducibility.steps[0].run;
  const check = (producer, linuxStt = 'success') => spawnSync(bash, ['-e', '-o', 'pipefail', '-c', gate], {
    env: { ...process.env, PRODUCER_RESULT: producer, LINUX_STT_RESULT: linuxStt },
  }).status;
  assert.equal(check('success'), 0);
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    assert.notEqual(check(result), 0);
    assert.notEqual(check('success', result), 0);
  }
});

function runStep(script, cwd, env) {
  const output = join(mkdtempSync(join(tmpdir(), 'cats-ci-output-')), 'output');
  writeFileSync(output, '');
  try {
    const result = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', script], {
      cwd, encoding: 'utf8', env: { ...process.env, ...env, GITHUB_OUTPUT: output.replaceAll('\\', '/') },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return readFileSync(output, 'utf8').trim();
  } finally {
    rmSync(dirname(output), { recursive: true, force: true });
  }
}

test('the plan skips docs-only changes first, then code that already passed', () => {
  const decide = (code, green, merged) => runStep(step('plan').run, process.cwd(), {
    CODE: code, GREEN: green, MERGED: merged,
  });
  assert.equal(decide('false', '', ''), 'skip=docs');
  assert.equal(decide('false', 'true', 'true'), 'skip=docs');
  assert.equal(decide('true', 'true', ''), 'skip=tested');
  assert.equal(decide('true', '', 'true'), 'skip=tested');
  assert.equal(decide('true', 'false', 'false'), 'skip=');
  assert.equal(decide('true', '', ''), 'skip=', 'skipped lookups run every check');
});

test('a main push reuses its merged pull request\'s green run only for that exact tree on the previous main', t => {
  const merged = step('merged');
  assert.equal(merged.if, "github.event_name == 'push' && steps.paths.outputs.code == 'true'");
  assert.deepEqual(workflow.jobs.changes.permissions, { contents: 'read', 'pull-requests': 'read', actions: 'read' });
  const root = mkdtempSync(join(tmpdir(), 'cats-ci-merged-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git'), work = join(root, 'work'), bin = join(root, 'bin');
  const git = (cwd, ...args) => execFileSync('git', [
    '-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, content) => { mkdirSync(dirname(join(work, path)), { recursive: true }); writeFileSync(join(work, path), content); };
  const commit = message => { git(work, 'add', '.'); git(work, 'commit', '-m', message); return git(work, 'rev-parse', 'HEAD'); };
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  mkdirSync(work); git(work, 'init', '--initial-branch=main'); git(work, 'remote', 'add', 'origin', origin);
  write('src/code.ts', 'base\n');
  const base = commit('base');
  // Pull request #7 is up to date with main, so its squash lands the same tree.
  git(work, 'switch', '-c', 'pr-7');
  write('src/code.ts', 'pull request seven\n');
  const head7 = commit('pr 7');
  git(work, 'push', '--quiet', 'origin', `${head7}:refs/pull/7/head`);
  git(work, 'switch', 'main');
  git(work, 'merge', '--squash', 'pr-7'); const squash7 = commit('squash #7');
  // Pull request #8 branched from the old main, and main moved before its squash.
  git(work, 'switch', '-c', 'pr-8', base);
  write('src/other.ts', 'pull request eight\n');
  const head8 = commit('pr 8');
  git(work, 'push', '--quiet', 'origin', `${head8}:refs/pull/8/head`);
  git(work, 'switch', 'main');
  git(work, 'merge', '--squash', 'pr-8'); const squash8 = commit('squash #8');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    'case "$2" in',
    '  */pulls) [ -n "${STUB_PULLS:-}" ] || exit 1; printf \'%s\\n\' "$STUB_PULLS" ;;',
    '  */actions/workflows/*) printf \'%s\\n\' "${STUB_PASSED:-0}" ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  const reuse = (head, before, pulls, passed) => {
    git(work, 'checkout', '--quiet', head);
    return runStep(merged.run, work, { PATH: `${bin}${delimiter}${process.env.PATH}`, REPO: 'cats-inc/cats-plugins',
      BEFORE: before, STUB_PULLS: pulls, STUB_PASSED: passed });
  };
  assert.equal(reuse(squash7, base, `7 ${head7}`, '1'), 'tested=true');
  assert.equal(reuse(squash7, base, `7 ${head7}`, '0'), 'tested=false', 'the pull request must have passed CI');
  assert.equal(reuse(squash7, base, '', '1'), 'tested=false', 'a failed lookup runs every check');
  assert.equal(reuse(squash7, base, `7 ${head8}`, '1'), 'tested=false', 'the reported head must be the pull request ref');
  assert.equal(reuse(squash7, base, `9 ${head7}`, '1'), 'tested=false', 'an unknown pull request ref runs every check');
  assert.equal(reuse(squash7, '', `7 ${head7}`, '1'), 'tested=false');
  assert.equal(reuse(squash8, base, `8 ${head8}`, '1'), 'tested=false', 'a push of several commits runs every check');
  assert.equal(reuse(squash8, squash7, `8 ${head8}`, '1'), 'tested=false', 'a head without the previous main was tested on other code');
});
