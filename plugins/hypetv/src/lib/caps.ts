/**
 * What this browser says it can decode, sent with a failure report. A player can't tell a missing codec (a Linux
 * build of Discord without H.264) from a decoder that claims the codec and then refuses it (hardware decoding)
 * on its own; this answers it from someone else's machine.
 */
export const CODECS = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  vp9: 'video/webm; codecs="vp09.00.40.08"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  opus: 'audio/webm; codecs="opus"',
} as const;

/** Each codec as "probably|maybe|no", plus "/mse" or "/no-mse" when Media Source answers too (live channels use it). */
export function codecSupport(canPlay: (type: string) => string, mse?: (type: string) => boolean): Record<keyof typeof CODECS, string> {
  const out = {} as Record<keyof typeof CODECS, string>;
  for (const [name, type] of Object.entries(CODECS) as [keyof typeof CODECS, string][]) {
    out[name] = `${canPlay(type) || "no"}${mse ? (mse(type) ? "/mse" : "/no-mse") : ""}`;
  }
  return out;
}

/** The decoder refused a video the browser had already opened: the file arrived, it's this machine that won't decode it. */
export const isDecoderRefusal = (detail: string | undefined) => !!detail && /DECODER_ERROR_NOT_SUPPORTED|kUnsupportedConfig/i.test(detail);

/** For the report: the codec table and how H.264 at 1080p would be decoded (powerEfficient = by the graphics card). */
export async function mediaReport(): Promise<Record<string, unknown>> {
  try {
    const video = document.createElement("video");
    const mse = typeof MediaSource !== "undefined" ? (t: string) => MediaSource.isTypeSupported(t) : undefined;
    const caps: Record<string, unknown> = codecSupport((t) => video.canPlayType(t), mse);
    const info = await Promise.race([
      navigator.mediaCapabilities?.decodingInfo({
        type: "file",
        video: { contentType: CODECS.h264, width: 1920, height: 1080, bitrate: 5_000_000, framerate: 24 },
      }),
      new Promise<undefined>((done) => setTimeout(done, 1500)),
    ]);
    if (info) caps.h264Decode = `${info.supported ? "supported" : "unsupported"}${info.smooth ? " smooth" : ""}${info.powerEfficient ? " hardware" : ""}`;
    return caps;
  } catch {
    return {};
  }
}
