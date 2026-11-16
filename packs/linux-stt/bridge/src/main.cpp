// cats-stt-linux: helper protocol 1 (Platform SPEC-145 FR-A4, FR-D6, FR-D7)
// built as cats-plugins SPEC-002 FR-B1-FR-B7 describes.
#include <unistd.h>

#include <algorithm>
#include <climits>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "audio.h"
#include "cats_stt_config.h"
#include "cpu_check.h"
#include "protocol.h"
#include "whisper.h"

namespace {

using cats::json_string;

std::mutex output_mutex;
std::string session_id;

void emit(const std::string &fields) {
  std::lock_guard<std::mutex> lock(output_mutex);
  const std::string line = "{" + fields + ",\"sessionId\":" + json_string(session_id) + "}\n";
  std::fwrite(line.data(), 1, line.size(), stdout);
  std::fflush(stdout);
}

void emit_error(const char *reason) { emit("\"type\":\"error\",\"reason\":" + json_string(reason)); }

// Exits without running destructors: the stdin thread may still be blocked
// in a read, and every PulseAudio object is already closed.
[[noreturn]] void finish(int code) {
  std::fflush(stdout);
  std::_Exit(code);
}

[[noreturn]] void error_and_end(const char *reason) {
  emit_error(reason);
  emit("\"type\":\"end\"");
  finish(0);
}

[[noreturn]] void usage(const char *problem) {
  std::fprintf(stderr, "cats-stt-linux: %s\nusage: cats-stt-linux --session-id <id> [--locale <subtag>]\n", problem);
  finish(2);
}

struct Language {
  std::string subtag;   // what the manifest lists and --locale names
  std::string whisper;  // whisper.cpp's code
};

// The model's languages: whisper.cpp ids below the model's count, with the
// recipe's mapping applied (SPEC-002 FR-B5).
std::vector<Language> model_languages() {
  std::vector<std::pair<std::string, std::string>> mapping;
  if (!cats::parse_language_map(CATS_STT_LANGUAGE_MAP, mapping)) finish(70);
  std::vector<Language> languages;
  for (int id = 0; id < CATS_STT_MODEL_LANGUAGES && id <= whisper_lang_max_id(); id++) {
    const char *code = whisper_lang_str(id);
    if (code == nullptr) break;
    Language language{code, code};
    for (const auto &pair : mapping) {
      if (pair.first == code) language.subtag = pair.second;
    }
    languages.push_back(language);
  }
  return languages;
}

std::string executable_directory() {
  char buffer[PATH_MAX];
  const ssize_t length = readlink("/proc/self/exe", buffer, sizeof buffer - 1);
  if (length <= 0) return "";
  std::string path(buffer, static_cast<size_t>(length));
  const size_t slash = path.rfind('/');
  return slash == std::string::npos ? "" : path.substr(0, slash);
}

int recognition_threads() {
  if (CATS_STT_THREADS > 0) return CATS_STT_THREADS;
  const unsigned cores = std::thread::hardware_concurrency();
  return static_cast<int>(std::clamp(cores, 1u, 4u));
}

void quiet_log(enum ggml_log_level, const char *, void *) {}

// Reads stdin commands. It only sets flags and wakes the main thread.
void read_commands(cats::Session *session) {
  std::string line;
  while (std::getline(std::cin, line)) {
    std::string type;
    std::string id;
    if (!cats::parse_command(line, type, id) || id != session_id) continue;
    std::lock_guard<std::mutex> lock(session->mutex);
    if (type == "stop") session->stop = true;
    else if (type == "cancel") session->cancel = true;
    else continue;
    session->changed.notify_all();
  }
  std::lock_guard<std::mutex> lock(session->mutex);
  session->input_closed = true;
  session->changed.notify_all();
}

std::string transcribe(whisper_context *context, const std::vector<int16_t> &samples, const Language *language,
                       bool &failed) {
  failed = false;
  std::vector<float> pcm(samples.size());
  for (size_t i = 0; i < samples.size(); i++) pcm[i] = static_cast<float>(samples[i]) / 32768.0f;
  const int threads = recognition_threads();
  std::string code;
  if (language != nullptr) {
    code = language->whisper;
  } else {
    // Detection chooses only among the model's languages (SPEC-002 FR-B5).
    if (whisper_pcm_to_mel(context, pcm.data(), static_cast<int>(pcm.size()), threads) != 0) {
      failed = true;
      return "";
    }
    std::vector<float> probabilities(static_cast<size_t>(whisper_lang_max_id()) + 1, 0.0f);
    if (whisper_lang_auto_detect(context, 0, threads, probabilities.data()) < 0) {
      failed = true;
      return "";
    }
    int best = 0;
    for (int id = 1; id < CATS_STT_MODEL_LANGUAGES && id < static_cast<int>(probabilities.size()); id++) {
      if (probabilities[id] > probabilities[best]) best = id;
    }
    code = whisper_lang_str(best);
  }
  whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  params.n_threads = threads;
  params.language = code.c_str();
  params.detect_language = false;
  params.translate = false;
  params.no_context = true;
  params.no_timestamps = true;
  params.print_progress = false;
  params.print_realtime = false;
  params.print_special = false;
  params.print_timestamps = false;
  params.suppress_blank = true;
  if (whisper_full(context, params, pcm.data(), static_cast<int>(pcm.size())) != 0) {
    failed = true;
    return "";
  }
  std::string text;
  const int segments = whisper_full_n_segments(context);
  for (int i = 0; i < segments; i++) text += whisper_full_get_segment_text(context, i);
  return cats::trim(text);
}

}  // namespace

