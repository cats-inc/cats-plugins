#pragma once

#include <string>
#include <utility>
#include <vector>

namespace cats {

// A JSON string literal. Invalid UTF-8 becomes U+FFFD, so every event line is
// valid JSON even when recognition splits a multi-byte character.
std::string json_string(const std::string &text);

// Reads a stdin command, `{ "type": ..., "sessionId": ... }`. Other string,
// number, boolean or null members are ignored; anything else is rejected.
bool parse_command(const std::string &line, std::string &type, std::string &session_id);

// "jw=jv,xx=yy" into pairs; empty input gives none. Malformed input gives
// false.
bool parse_language_map(const std::string &text, std::vector<std::pair<std::string, std::string>> &pairs);

std::string trim(const std::string &text);

}  // namespace cats
