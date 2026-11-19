#!/usr/bin/env bash
# KiteChat APK 构建：Web 构建 → Capacitor 同步 → Gradle assembleRelease
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/toolchain"
export JAVA_HOME="$(cygpath -w "$TC/jdk")"
export ANDROID_HOME="$(cygpath -w "$TC/android-sdk")"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$TC/jdk/bin:$PATH"

cd "$ROOT"
echo "== web build =="
node scripts/build.mjs

echo "== capacitor sync =="
node node_modules/@capacitor/cli/bin/capacitor sync android

echo "== gradle assembleRelease =="
cd android
"$TC/gradle/bin/gradle" --no-daemon -Dorg.gradle.java.home="$JAVA_HOME" assembleRelease

OUT="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$OUT" ]; then
  cp "$OUT" "$ROOT/../KiteChat.apk"
  echo "APK_READY: $ROOT/../KiteChat.apk"
else
  echo "APK_MISSING"
  exit 1
fi