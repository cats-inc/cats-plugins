// Native build of the linux-stt helper inside the pinned ubuntu:22.04 image
// (cats-plugins SPEC-002 FR-C1). Packages come from the dated Ubuntu snapshot
// while the build environment image is created; the compile itself runs with
// networking disabled.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireThat } from '../files.mjs';

const PACKAGES = ['g++', 'cmake', 'make', 'pkg-config', 'libpulse-dev', 'binutils'];
export const hostArch = () => ({ x64: 'x64', arm64: 'arm64' })[process.arch];

export function environmentDockerfile(recipe) {
  const { image, packageSnapshot } = recipe.build;
  requireThat(image && packageSnapshot, 'The recipe has no build image or package snapshot yet');
  const archive = `https://snapshot.ubuntu.com/ubuntu/${packageSnapshot}`;
  const sources = ['jammy', 'jammy-updates', 'jammy-security']
    .map(suite => `deb [check-valid-until=no] ${archive} ${suite} main universe`).join('\\n');
  // The base image has no CA certificates; the build host's bundle is used for
  // the snapshot's TLS only, and apt still checks the archive's signatures.
  return [
    `FROM ${image}`,
    'COPY ca.crt /tmp/ca.crt',
    `RUN printf '${sources}\\n' > /etc/apt/sources.list \\`,
    '  && apt-get -o Acquire::https::CaInfo=/tmp/ca.crt -o Acquire::Retries=3 update \\',
    `  && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::https::CaInfo=/tmp/ca.crt -o Acquire::Retries=3 install -y --no-install-recommends ${PACKAGES.join(' ')} \\`,
    '  && rm -rf /var/lib/apt/lists/* /tmp/ca.crt',
    '',
  ].join('\n');
}

function caBundle() {
  const candidates = [process.env.CATS_PACK_CA_FILE, '/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'];
  const found = candidates.find(file => file && existsSync(file));
  requireThat(found, 'No CA bundle found; set CATS_PACK_CA_FILE');
  return readFileSync(found);
}

const run = (command, args, options = {}) => execFileSync(command, args, { maxBuffer: 64 * 2 ** 20, ...options });

// Creates (or reuses) the environment image for this recipe and returns its tag.
export function ensureEnvironment(recipe, work) {
  const dockerfile = environmentDockerfile(recipe);
  const tag = `cats-linux-stt-env:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 16)}`;
  const present = (() => {
    try {
      run('docker', ['image', 'inspect', tag], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!present) {
    const context = path.join(work, 'env');
    mkdirSync(context, { recursive: true });
    writeFileSync(path.join(context, 'Dockerfile'), dockerfile);
    writeFileSync(path.join(context, 'ca.crt'), caBundle());
    run('docker', ['build', '--quiet', '--tag', tag, context], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return tag;
}

// Writes the verified whisper.cpp tree and the bridge for the container.
export function stageSources(work, whisperEntries, bridge) {
  for (const entry of whisperEntries) {
    const target = path.join(work, 'whisper.cpp', ...entry.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.bytes, { flag: 'wx' });
    chmodSync(target, entry.mode === '100755' ? 0o755 : 0o644);
  }
  for (const file of bridge) {
    const target = path.join(work, 'bridge', ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { flag: 'wx' });
  }
}

export function cmakeOptions(recipe, arch, languageCount) {
  return {
    CMAKE_BUILD_TYPE: 'Release',
    WHISPER_SOURCE_DIR: '/work/whisper.cpp',
    CATS_STT_ARCH: arch,
    CATS_STT_MODEL_LANGUAGES: String(languageCount),
    CATS_STT_LANGUAGE_MAP: Object.entries(recipe.languageMapping).map(([from, to]) => `${from}=${to}`).join(','),
    CATS_STT_THREADS: String(recipe.threads ?? 0),
    CATS_STT_TESTS: 'ON',
  };
}

// Compiles in the environment image with networking disabled and runs the
// native unit tests. Returns the helper path and the toolchain versions.
export function compile(tag, work, options) {
  const user = typeof process.getuid === 'function' ? [`--user`, `${process.getuid()}:${process.getgid()}`] : [];
  const script = [
    'set -eu',
    `cmake -S /work/bridge -B /work/build ${Object.entries(options).map(([key, value]) => `'-D${key}=${value}'`).join(' ')} >/work/configure.log`,
    'cmake --build /work/build -j "$(nproc)" --target cats-stt-linux cpu_check_test protocol_test >/work/compile.log',
    '/work/build/cpu_check_test',
    '/work/build/protocol_test',
    'g++ --version | head -n1 >/work/compiler.txt',
    'cmake --version | head -n1 >/work/cmake.txt',
  ].join('\n');
  try {
    run('docker', ['run', '--rm', '--network', 'none', ...user, '-v', `${work}:/work`, '-w', '/work', tag, 'sh', '-c', script],
      { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (error) {
    for (const log of ['configure.log', 'compile.log']) {
      const file = path.join(work, log);
      if (existsSync(file)) process.stderr.write(readFileSync(file, 'utf8').split('\n').slice(-40).join('\n'));
    }
    throw new Error(`The native build failed: ${error.message}`);
  }
  return {
    helper: path.join(work, 'build', 'cats-stt-linux'),
    compiler: readFileSync(path.join(work, 'compiler.txt'), 'utf8').trim(),
    cmake: readFileSync(path.join(work, 'cmake.txt'), 'utf8').trim(),
    flags: readCacheFlags(path.join(work, 'build', 'CMakeCache.txt')),
  };
}

function readCacheFlags(cacheFile) {
  const cache = readFileSync(cacheFile, 'utf8');
  const keep = /^(?:GGML_[A-Z0-9_]+|WHISPER_[A-Z0-9_]+|BUILD_SHARED_LIBS|CMAKE_BUILD_TYPE|CMAKE_C_FLAGS(?:_RELEASE)?|CMAKE_CXX_FLAGS(?:_RELEASE)?|CATS_STT_[A-Z_]+):[A-Z]+=(.*)$/u;
  return Object.fromEntries(cache.split('\n').map(line => [line.split(':')[0], keep.exec(line)?.[1]])
    .filter(([key, value]) => value !== undefined && !key.endsWith('SOURCE_DIR')).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export const defaultWorkRoot = () => os.tmpdir();