int main(int argc, char **argv) {
  std::signal(SIGPIPE, SIG_IGN);

  // 1. Arguments (SPEC-002 FR-B1).
  std::string locale;
  std::string input;
  bool has_session = false;
  bool has_locale = false;
  bool has_input = false;
  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    if (i + 1 >= argc) usage(("missing value for " + arg).c_str());
    const std::string value = argv[++i];
    if (arg == "--session-id" && !has_session && !value.empty()) {
      session_id = value;
      has_session = true;
    } else if (arg == "--locale" && !has_locale && !value.empty()) {
      locale = value;
      has_locale = true;
    } else if (arg == "--input" && !has_input && !value.empty()) {
      const char *enabled = std::getenv("CATS_STT_ENABLE_FIXTURE_INPUT");
      if (enabled == nullptr || std::strcmp(enabled, "1") != 0) usage("--input needs CATS_STT_ENABLE_FIXTURE_INPUT=1");
      input = value;
      has_input = true;
    } else {
      usage(("unexpected argument " + arg).c_str());
    }
  }
  if (!has_session) usage("--session-id is required");

  whisper_log_set(quiet_log, nullptr);
  const std::vector<Language> languages = model_languages();
  const Language *language = nullptr;
  if (has_locale) {
    for (const auto &candidate : languages) {
      if (candidate.subtag == locale) language = &candidate;
    }
    if (language == nullptr) error_and_end("language_not_supported");
  }

  // 2. CPU baseline, before any whisper.cpp computation.
  const cats_cpu_features features = cats_cpu_detect();
  if (!cats_cpu_meets_baseline(&features)) {
    std::fprintf(stderr, "cats-stt-linux: this CPU is below the pack's baseline\n");
    error_and_end("engine_unavailable");
  }

  // 3. Audio source.
  cats::Session session;
  cats::PulseInput microphone(session);
  std::vector<int16_t> fixture;
  if (has_input) {
    const cats::WavStatus status = cats::read_wav(input, fixture);
    if (status == cats::WavStatus::missing) error_and_end("mic_unavailable");
    if (status == cats::WavStatus::unsupported) error_and_end("engine_unavailable");
  } else {
    std::string problem;
    if (!microphone.open(problem)) {
      std::fprintf(stderr, "cats-stt-linux: %s\n", problem.c_str());
      microphone.close();
      error_and_end("mic_unavailable");
    }
  }

  // 4. Model, beside the executable.
  const std::string model = executable_directory() + "/model.bin";
  whisper_context_params context_params = whisper_context_default_params();
  context_params.use_gpu = false;
  whisper_context *context = whisper_init_from_file_with_params(model.c_str(), context_params);
  if (context == nullptr || !whisper_is_multilingual(context) ||
      whisper_model_n_vocab(context) - 51765 - 1 != CATS_STT_MODEL_LANGUAGES) {
    std::fprintf(stderr, "cats-stt-linux: cannot load the model or it is not the packed one\n");
    microphone.close();
    error_and_end("engine_unavailable");
  }

  // 5. Ready.
  std::thread(read_commands, &session).detach();
  {
    std::lock_guard<std::mutex> lock(session.mutex);
    session.accepting = true;
  }
  emit("\"type\":\"ready\",\"mode\":\"on-device\",\"locale\":" + json_string(has_locale ? locale : "auto"));
  if (has_input) session.append(fixture.data(), fixture.size());

  std::vector<int16_t> samples;
  bool stop = false;
  bool overrun = false;
  {
    std::unique_lock<std::mutex> lock(session.mutex);
    session.changed.wait(lock, [&] { return session.stop || session.cancel || session.overrun || session.input_closed; });
    session.accepting = false;
    overrun = session.overrun;
    stop = session.stop && !session.cancel && !overrun;
    if (stop) samples.swap(session.samples);
  }
  // Release the microphone before anything else.
  microphone.close();

  if (overrun) error_and_end("aborted");
  if (!stop) {
    // cancel, or stdin closed by the host.
    bool cancelled;
    {
      std::lock_guard<std::mutex> lock(session.mutex);
      cancelled = session.cancel;
    }
    if (cancelled) emit_error("cancelled");
    emit("\"type\":\"end\"");
    finish(0);
  }
  if (!samples.empty()) {
    bool failed = false;
    const std::string text = transcribe(context, samples, language, failed);
    if (failed) error_and_end("engine_unavailable");
    if (!text.empty()) emit("\"type\":\"final\",\"text\":" + json_string(text));
  }
  emit("\"type\":\"end\"");
  finish(0);
}
