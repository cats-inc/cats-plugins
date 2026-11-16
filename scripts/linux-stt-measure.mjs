#!/usr/bin/env node
// linux-stt-measure.mjs - candidate measurement on the reference board
// (cats-plugins SPEC-002 FR-E2, Platform ADR-154 D4).
//
// Usage: node scripts/linux-stt-measure.mjs PACK SOURCES_ARCHIVE [FIXTURE.wav ...]
//
// Runs the pack's helper natively five times per fixture and prints, for each,
// the median and the worst of the `ready` time (process start, argument
// checks and model load, no microphone) and of the transcription time (from
// `stop` to `end`). Without fixtures it uses a 30-second English fixture built
// from the locked tree's samples/jfk.wav. Linux only; not part of `npm test`.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPack, median, runSession, wav, wavSamples } from '../src/packs/harness.mjs';
import { loadPack, readBridge, verifySourceArchive } from '../src/packs/linux-stt.mjs';

const RUNS = 5;
const root = fileURLToPath(new URL('../', import.meta.url));
const [packPath, sourcesPath, ...fixtures] = process.argv.slice(2);
if (!packPath || !sourcesPath) {
  console.error('Usage: node scripts/linux-stt-measure.mjs PACK SOURCES_ARCHIVE [FIXTURE.wav ...]');
  process.exit(2);
}

const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cats-linux-stt-measure-')));
try {
  const manifest = await extractPack(path.resolve(packPath), path.join(work, 'pack'));
  if (fixtures.length === 0) {
    const { whisper } = verifySourceArchive(readFileSync(path.resolve(sourcesPath)), loadPack(root), readBridge(root));
    const jfk = wavSamples(whisper.find(entry => entry.path === 'samples/jfk.wav').bytes);
    const thirty = new Int16Array(30 * 16000);
    for (let i = 0; i < thirty.length; i++) thirty[i] = jfk[i % jfk.length];
    const file = path.join(work, 'en-30s.wav');
    writeFileSync(file, wav(thirty));
    fixtures.push(file);
  }
  const helper = path.join(work, 'pack', 'cats-stt-linux');
  const env = { ...process.env, CATS_STT_ENABLE_FIXTURE_INPUT: '1' };
  const results = [];
  for (const fixture of fixtures) {
    const ready = [];
    const transcription = [];
    let text = '';
    for (let run = 0; run < RUNS; run++) {
      const result = await runSession(helper, ['--session-id', 's1', '--locale', 'en', '--input', path.resolve(fixture)],
        { env, after: { type: 'stop', delayMs: 200 } });
      if (!result.timings.ready || !result.timings.end) throw new Error(`Run failed: ${JSON.stringify(result.events)} ${result.stderr}`);
      ready.push(result.timings.ready);
      transcription.push(result.timings.end - result.timings.command);
      text = result.events.find(event => event.type === 'final')?.text ?? '';
    }
    results.push({
      fixture: path.basename(fixture), model: manifest.model.name, arch: manifest.arch, runs: RUNS,
      readyMs: { median: Math.round(median(ready)), worst: Math.round(Math.max(...ready)) },
      transcriptionMs: { median: Math.round(median(transcription)), worst: Math.round(Math.max(...transcription)) },
      passes: median(ready) <= 2000 && median(transcription) <= 30_000,
      textSample: text.slice(0, 80),
    });
  }
  console.log(JSON.stringify({ device: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, results }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
