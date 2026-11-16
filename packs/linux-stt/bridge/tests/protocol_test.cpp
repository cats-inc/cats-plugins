// JSON output and stdin command parsing of helper protocol 1.
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "protocol.h"

static int failures;

static void expect(bool condition, const std::string &what) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", what.c_str());
    failures++;
  }
}

int main() {
  using namespace cats;
  expect(json_string("a\"b\\c\n") == "\"a\\\"b\\\\c\\n\"", "escapes");
  expect(json_string("\x01") == "\"\\u0001\"", "control characters");
  expect(json_string("中文") == "\"中文\"", "UTF-8 passes through");
  expect(json_string("\xe4\xb8") == "\"\\ufffd\\ufffd\"", "a cut UTF-8 sequence becomes U+FFFD");
  expect(json_string("\xed\xa0\x80") == "\"\\ufffd\\ufffd\\ufffd\"", "an encoded surrogate is invalid");

  std::string type, id;
  expect(parse_command("{\"type\":\"stop\",\"sessionId\":\"s1\"}", type, id) && type == "stop" && id == "s1", "stop");
  expect(parse_command(" { \"sessionId\" : \"s\\u0031\" , \"type\" : \"cancel\", \"n\": 1, \"b\": true } ", type, id) &&
             type == "cancel" && id == "s1", "spacing, escapes and other members");
  for (const char *bad : {"", "{}", "{\"type\":\"stop\"}", "{\"type\":\"stop\",\"sessionId\":\"s\"", "[1]",
                          "{\"type\":\"stop\",\"sessionId\":\"s\"} x", "{\"type\":\"stop\",\"sessionId\":{}}"}) {
    expect(!parse_command(bad, type, id), std::string("rejects ") + bad);
  }

  std::vector<std::pair<std::string, std::string>> pairs;
  expect(parse_language_map("jw=jv", pairs) && pairs.size() == 1 && pairs[0].second == "jv", "one pair");
  expect(parse_language_map("", pairs) && pairs.empty(), "no pairs");
  expect(!parse_language_map("jw", pairs) && !parse_language_map("=jv", pairs), "malformed pairs");
  expect(trim("  hi \n") == "hi" && trim(" \t") == "", "trim");
  if (failures == 0) std::printf("protocol_test: ok\n");
  return failures == 0 ? 0 : 1;
}
