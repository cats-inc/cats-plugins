import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { contentSha256, MODES, upstreamPath } from './tree.mjs';

const MAX_TREE_BYTES = 256 * 2 ** 20;

// Git runs with no inherited GIT_* variables, an empty global configuration, no
// system configuration and no prompts, so a user's URL rewrites, hooks,
// credentials or default object format never take part.
export function isolatedGitEnv(globalConfig) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/iu.test(name)));
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_COUNT: '0',
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C',
  };
}

function git(workDir, args, options = {}) {
  return execFileSync('git', ['--git-dir', path.join(workDir, 'repo.git'), ...args], {
    maxBuffer: MAX_TREE_BYTES, timeout: 10 * 60_000, ...options, env: isolatedGitEnv(path.join(workDir, 'gitconfig')),
  });
}

// Fetches exactly one commit, never a branch or tag, into a bare repository
// under workDir. Nothing is checked out: files are read from Git objects, so
// line-ending and case-folding settings cannot change them.
export function fetchCommit(repositoryUrl, commit, workDir) {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('A source commit must be a full 40-character hash');
  mkdirSync(workDir, { recursive: true });
  writeFileSync(path.join(workDir, 'gitconfig'), '', { flag: 'wx' });
  git(workDir, ['init', '--quiet', '--bare', '--object-format=sha1']);
  try {
    git(workDir, ['fetch', '--quiet', '--depth=1', '--no-tags', '--no-recurse-submodules', '--', repositoryUrl, commit],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`Cannot fetch commit ${commit}: ${String(error.stderr ?? error.message).trim()}`);
  }
  const fetched = git(workDir, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { encoding: 'utf8' }).trim();
  if (fetched !== commit) throw new Error(`Fetched commit ${fetched} is not the locked commit ${commit}`);
  return git(workDir, ['rev-parse', '--verify', `${commit}^{tree}`], { encoding: 'utf8' }).trim();
}

// Lists every entry of the commit's tree and reads each blob. Symbolic links,
// submodules and any mode other than a regular file stop the read.
export function readCommitTree(workDir, commit) {
  const listing = git(workDir, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8');
  const items = listing.split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(line);
    if (!match) throw new Error(`Unexpected tree entry: ${JSON.stringify(line)}`);
    const [, mode, type, oid, file] = match;
    upstreamPath(file);
    if (type !== 'blob' || !MODES.has(mode)) throw new Error(`Unsupported upstream entry ${mode} ${type}: ${file}`);
    return { mode, oid, path: file };
  });
  const output = git(workDir, ['cat-file', '--batch'], { input: items.map(item => `${item.oid}\n`).join('') });
  let offset = 0;
  return items.map(item => {
    const end = output.indexOf(0x0a, offset);
    const [oid, type, size] = output.toString('latin1', offset, end).split(' ');
    const length = Number(size);
    if (oid !== item.oid || type !== 'blob' || !Number.isSafeInteger(length)) throw new Error(`Cannot read blob: ${item.path}`);
    const bytes = Buffer.from(output.subarray(end + 1, end + 1 + length));
    offset = end + 1 + length + 1;
    return { path: item.path, mode: item.mode, bytes };
  });
}

// Every check runs before any build step can use the files.
export function fetchVerifiedSource(source, workDir, repositoryUrl = source.repository) {
  const tree = fetchCommit(repositoryUrl, source.commit, workDir);
  if (tree !== source.tree) throw new Error(`Source tree ${tree} does not match the locked tree ${source.tree}`);
  const entries = readCommitTree(workDir, source.commit);
  if (entries.length !== source.files) throw new Error(`Source has ${entries.length} files; the lock expects ${source.files}`);
  const actual = contentSha256(entries);
  if (actual !== source.contentSha256) throw new Error(`Source content hash ${actual} does not match the lock`);
  return entries;
}
