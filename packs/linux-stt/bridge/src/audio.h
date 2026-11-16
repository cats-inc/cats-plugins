#pragma once

#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

struct pa_threaded_mainloop;
struct pa_context;
struct pa_stream;

namespace cats {

constexpr int kSampleRate = 16000;
// SPEC-145 FR-D6: past 31 seconds of audio without `stop`, the session aborts.
constexpr size_t kMaxSamples = 31 * kSampleRate;

// The session state shared by the audio callback, the stdin thread and the
// main thread. The stdin thread only sets flags; it never touches PulseAudio.
struct Session {
  std::mutex mutex;
  std::condition_variable changed;
  std::vector<int16_t> samples;
  bool accepting = false;
  bool stop = false;
  bool cancel = false;
  bool overrun = false;
  bool input_closed = false;

  // Appends while accepting; past kMaxSamples it marks an overrun instead.
  void append(const int16_t *data, size_t count);
};

// The default PulseAudio source at 16 kHz mono S16LE, under
// pa_threaded_mainloop (SPEC-002 FR-B3). The main thread creates, owns and
// closes the context and stream; callbacks only append to the session.
class PulseInput {
 public:
  explicit PulseInput(Session &session) : session_(session) {}
  ~PulseInput();
  bool open(std::string &error);
  // Disconnects the stream first, which releases the microphone.
  void close();

 private:
  Session &session_;
  ::pa_threaded_mainloop *loop_ = nullptr;
  ::pa_context *context_ = nullptr;
  ::pa_stream *stream_ = nullptr;
};

enum class WavStatus { ok, missing, unsupported };

// A 16 kHz mono 16-bit PCM WAV (SPEC-002 FR-B4).
WavStatus read_wav(const std::string &path, std::vector<int16_t> &samples);

}  // namespace cats
