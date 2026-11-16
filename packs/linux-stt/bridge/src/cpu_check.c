#include "cpu_check.h"

#include <string.h>

#if defined(__x86_64__)
#include <cpuid.h>
#elif defined(__aarch64__)
#include <asm/hwcap.h>
#include <sys/auxv.h>
#endif

bool cats_cpu_meets_baseline(const struct cats_cpu_features *f) {
#if defined(__x86_64__)
  return f->sse42 && f->popcnt && f->avx && f->avx2 && f->fma && f->f16c && f->bmi1 && f->bmi2 &&
         f->lzcnt && f->movbe && f->os_ymm;
#elif defined(__aarch64__)
  return f->asimd && f->dotprod && f->fp16 && f->asimd_fp16;
#else
  (void)f;
  return false;
#endif
}

struct cats_cpu_features cats_cpu_detect(void) {
  struct cats_cpu_features f;
  memset(&f, 0, sizeof f);
#if defined(__x86_64__)
  unsigned a, b, c, d;
  if (__get_cpuid(1, &a, &b, &c, &d)) {
    f.sse42 = c & (1u << 20);
    f.popcnt = c & (1u << 23);
    f.avx = c & (1u << 28);
    f.fma = c & (1u << 12);
    f.f16c = c & (1u << 29);
    f.movbe = c & (1u << 22);
    if (c & (1u << 27)) { /* OSXSAVE: the OS saves the YMM state */
      unsigned lo, hi;
      __asm__ volatile("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
      f.os_ymm = (lo & 0x6u) == 0x6u;
    }
  }
  if (__get_cpuid_count(7, 0, &a, &b, &c, &d)) {
    f.avx2 = b & (1u << 5);
    f.bmi1 = b & (1u << 3);
    f.bmi2 = b & (1u << 8);
  }
  if (__get_cpuid(0x80000001u, &a, &b, &c, &d)) {
    f.lzcnt = c & (1u << 5);
  }
#elif defined(__aarch64__)
  unsigned long hw = getauxval(AT_HWCAP);
  f.asimd = hw & HWCAP_ASIMD;
  f.dotprod = hw & HWCAP_ASIMDDP;
  f.fp16 = hw & HWCAP_FPHP;
  f.asimd_fp16 = hw & HWCAP_ASIMDHP;
#endif
  return f;
}
