#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* CPU features of ADR-002 D1's baselines: x86-64-v3 and ARMv8.2-A with the
 * dot product and FP16 extensions. */
struct cats_cpu_features {
  /* x64 */
  bool sse42, popcnt, avx, avx2, fma, f16c, bmi1, bmi2, lzcnt, movbe, os_ymm;
  /* arm64 */
  bool asimd, dotprod, fp16, asimd_fp16;
};

/* Pure decision, testable with injected features. */
bool cats_cpu_meets_baseline(const struct cats_cpu_features *features);

/* Reads this CPU's features. */
struct cats_cpu_features cats_cpu_detect(void);

#ifdef __cplusplus
}
#endif
