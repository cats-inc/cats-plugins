#include "protocol.h"

#include <cctype>
#include <cstdint>
#include <cstdio>

namespace cats {

namespace {

// Length of the valid UTF-8 sequence at text[i], or 0.
size_t utf8_sequence(const std::string &text, size_t i) {
  const auto byte = [&](size_t k) { return static_cast<unsigned char>(text[k]); };
  const unsigned char c = byte(i);
  size_t length;
  uint32_t code;
  if (c < 0x80) return 1;
  if (c >= 0xc2 && c <= 0xdf) { length = 2; code = c & 0x1f; }
  else if (c >= 0xe0 && c <= 0xef) { length = 3; code = c & 0x0f; }
  else if (c >= 0xf0 && c <= 0xf4) { length = 4; code = c & 0x07; }
  else return 0;
  if (i + length > text.size()) return 0;
  for (size_t k = 1; k < length; k++) {
    if ((byte(i + k) & 0xc0) != 0x80) return 0;
    code = (code << 6) | (byte(i + k) & 0x3f);
  }
  if ((length == 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) ||
      (length == 4 && (code < 0x10000 || code > 0x10ffff))) {
    return 0;
  }
  return length;
}

void skip_space(const std::string &s, size_t &i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++;
}

int hex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

void append_utf8(std::string &out, uint32_t code) {
  if (code < 0x80) {
    out += static_cast<char>(code);
  } else if (code < 0x800) {
    out += static_cast<char>(0xc0 | (code >> 6));
    out += static_cast<char>(0x80 | (code & 0x3f));
  } else {
    out += static_cast<char>(0xe0 | (code >> 12));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3f));
    out += static_cast<char>(0x80 | (code & 0x3f));
  }
}

bool parse_string(const std::string &s, size_t &i, std::string &out) {
  if (i >= s.size() || s[i] != '"') return false;
  i++;
  out.clear();
  while (i < s.size()) {
    const char c = s[i++];
    if (c == '"') return true;
    if (static_cast<unsigned char>(c) < 0x20) return false;
    if (c != '\\') {
      out += c;
      continue;
    }
    if (i >= s.size()) return false;
    const char e = s[i++];
    switch (e) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'u': {
        if (i + 4 > s.size()) return false;
        uint32_t code = 0;
        for (int k = 0; k < 4; k++) {
          const int h = hex(s[i + k]);
          if (h < 0) return false;
          code = (code << 4) | static_cast<uint32_t>(h);
        }
        i += 4;
        // Command values are ASCII; a surrogate is kept as U+FFFD.
        append_utf8(out, code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
        break;
      }
      default: return false;
    }
  }
  return false;
}

bool skip_scalar(const std::string &s, size_t &i) {
  const size_t start = i;
  while (i < s.size() && (std::isalnum(static_cast<unsigned char>(s[i])) || s[i] == '-' || s[i] == '+' || s[i] == '.')) i++;
  const std::string word = s.substr(start, i - start);
  if (word == "true" || word == "false" || word == "null") return true;
  if (word.empty()) return false;
  for (char c : word) {
    if (!(std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')) return false;
  }
  return true;
}

}  // namespace

std::string json_string(const std::string &text) {
  std::string out = "\"";
  for (size_t i = 0; i < text.size();) {
    const size_t length = utf8_sequence(text, i);
    if (length == 0) {
      out += "\\ufffd";
      i++;
      continue;
    }
    const unsigned char c = static_cast<unsigned char>(text[i]);
    if (length > 1) {
      out.append(text, i, length);
    } else if (c == '"') {
      out += "\\\"";
    } else if (c == '\\') {
      out += "\\\\";
    } else if (c == '\n') {
      out += "\\n";
    } else if (c == '\r') {
      out += "\\r";
    } else if (c == '\t') {
      out += "\\t";
    } else if (c < 0x20 || c == 0x7f) {
      char buffer[8];
      std::snprintf(buffer, sizeof buffer, "\\u%04x", c);
      out += buffer;
    } else {
      out += static_cast<char>(c);
    }
    i += length;
  }
  return out + "\"";
}

bool parse_command(const std::string &line, std::string &type, std::string &session_id) {
  size_t i = 0;
  bool has_type = false;
  bool has_session = false;
  skip_space(line, i);
  if (i >= line.size() || line[i++] != '{') return false;
  skip_space(line, i);
  if (i < line.size() && line[i] == '}') return false;
  for (;;) {
    std::string key;
    std::string value;
    skip_space(line, i);
    if (!parse_string(line, i, key)) return false;
    skip_space(line, i);
    if (i >= line.size() || line[i++] != ':') return false;
    skip_space(line, i);
    if (i < line.size() && line[i] == '"') {
      if (!parse_string(line, i, value)) return false;
      if (key == "type") { type = value; has_type = true; }
      if (key == "sessionId") { session_id = value; has_session = true; }
    } else if (!skip_scalar(line, i)) {
      return false;
    }
    skip_space(line, i);
    if (i >= line.size()) return false;
    if (line[i] == ',') { i++; continue; }
    if (line[i] != '}') return false;
    i++;
    break;
  }
  skip_space(line, i);
  return i == line.size() && has_type && has_session;
}

bool parse_language_map(const std::string &text, std::vector<std::pair<std::string, std::string>> &pairs) {
  pairs.clear();
  if (text.empty()) return true;
  size_t start = 0;
  while (start <= text.size()) {
    const size_t comma = text.find(',', start);
    const std::string item = text.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
    const size_t equals = item.find('=');
    if (equals == std::string::npos || equals == 0 || equals + 1 == item.size()) return false;
    pairs.emplace_back(item.substr(0, equals), item.substr(equals + 1));
    if (comma == std::string::npos) break;
    start = comma + 1;
  }
  return true;
}

std::string trim(const std::string &text) {
  const char *space = " \t\r\n";
  const size_t first = text.find_first_not_of(space);
  if (first == std::string::npos) return "";
  return text.substr(first, text.find_last_not_of(space) - first + 1);
}

}  // namespace cats
