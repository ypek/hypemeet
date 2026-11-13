#!/usr/bin/env bash
# HypeTv for Android TV, built without Gradle: aapt2 (resources) → javac → d8 (dex) → zipalign → apksigner.
#
#   tv/android/build.sh            → tv/out/HypeTv-androidtv-<version>.apk
#   VERSION=1.0.1 CODE=2 tv/android/build.sh
#
# Needs the Android SDK (build-tools + a platform; ANDROID_HOME or the default Windows/macOS/Linux location) and a
# JDK 17+. The signing key is made on the first build in tv/android/signing/ (not in git): keep it, since an update
# only installs over the app when it's signed with the same key.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${VERSION:-1.0.0}"
CODE="${CODE:-1}"
MIN_SDK=21
TARGET_SDK=35

for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "${LOCALAPPDATA:-}/Android/Sdk" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
  if [ -n "$candidate" ] && [ -d "$candidate/build-tools" ]; then SDK="$candidate"; break; fi
done
[ -n "${SDK:-}" ] || { echo "Android SDK not found (set ANDROID_HOME)" >&2; exit 1; }
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
ANDROID_JAR="$SDK/platforms/$(ls "$SDK/platforms" | sort -V | tail -1)/android.jar"
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"

# build-tools are .exe/.bat on Windows.
tool() { for ext in "" .exe .bat; do [ -f "$BT/$1$ext" ] && { echo "$BT/$1$ext"; return; }; done; echo "missing $1" >&2; exit 1; }
AAPT2=$(tool aapt2); D8=$(tool d8); ZIPALIGN=$(tool zipalign); APKSIGNER=$(tool apksigner)

OUT=../out
WORK="$OUT/android-build"
rm -rf "$WORK" && mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/gen/com/mihawkdev/hypetv"

echo "· resources"
"$AAPT2" compile --dir res -o "$WORK/res.zip"
"$AAPT2" link -I "$ANDROID_JAR" --manifest AndroidManifest.xml -o "$WORK/unsigned.apk" "$WORK/res.zip" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK --version-code "$CODE" --version-name "$VERSION"

echo "· code"
cat > "$WORK/gen/com/mihawkdev/hypetv/BuildConfig.java" <<EOF
package com.mihawkdev.hypetv;
final class BuildConfig { static final String VERSION = "$VERSION"; }
EOF
javac -Xlint:-options --release 11 -classpath "$ANDROID_JAR" -d "$WORK/classes" \
  src/com/mihawkdev/hypetv/*.java "$WORK/gen/com/mihawkdev/hypetv/BuildConfig.java"
"$D8" --release --min-api $MIN_SDK --lib "$ANDROID_JAR" --output "$WORK/dex" $(find "$WORK/classes" -name '*.class')
jar --update --no-manifest --no-compress --file "$WORK/unsigned.apk" -C "$WORK/dex" classes.dex

echo "· signing"
KEYSTORE=signing/hypetv.keystore
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p signing
  keytool -genkeypair -keystore "$KEYSTORE" -alias hypetv -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass hypetv -keypass hypetv -dname "CN=HypeTv, O=HypeMeet" >/dev/null 2>&1
fi
"$ZIPALIGN" -p -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
APK="$OUT/HypeTv-androidtv-$VERSION.apk"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias hypetv --ks-pass pass:hypetv --key-pass pass:hypetv --out "$APK" "$WORK/aligned.apk"
"$APKSIGNER" verify "$APK"
rm -rf "$WORK"
echo "✓ $APK ($(du -k "$APK" | cut -f1) KB)"
