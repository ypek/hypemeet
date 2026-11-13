import { expect, test } from "bun:test";
import { codecSupport, isDecoderRefusal } from "./caps";

test("codec table: what canPlayType and Media Source say, 'no' for an empty answer", () => {
  // A Linux Discord without H.264 and AAC, as a guess at what the report will show.
  const caps = codecSupport(
    (type) => (/avc1|mp4a|hvc1/.test(type) ? "" : "probably"),
    (type) => !/avc1|mp4a|hvc1/.test(type),
  );
  expect(caps).toEqual({ h264: "no/no-mse", hevc: "no/no-mse", vp9: "probably/mse", av1: "probably/mse", aac: "no/no-mse", opus: "probably/mse" });
  expect(codecSupport(() => "maybe").h264).toBe("maybe");
});

test("decoder refusal: the words Chromium uses when the file opened but the decoder said no", () => {
  // What a friend's Discord for Linux sent (report of 2026-11-13).
  expect(
    isDecoderRefusal("video 4 PipelineStatus::DECODER_ERROR_NOT_SUPPORTED: video decoder initialization failed with DecoderStatus::Codes::kUnsupportedConfig"),
  ).toBe(true);
  expect(isDecoderRefusal("video 4 MEDIA_ELEMENT_ERROR: Format error")).toBe(false);
  expect(isDecoderRefusal(undefined)).toBe(false);
});
