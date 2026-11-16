// Shared by the native protocol check and the measurement script: extracts a
// verified pack and drives one helper session over protocol 1.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readCatspack } from './catspack.mjs';
import { checkManifest } from './manifest.mjs';

export async function extractPack(archivePath, directory) {
  const { entries, manifest } = await readCatspack(archivePath);
  checkManifest(manifest, entries);
  const handle = await open(archivePath, 'r');
  try {
    for (const entry of entries) {
      const target = path.join(directory, ...entry.path.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      const bytes = Buffer.alloc(entry.size);
      await handle.read(bytes, 0, entry.size, entry.dataOffset);
      writeFileSync(target, bytes, { flag: 'wx' });
      chmodSync(target, manifest.files.find(file => file.path === entry.path)?.executable ? 0o755 : 0o644);
    }
  } finally {
    await handle.close();
  }
  return manifest;
}

// A 16-bit PCM WAV of the given sample rate, mono.
export function wav(samples, rate = 16000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(sample, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// PCM samples of a 16 kHz mono 16-bit WAV.
export function wavSamples(bytes) {
  const data = bytes.indexOf('data', 12);
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || data < 0) throw new Error('Not a WAV');
  const length = bytes.readUInt32LE(data + 4);
  const samples = new Int16Array(length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(data + 8 + i * 2);
  return samples;
}

// Runs one session. `after` sends a command once `ready` arrives (after the
// given delay), or at once when `ready` never comes. Resolves with the parsed
// events, timings in milliseconds from spawn, stderr and the exit code.
export function runSession(command, args, { env = process.env, sessionId = 's1', after = null, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const events = [];
    const timings = {};
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Session timed out: ${args.join(' ')}`));
    }, timeoutMs);
    const send = type => {
      timings.command = performance.now() - started;
      child.stdin.write(`${JSON.stringify({ type, sessionId })}\n`);
    };
    child.stdout.on('data', chunk => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(event);
        timings[event.type] ??= performance.now() - started;
        if (event.type === 'ready' && after) setTimeout(() => send(after.type), after.delayMs ?? 0);
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ events, timings, stderr, code });
    });
    if (!after) child.stdin.end();
  });
}

export const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
