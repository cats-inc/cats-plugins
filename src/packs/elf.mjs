// Binary checks (cats-plugins SPEC-002 FR-D1), read through binutils' readelf.
import { execFileSync } from 'node:child_process';
import { requireThat } from '../files.mjs';

const MACHINES = { x64: 'Advanced Micro Devices X86-64', arm64: 'AArch64' };
export const ALLOWED_NEEDED = new Set([
  'libc.so.6', 'libm.so.6', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1',
  'ld-linux-x86-64.so.2', 'ld-linux-aarch64.so.1', 'libpulse.so.0',
]);
export const SOCKET_API = new Set([
  'socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4', 'send', 'sendto', 'sendmsg', 'sendmmsg',
  'recv', 'recvfrom', 'recvmsg', 'recvmmsg', 'shutdown', 'setsockopt', 'getsockopt', 'getpeername', 'getsockname',
  'getaddrinfo', 'getnameinfo', 'gethostbyname', 'gethostbyname2', 'gethostbyname_r', 'gethostbyaddr',
]);

// Parses `readelf -h -d -V --dyn-syms -W` output in the C locale.
export function parseReadelf(output) {
  const machine = /^\s*Machine:\s+(.+?)\s*$/mu.exec(output)?.[1] ?? '';
  const needed = [...output.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/gu)].map(match => match[1]);
  const glibc = [...new Set([...output.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/gu)].map(match => match[1]))];
  const undefinedSymbols = [];
  for (const line of output.split('\n')) {
    const match = /^\s*\d+:\s+[0-9a-f]+\s+\d+\s+\w+\s+(?:GLOBAL|WEAK)\s+\w+\s+UND\s+([^\s@]+)/u.exec(line);
    if (match) undefinedSymbols.push(match[1]);
  }
  return { machine, needed, glibc, undefinedSymbols };
}

const versionNumbers = version => version.split('.').map(Number);
function newerThan(version, limit) {
  const a = versionNumbers(version);
  const b = versionNumbers(limit);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export function checkBinary(info, arch, minGlibc) {
  requireThat(MACHINES[arch] && info.machine === MACHINES[arch], `ELF machine ${info.machine || 'unknown'} is not ${arch}`);
  const extra = info.needed.filter(library => !ALLOWED_NEEDED.has(library));
  requireThat(extra.length === 0, `NEEDED outside the allowlist: ${extra.join(', ')}`);
  const newer = info.glibc.filter(version => newerThan(version, minGlibc));
  requireThat(newer.length === 0, `Requires glibc newer than ${minGlibc}: ${newer.join(', ')}`);
  const sockets = info.undefinedSymbols.filter(symbol => SOCKET_API.has(symbol));
  requireThat(sockets.length === 0, `Uses the socket API: ${sockets.join(', ')}`);
  return info;
}

export function readBinary(file) {
  return parseReadelf(execFileSync('readelf', ['-h', '-d', '-V', '--dyn-syms', '-W', file], {
    encoding: 'utf8', maxBuffer: 64 * 2 ** 20, env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  }));
}
