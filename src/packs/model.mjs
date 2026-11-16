import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';

// Downloads one locked model over HTTPS and keeps it only when its size and
// SHA-256 match. The transport is injectable so tests need no network.
export async function downloadModel(model, destination, { fetch = globalThis.fetch } = {}) {
  const partial = `${destination}.partial`;
  const file = await open(partial, 'wx');
  let complete = false;
  try {
    const response = await fetch(model.url, { redirect: 'follow' });
    if (response.status !== 200 || !response.body) throw new Error(`Model download failed with HTTP ${response.status}: ${model.file}`);
    if (new URL(response.url || model.url).protocol !== 'https:') throw new Error(`Model download left HTTPS: ${model.file}`);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > model.size) throw new Error(`Model ${model.file} is larger than the locked ${model.size} bytes`);
      hash.update(chunk);
      // FileHandle.write may write part of a chunk; finish it or fail.
      for (let offset = 0; offset < chunk.length;) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
        if (bytesWritten <= 0) throw new Error(`Cannot write model ${model.file}`);
        offset += bytesWritten;
      }
    }
    if (size !== model.size) throw new Error(`Model ${model.file} has ${size} bytes; the lock expects ${model.size}`);
    const digest = hash.digest('hex');
    if (digest !== model.sha256) throw new Error(`Model ${model.file} SHA-256 ${digest} does not match the lock`);
    await file.sync();
    const written = (await file.stat()).size;
    if (written !== model.size) throw new Error(`Model ${model.file} wrote ${written} bytes; the lock expects ${model.size}`);
    complete = true;
  } finally {
    await file.close();
    if (!complete) await rm(partial, { force: true });
  }
  await rename(partial, destination);
  return destination;
}
