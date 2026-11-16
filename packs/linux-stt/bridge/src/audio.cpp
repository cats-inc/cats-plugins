#include "audio.h"

#include <pulse/pulseaudio.h>

#include <algorithm>
#include <cstring>
#include <fstream>

namespace cats {

void Session::append(const int16_t *data, size_t count) {
  std::lock_guard<std::mutex> lock(mutex);
  if (!accepting || overrun) return;
  if (samples.size() + count > kMaxSamples) {
    overrun = true;
    accepting = false;
    changed.notify_all();
    return;
  }
  samples.insert(samples.end(), data, data + count);
}

namespace {

void signal_loop(pa_threaded_mainloop *loop) { pa_threaded_mainloop_signal(loop, 0); }

void on_context_state(pa_context *, void *loop) { signal_loop(static_cast<pa_threaded_mainloop *>(loop)); }

void on_stream_state(pa_stream *, void *loop) { signal_loop(static_cast<pa_threaded_mainloop *>(loop)); }

// Runs on PulseAudio's mainloop thread; it only copies samples.
void on_read(pa_stream *stream, size_t, void *user) {
  auto *session = static_cast<Session *>(user);
  while (pa_stream_readable_size(stream) > 0) {
    const void *data = nullptr;
    size_t length = 0;
    if (pa_stream_peek(stream, &data, &length) < 0 || length == 0) return;
    if (data != nullptr) {
      session->append(static_cast<const int16_t *>(data), length / sizeof(int16_t));
    }
    pa_stream_drop(stream);
  }
}

}  // namespace

PulseInput::~PulseInput() { close(); }

bool PulseInput::open(std::string &error) {
  loop_ = pa_threaded_mainloop_new();
  if (loop_ == nullptr) {
    error = "cannot create the PulseAudio mainloop";
    return false;
  }
  pa_proplist *props = pa_proplist_new();
  pa_proplist_sets(props, PA_PROP_APPLICATION_NAME, "Cats dictation");
  pa_proplist_sets(props, PA_PROP_MEDIA_ROLE, "production");
  context_ = pa_context_new_with_proplist(pa_threaded_mainloop_get_api(loop_), "Cats dictation", props);
  pa_proplist_free(props);
  if (context_ == nullptr) {
    error = "cannot create a PulseAudio context";
    return false;
  }
  pa_context_set_state_callback(context_, on_context_state, loop_);
  if (pa_context_connect(context_, nullptr, PA_CONTEXT_NOAUTOSPAWN, nullptr) < 0) {
    error = std::string("cannot connect to the sound server: ") + pa_strerror(pa_context_errno(context_));
    return false;
  }
  if (pa_threaded_mainloop_start(loop_) < 0) {
    error = "cannot start the PulseAudio mainloop";
    return false;
  }
  pa_threaded_mainloop_lock(loop_);
  for (;;) {
    const pa_context_state_t state = pa_context_get_state(context_);
    if (state == PA_CONTEXT_READY) break;
    if (!PA_CONTEXT_IS_GOOD(state)) {
      error = std::string("sound server connection failed: ") + pa_strerror(pa_context_errno(context_));
      pa_threaded_mainloop_unlock(loop_);
      return false;
    }
    pa_threaded_mainloop_wait(loop_);
  }
  const pa_sample_spec spec = {PA_SAMPLE_S16LE, kSampleRate, 1};
  stream_ = pa_stream_new(context_, "Dictation", &spec, nullptr);
  if (stream_ == nullptr) {
    error = std::string("cannot create a recording stream: ") + pa_strerror(pa_context_errno(context_));
    pa_threaded_mainloop_unlock(loop_);
    return false;
  }
  pa_stream_set_state_callback(stream_, on_stream_state, loop_);
  pa_stream_set_read_callback(stream_, on_read, &session_);
  pa_buffer_attr attr;
  std::memset(&attr, 0xff, sizeof attr);
  attr.fragsize = kSampleRate * sizeof(int16_t) / 10;  // 100 ms
  if (pa_stream_connect_record(stream_, nullptr, &attr, PA_STREAM_ADJUST_LATENCY) < 0) {
    error = std::string("cannot open the default source: ") + pa_strerror(pa_context_errno(context_));
    pa_threaded_mainloop_unlock(loop_);
    return false;
  }
  for (;;) {
    const pa_stream_state_t state = pa_stream_get_state(stream_);
    if (state == PA_STREAM_READY) break;
    if (!PA_STREAM_IS_GOOD(state)) {
      error = std::string("the default source failed: ") + pa_strerror(pa_context_errno(context_));
      pa_threaded_mainloop_unlock(loop_);
      return false;
    }
    pa_threaded_mainloop_wait(loop_);
  }
  pa_threaded_mainloop_unlock(loop_);
  return true;
}

void PulseInput::close() {
  if (loop_ == nullptr) return;
  pa_threaded_mainloop_lock(loop_);
  if (stream_ != nullptr) {
    pa_stream_set_read_callback(stream_, nullptr, nullptr);
    pa_stream_set_state_callback(stream_, nullptr, nullptr);
    pa_stream_disconnect(stream_);
    pa_stream_unref(stream_);
    stream_ = nullptr;
  }
  if (context_ != nullptr) {
    pa_context_set_state_callback(context_, nullptr, nullptr);
    pa_context_disconnect(context_);
    pa_context_unref(context_);
    context_ = nullptr;
  }
  pa_threaded_mainloop_unlock(loop_);
  pa_threaded_mainloop_stop(loop_);
  pa_threaded_mainloop_free(loop_);
  loop_ = nullptr;
}

namespace {

uint32_t le32(const char *p) {
  const auto *u = reinterpret_cast<const unsigned char *>(p);
  return u[0] | (u[1] << 8) | (u[2] << 16) | (static_cast<uint32_t>(u[3]) << 24);
}

uint16_t le16(const char *p) {
  const auto *u = reinterpret_cast<const unsigned char *>(p);
  return static_cast<uint16_t>(u[0] | (u[1] << 8));
}

}  // namespace

WavStatus read_wav(const std::string &path, std::vector<int16_t> &samples) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return WavStatus::missing;
  char header[12];
  if (!file.read(header, 12) || std::memcmp(header, "RIFF", 4) != 0 || std::memcmp(header + 8, "WAVE", 4) != 0) {
    return WavStatus::unsupported;
  }
  bool format_ok = false;
  for (;;) {
    char chunk[8];
    if (!file.read(chunk, 8)) return WavStatus::unsupported;
    const uint32_t size = le32(chunk + 4);
    if (std::memcmp(chunk, "fmt ", 4) == 0) {
      if (size < 16 || size > 64) return WavStatus::unsupported;
      char fmt[64];
      if (!file.read(fmt, size)) return WavStatus::unsupported;
      format_ok = le16(fmt) == 1 && le16(fmt + 2) == 1 && le32(fmt + 4) == kSampleRate && le16(fmt + 14) == 16;
      if (!format_ok) return WavStatus::unsupported;
      if (size % 2) file.ignore(1);
    } else if (std::memcmp(chunk, "data", 4) == 0) {
      if (!format_ok || size % 2) return WavStatus::unsupported;
      // Read at most one sample past the overrun limit; more cannot matter.
      const size_t count = std::min<size_t>(size / 2, kMaxSamples + 1);
      samples.resize(count);
      if (!file.read(reinterpret_cast<char *>(samples.data()), static_cast<std::streamsize>(count * 2))) {
        return WavStatus::unsupported;
      }
      return WavStatus::ok;
    } else {
      if (size > (1u << 20)) return WavStatus::unsupported;
      file.ignore(size + (size % 2));
    }
  }
}

}  // namespace cats
