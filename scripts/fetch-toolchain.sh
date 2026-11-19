#!/usr/bin/env bash
# 下载便携安卓构建工具链到项目内 toolchain/（不污染系统）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/toolchain"
mkdir -p "$TC"
cd "$TC"

echo "== JDK 21 (Temurin zip) =="
if [ ! -d jdk ]; then
  curl -fL --retry 3 -o jdk.zip "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip"
  unzip -q jdk.zip
  mv jdk-21* jdk
  rm jdk.zip
fi
./jdk/bin/java -version 2>&1 | head -1

echo "== Android cmdline-tools =="
if [ ! -d android-sdk/cmdline-tools/latest ]; then
  curl -fL --retry 3 -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  unzip -q cmdtools.zip
  mkdir -p android-sdk/cmdline-tools
  mv cmdline-tools android-sdk/cmdline-tools/latest
  rm cmdtools.zip
fi

echo "== SDK packages =="
export JAVA_HOME="$(cygpath -w "$TC/jdk")"
SDKM="$TC/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat"
yes | "$SDKM" --sdk_root="$(cygpath -w "$TC/android-sdk")" --licenses > /dev/null 2>&1 || true
"$SDKM" --sdk_root="$(cygpath -w "$TC/android-sdk")" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

echo "== Gradle 8.11.1 =="
if [ ! -d gradle ]; then
  curl -fL --retry 3 -o gradle.zip "https://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip"
  unzip -q gradle.zip
  mv gradle-8.11.1 gradle
  rm gradle.zip
fi

echo "TOOLCHAIN_READY"