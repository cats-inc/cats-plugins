#!/usr/bin/env node
// linux-stt-protocol.mjs - helper protocol tests for a built linux-stt pack
// (cats-plugins SPEC-002 FR-D2), run in a container with networking disabled.
//
// Usage: node scripts/linux-stt-protocol.mjs PACK SOURCES_ARCHIVE IMAGE
//   PACK             the .catspack to test
//   SOURCES_ARCHIVE  the retained source archive (for samples/jfk.wav)
//   IMAGE            a container image with the PulseAudio client library,
//                    such as the build environment image
//
// Linux only. Not part of `npm test`; the Linux pack jobs run it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPack, runSession, wav, wavSamples } from '../src/packs/harness.mjs';
import { loadPack, readBridge, verifySourceArchive } from '../src/packs/linux-stt.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [packPath, sourcesPath, image] = process.argv.slice(2);
if (!packPath || !sourcesPath || !image || process.argv.length !== 5) {
  console.error('Usage: node scripts/linux-stt-protocol.mjs PACK SOURCES_ARCHIVE IMAGE');
  process.exit(2);
}

const failures = [];
const skipped = [];
const check = (condition, what) => {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${what}`);
  if (!condition) failures.push(what);
};
const types = result => result.events.map(event => event.type === 'error' ? `error:${event.reason}` : event.type).join(',');

const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cats-linux-stt-protocol-')));
const container = `cats-linux-stt-protocol-${process.pid}`;
try {
  const manifest = await extractPack(path.resolve(packPath), path.join(work, 'pack'));
  const pack = loadPack(root);
  const { whisper } = verifySourceArchive(readFileSync(path.resolve(sourcesPath)), pack, readBridge(root));
  const fixtures = path.join(work, 'fixtures');
  mkdirSync(fixtures);
  const jfk = whisper.find(entry => entry.path === 'samples/jfk.wav').bytes;
  writeFileSync(path.join(fixtures, 'en.wav'), jfk);
  writeFileSync(path.join(fixtures, 'long.wav'), wav(new Int16Array(32 * 16000)));
  writeFileSync(path.join(fixtures, 'rate-8k.wav'), wav(new Int16Array(8000), 8000));
  const mandarin = path.join(root, 'packs/linux-stt/fixtures/zh-short.wav');
  if (existsSync(mandarin)) writeFileSync(path.join(fixtures, 'zh.wav'), readFileSync(mandarin));
  check(wavSamples(jfk).length > 16000, 'the English fixture is 16 kHz mono speech');

  execFileSync('docker', ['run', '--detach', '--rm', '--name', container, '--network', 'none',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '-v', `${path.join(work, 'pack')}:/pack:ro`, '-v', `${fixtures}:/fixtures:ro`, image, 'sleep', 'infinity'], { stdio: 'ignore' });
  const helper = (args, options = {}) => runSession('docker', ['exec', '-i', '-e', 'CATS_STT_ENABLE_FIXTURE_INPUT=1',
    container, '/pack/cats-stt-linux', '--session-id', 's1', ...args], options);

  const english = await helper(['--locale', 'en', '--input', '/fixtures/en.wav'], { after: { type: 'stop', delayMs: 300 } });
  const final = english.events.find(event => event.type === 'final');
  check(types(english) === 'ready,final,end' && /country/iu.test(final?.text ?? ''), `English fixture with stop: ${types(english)} "${final?.text ?? ''}"`);
  if (existsSync(path.join(fixtures, 'zh.wav'))) {
    const zh = await helper(['--locale', 'zh', '--input', '/fixtures/zh.wav'], { after: { type: 'stop', delayMs: 300 } });
    check(types(zh) === 'ready,final,end', `Mandarin fixture with stop: ${types(zh)}`);
  } else {
    skipped.push('Mandarin fixture: packs/linux-stt/fixtures/zh-short.wav is an owner item (SPEC-002 D3)');
  }
  const automatic = await helper(['--input', '/fixtures/en.wav'], { after: { type: 'stop', delayMs: 300 } });
  check(automatic.events[0]?.type === 'ready' && automatic.events[0].locale === 'auto' && types(automatic) === 'ready,final,end',
    `without --locale, ready.locale is "auto": ${types(automatic)}`);
  const cancel = await helper(['--input', '/fixtures/en.wav'], { after: { type: 'cancel' } });
  check(types(cancel) === 'ready,error:cancelled,end', `cancel: ${types(cancel)}`);
  const overrun = await helper(['--input', '/fixtures/long.wav'], { after: { type: 'stop', delayMs: 2000 } });
  check(types(overrun) === 'ready,error:aborted,end', `a 32-second fixture overruns: ${types(overrun)}`);
  const microphone = await helper([]);
  check(types(microphone) === 'error:mic_unavailable,end', `no sound server: ${types(microphone)}`);
  const format = await helper(['--input', '/fixtures/rate-8k.wav']);
  check(types(format) === 'error:engine_unavailable,end', `an 8 kHz WAV: ${types(format)}`);
  const unknown = await helper(['--unknown', 'x']);
  check(unknown.code !== 0 && /usage/u.test(unknown.stderr) && unknown.events.length === 0, 'an unknown argument exits non-zero with usage');
  for (const subtag of ['yue', 'jw', 'xx']) {
    const result = await helper(['--locale', subtag, '--input', '/fixtures/en.wav']);
    check(types(result) === 'error:language_not_supported,end', `unlisted --locale ${subtag}: ${types(result)}`);
  }
  const rejected = [];
  for (const subtag of manifest.languages) {
    const result = await helper(['--locale', subtag, '--input', '/fixtures/en.wav'], { after: { type: 'cancel' } });
    if (result.events[0]?.type !== 'ready' || result.events[0].locale !== subtag) rejected.push(subtag);
  }
  check(rejected.length === 0, `all ${manifest.languages.length} listed subtags are accepted${rejected.length ? `; rejected: ${rejected.join(' ')}` : ''}`);
} finally {
  try {
    execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
  } catch {
    // not started
  }
  rmSync(work, { recursive: true, force: true });
}
for (const item of skipped) console.log(`skip - ${item}`);
console.log(failures.length ? `${failures.length} protocol check(s) failed` : 'protocol checks passed');
process.exitCode = failures.length ? 1 : 0;
