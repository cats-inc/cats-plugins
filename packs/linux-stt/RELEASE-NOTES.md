## linux-stt 0.1.0

The first `linux-stt` feature pack: offline dictation for Cats Desktop and Cats
Bot on Linux x64 and arm64. Desktop downloads it on demand from Settings and
verifies it against its own lock; audio never leaves the computer.

- Helper: `cats-stt-linux`, helper protocol 1 (Platform SPEC-145 FR-A4).
- Recognition: whisper.cpp `v1.9.5` (`d1be6fde11ac6e0407606b4e42fe72d34add8037`),
  statically linked, built in `ubuntu:22.04` pinned by digest; requires glibc
  2.35+ and the PulseAudio client library (`libpulse.so.0`).
- Model: multilingual `ggml-base`, 99 languages (no Cantonese `yue`).
- CPU baseline: x86-64-v3 on x64; ARMv8.2-A with dot product and FP16 on arm64.
  Below it the helper reports `engine_unavailable`.
- Measured on a Raspberry Pi 5 (4 threads): `ready` 0.12 s median, a
  30-second utterance transcribed in 4.1 s median.

Assets per architecture: the `.catspack` and its `.sha256`, the manifest copy,
the build receipt and the lock fragment Desktop and Bot copy into their locks.
Once: the source archive (the exact whisper.cpp tree, the helper source, the
recipe and the source lock) and the notices.

Upgrade boundary: new; nothing to migrate.
