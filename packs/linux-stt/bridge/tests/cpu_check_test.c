/* SPEC-002 FR-B2: the CPU decision, with injected feature sets. */
#include <stdio.h>
#include <string.h>

#include "cpu_check.h"

static int failures;

static void expect(int condition, const char *what) {
  if (!condition) {
    fprintf(stderr, "FAIL: %s\n", what);
    failures++;
  }
}

int main(void) {
  struct cats_cpu_features full;
  memset(&full, 0, sizeof full);
#if defined(__x86_64__)
  full.sse42 = full.popcnt = full.avx = full.avx2 = full.fma = full.f16c = true;
  full.bmi1 = full.bmi2 = full.lzcnt = full.movbe = full.os_ymm = true;
  bool *each[] = {&full.sse42, &full.popcnt, &full.avx, &full.avx2, &full.fma, &full.f16c,
                  &full.bmi1, &full.bmi2, &full.lzcnt, &full.movbe, &full.os_ymm};
#else
  full.asimd = full.dotprod = full.fp16 = full.asimd_fp16 = true;
  bool *each[] = {&full.asimd, &full.dotprod, &full.fp16, &full.asimd_fp16};
#endif
  expect(cats_cpu_meets_baseline(&full), "the full baseline passes");
  for (size_t i = 0; i < sizeof each / sizeof each[0]; i++) {
    *each[i] = false;
    expect(!cats_cpu_meets_baseline(&full), "any missing feature fails");
    *each[i] = true;
  }
  struct cats_cpu_features none;
  memset(&none, 0, sizeof none);
  expect(!cats_cpu_meets_baseline(&none), "no features fail");
  struct cats_cpu_features here = cats_cpu_detect();
  printf("this CPU %s the baseline\n", cats_cpu_meets_baseline(&here) ? "meets" : "is below");
  if (failures == 0) printf("cpu_check_test: ok\n");
  return failures == 0 ? 0 : 1;
}
