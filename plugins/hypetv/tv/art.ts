/**
 * The TV apps' artwork, drawn from public/icon.svg and the HypeTv wordmark:
 * - Android TV: launcher icons (mipmap-*) and the 320×180 banner the TV home shows;
 * - LG webOS: icon (80×80), largeIcon (130×130) and the splash.
 *
 *   bun tv/art.ts <BricolageGrotesque ExtraBold .ttf>
 *
 * The font is the wordmark's (Bricolage Grotesque, OFL): Google Fonts serves the static 800 weight as TTF at
 * https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@96,800 to a plain user agent.
 * The PNGs are committed, so this only runs again when the art changes.
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const font = process.argv[2];
if (!font) throw new Error("usage: bun tv/art.ts <BricolageGrotesque-ExtraBold.ttf>");
const here = import.meta.dir;
const icon = readFileSync(join(here, "..", "public", "icon.svg"), "utf8");

const CANVAS = "#131418";
const INK = "#f2f3f7";
const ACCENT = "#9070ff";
const ACCENT_HI = "#b1a0ff";
const ON_ACCENT = "#121019";

/** The icon's drawing, without its own <svg> wrapper, to place inside a bigger picture. */
const iconBody = icon.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** "Hype" plus the tilted "Tv" sticker, as in the app's Wordmark (components/ui.tsx). Sized by its font size. */
function wordmark(x: number, baseline: number, size: number) {
  const hypeWidth = size * 2.18;
  const pad = size * 0.3;
  const tvWidth = size * 1.08 + pad * 2;
  const tvHeight = size * 1.06;
  const tx = x + hypeWidth + size * 0.14;
  const top = baseline - size * 0.86;
  return {
    width: hypeWidth + size * 0.14 + tvWidth,
    svg: `
    <text x="${x}" y="${baseline}" font-family="Bricolage Grotesque" font-weight="800" font-size="${size}" letter-spacing="${-size * 0.02}" fill="${INK}">Hype</text>
    <g transform="rotate(-3 ${tx + tvWidth / 2} ${top + tvHeight / 2})">
      <rect x="${tx}" y="${top + size * 0.06}" width="${tvWidth}" height="${tvHeight}" rx="${size * 0.36}" fill="#00000059"/>
      <rect x="${tx}" y="${top}" width="${tvWidth}" height="${tvHeight}" rx="${size * 0.36}" fill="${ACCENT}" stroke="${ACCENT_HI}" stroke-width="${Math.max(2, size * 0.05)}"/>
      <text x="${tx + tvWidth / 2}" y="${baseline - size * 0.02}" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="${size}" letter-spacing="${-size * 0.02}" fill="${ON_ACCENT}">Tv</text>
    </g>`,
  };
}

/** The icon next to the wordmark, centred on a dark canvas with a soft lilac glow. */
function lockup(w: number, h: number, scale: number) {
  const iconSize = 64 * scale;
  const size = 40 * scale;
  const gap = 18 * scale;
  const mark = wordmark(0, 0, size);
  const total = iconSize + gap + mark.width;
  const x = (w - total) / 2;
  const iy = (h - iconSize) / 2;
  const baseline = h / 2 + size * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${CANVAS}"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <svg x="${x}" y="${iy}" width="${iconSize}" height="${iconSize}" viewBox="0 0 64 64">${iconBody}</svg>
  ${wordmark(x + iconSize + gap, baseline, size).svg}
</svg>`;
}

function png(svg: string, width: number): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: [font!], loadSystemFonts: false, defaultFontFamily: "Bricolage Grotesque" } });
  return r.render().asPng();
}

function out(rel: string, data: Buffer) {
  const path = join(here, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(rel, data.length);
}

// Android launcher icons, every density.
for (const [dpi, px] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]] as const)
  out(`android/res/mipmap-${dpi}/ic_launcher.png`, png(icon, px));
// Android TV banner: 320×180 at xhdpi (the TV home picks it by density).
out("android/res/drawable-xhdpi/banner.png", png(lockup(320, 180, 1), 320));
out("android/res/drawable-xxhdpi/banner.png", png(lockup(320, 180, 1), 480));

// webOS: launcher icons and the splash shown while the app opens.
out("webos/icon.png", png(icon, 80));
out("webos/largeIcon.png", png(icon, 130));
out("webos/splash.png", png(lockup(1920, 1080, 4), 1920));
// A preview of the banner, to look at.
out("out/banner-preview.png", png(lockup(320, 180, 1), 960));
