cmake_minimum_required(VERSION 3.22)
project(cats_stt_linux C CXX)

# The Cats-owned helper for the linux-stt feature pack (cats-plugins SPEC-002).
# The pack build passes every cache value below; nothing comes from the machine.
set(WHISPER_SOURCE_DIR "" CACHE PATH "Locked whisper.cpp source tree")
set(CATS_STT_ARCH "" CACHE STRING "Target architecture: x64 or arm64")
set(CATS_STT_MODEL_LANGUAGES "0" CACHE STRING "Languages the packed model knows")
set(CATS_STT_LANGUAGE_MAP "" CACHE STRING "whisper=subtag pairs, comma-separated")
set(CATS_STT_THREADS "0" CACHE STRING "Recognition threads; 0 picks up to 4")
option(CATS_STT_TESTS "Build the native unit tests" OFF)

if(NOT WHISPER_SOURCE_DIR OR NOT EXISTS "${WHISPER_SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "WHISPER_SOURCE_DIR must name the locked whisper.cpp tree")
endif()
if(NOT CATS_STT_ARCH MATCHES "^(x64|arm64)$")
  message(FATAL_ERROR "CATS_STT_ARCH must be x64 or arm64")
endif()
if(NOT CATS_STT_MODEL_LANGUAGES MATCHES "^[1-9][0-9]*$")
  message(FATAL_ERROR "CATS_STT_MODEL_LANGUAGES must be a positive integer")
endif()

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# whisper.cpp and ggml (SPEC-002 FR-B6, ADR-002 D1): static, no OpenMP, BLAS,
# GPU or dynamic backends, and never the build machine's CPU.
macro(cats_force name value)
  set(${name} ${value} CACHE STRING "" FORCE)
endmacro()
cats_force(BUILD_SHARED_LIBS OFF)
cats_force(GGML_STATIC OFF)
cats_force(GGML_NATIVE OFF)
cats_force(GGML_OPENMP OFF)
cats_force(GGML_BLAS OFF)
cats_force(GGML_LLAMAFILE OFF)
cats_force(GGML_BACKEND_DL OFF)
cats_force(GGML_CPU_ALL_VARIANTS OFF)
cats_force(GGML_CPU_KLEIDIAI OFF)
foreach(backend CUDA HIP MUSA VULKAN METAL SYCL OPENCL RPC WEBGPU ZDNN VIRTGPU OPENVINO HEXAGON ZENDNN ET)
  cats_force(GGML_${backend} OFF)
endforeach()
cats_force(GGML_BUILD_TESTS OFF)
cats_force(GGML_BUILD_EXAMPLES OFF)
foreach(feature BUILD_TESTS BUILD_EXAMPLES BUILD_SERVER CURL SDL2 COMMON_FFMPEG COREML OPENVINO VITISAI)
  cats_force(WHISPER_${feature} OFF)
endforeach()
if(CATS_STT_ARCH STREQUAL "x64")
  # x86-64-v3
  foreach(feature SSE42 AVX AVX2 FMA F16C BMI2)
    cats_force(GGML_${feature} ON)
  endforeach()
  foreach(feature AVX_VNNI AVX512 AVX512_VBMI AVX512_VNNI AVX512_BF16 AMX_TILE AMX_INT8 AMX_BF16)
    cats_force(GGML_${feature} OFF)
  endforeach()
else()
  cats_force(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16")
endif()

add_subdirectory("${WHISPER_SOURCE_DIR}" whisper EXCLUDE_FROM_ALL)

find_package(PkgConfig REQUIRED)
pkg_check_modules(PULSE REQUIRED IMPORTED_TARGET libpulse)
find_package(Threads REQUIRED)

configure_file(src/config.h.in "${CMAKE_CURRENT_BINARY_DIR}/cats_stt_config.h" @ONLY)

# Compiled without baseline flags, so it runs on any CPU of the architecture
# and can refuse one below the baseline before whisper.cpp code runs.
add_library(cats_cpu_check STATIC src/cpu_check.c)
target_include_directories(cats_cpu_check PUBLIC src)

add_executable(cats-stt-linux src/main.cpp src/audio.cpp src/protocol.cpp)
target_include_directories(cats-stt-linux PRIVATE src "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(cats-stt-linux PRIVATE whisper cats_cpu_check PkgConfig::PULSE Threads::Threads)
target_link_options(cats-stt-linux PRIVATE -static-libstdc++ -static-libgcc -Wl,--as-needed)
target_compile_options(cats-stt-linux PRIVATE -Wall -Wextra)

if(CATS_STT_TESTS)
  add_executable(cpu_check_test tests/cpu_check_test.c)
  target_link_libraries(cpu_check_test PRIVATE cats_cpu_check)
  add_executable(protocol_test tests/protocol_test.cpp src/protocol.cpp)
  target_include_directories(protocol_test PRIVATE src)
endif()
