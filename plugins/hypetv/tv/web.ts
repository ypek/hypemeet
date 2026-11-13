/**
 * The TV build's CSS (vite build --mode tv): what the page needs to look right on old TV browsers.
 *
 * Tailwind v4 writes for current browsers. On a TV (LG webOS 5–23 is Chromium 68–94, Android TV WebViews are often
 * as old) these break the page, and they're rewritten here:
 * - :focus-visible (Chromium 86) → :focus. A TV is driven by the remote, so every focus should show anyway.
 * - translate / scale / rotate as properties (Chromium 104) → one transform built from them.
 * - aspect-ratio (Chromium 88) → the padding-top box, only where it isn't supported (posters, the player).
 * - logical properties (padding-inline…), :is(), nesting → Lightning CSS lowers them for Chromium 68.
 * @layer is flattened earlier, by postcss-cascade-layers (vite.config.ts).
 */
import { browserslistToTargets, transform } from "lightningcss";
import postcss, { type Plugin as PostcssPlugin, type Rule } from "postcss";
import type { Plugin } from "vite";

const TARGETS = ["chrome 68"];

/** A CSS value split on its top-level spaces (not the ones inside calc() or var()). */
export function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** translate / rotate / scale apply in that order, before transform: the same order here. */
const TRANSFORM = "var(--tv-translate) var(--tv-rotate) var(--tv-scale)";
const IDENTITY = { translate: "translate(0,0)", rotate: "rotate(0)", scale: "scale(1)" } as const;

export function transformFor(prop: "translate" | "rotate" | "scale", value: string): string {
  if (value.trim() === "none") return IDENTITY[prop];
  const [a, b] = words(value);
  if (prop === "translate") return `translate(${a}, ${b ?? "0"})`;
  if (prop === "scale") return `scale(${a}, ${b ?? a})`;
  return `rotate(${a})`;
}

/** Index of the parenthesis closing the one at `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Whether `s` has `chars` outside parentheses and brackets (a selector list's commas, a combinator). */
function topLevel(s: string, chars: RegExp): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\") i++;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && chars.test(c)) return true;
  }
  return false;
}

/**
 * :where(X) and :is(X) with a single selector inside → X (Chromium < 88 drops the whole rule otherwise). Tailwind's
 * group variants come out as `:is(:where(.group):hover .x)`, which is just `.group:hover .x`. Only specificity
 * changes, and the layer polyfill's :not(#\#) boosts dwarf that. Lists (`:is(a,b)`) are left to Lightning CSS.
 */
export function unwrapSelector(sel: string): string {
  // A :where() list behaves like :is() but for specificity; as :is() Lightning CSS can lower it.
  let out = sel.replace(/:where\(/g, ":is(");
  for (let guard = 0; guard < 50; guard++) {
    let found = false;
    for (let from = 0; ; ) {
      const at = out.slice(from).search(/:(where|is)\(/);
      if (at === -1) break;
      const start = from + at;
      const open = out.indexOf("(", start);
      const end = closing(out, open);
      if (end === -1) break;
      const inner = out.slice(open + 1, end);
      const before = out[start - 1];
      const startsCompound = start === 0 || before === " " || before === ">" || before === "+" || before === "~";
      if (!topLevel(inner, /,/) && (startsCompound || !topLevel(inner.trim(), /[\s>+~]/))) {
        out = out.slice(0, start) + inner.trim() + out.slice(end + 1);
        found = true;
        break;
      }
      from = end + 1;
    }
    if (!found) break;
  }
  return out;
}

const SIDES = { inline: ["left", "right"], block: ["top", "bottom"] } as const;
const LOGICAL = /^(padding|margin|scroll-padding|scroll-margin|inset|border)-(inline|block)(?:-(start|end))?(?:-(width|style|color))?$/;

/** Logical properties as physical ones, for a left-to-right page (Chromium < 87 has only the -start/-end longhands). */
export function physical(prop: string, value: string): [string, string][] | null {
  if (prop === "inset") {
    const v = words(value);
    const [t, r = t, b = t, l = r] = v;
    return v.length ? [["top", t!], ["right", r!], ["bottom", b!], ["left", l!]] : null;
  }
  const m = LOGICAL.exec(prop);
  if (!m) return null;
  const [, base, axis, edge, part] = m as unknown as [string, string, "inline" | "block", string | undefined, string | undefined];
  const name = (side: string) => (base === "inset" ? side : `${base}-${side}${part ? `-${part}` : ""}`);
  const [first, second] = SIDES[axis];
  if (edge) return [[name(edge === "start" ? first : second), value]];
  // `border-inline: 2px solid red` is one border for both sides; the others take one or two values.
  if (base === "border" && !part) return [[name(first), value], [name(second), value]];
  const [a, b = a] = words(value);
  return [[name(first), a!], [name(second), b!]];
}

export const tvCompat: PostcssPlugin = {
  postcssPlugin: "hypetv-tv-compat",
  Once(root) {
    // Like Tailwind's own --tw-* fallbacks: on every element, so a parent's value is never inherited.
    root.prepend(
      postcss.rule({ selector: "*,:before,:after,::backdrop" }).append(
        ...Object.entries(IDENTITY).map(([k, v]) => postcss.decl({ prop: `--tv-${k}`, value: v })),
      ),
    );
  },
  Rule(rule) {
    const selectors = rule.selectors.map((s) => unwrapSelector(s.replace(/:focus-visible/g, ":focus")));
    if (selectors.join(",") !== rule.selectors.join(",")) rule.selectors = selectors;
  },
  Declaration(decl) {
    const p = decl.prop;
    const sides = physical(p, decl.value);
    if (sides) {
      for (const [prop, value] of sides) decl.cloneBefore({ prop, value });
      decl.remove();
      return;
    }
    if (p === "translate" || p === "scale" || p === "rotate") {
      decl.cloneBefore({ prop: `--tv-${p}`, value: transformFor(p, decl.value) });
      decl.prop = "transform";
      decl.value = TRANSFORM;
      return;
    }
    // scale() takes numbers on old browsers, not the percentages Tailwind uses (scale-110 → 110%).
    if (/^--tw-scale-[xyz]$/.test(p) && /^-?[\d.]+%$/.test(decl.value.trim())) {
      decl.value = String(parseFloat(decl.value) / 100);
      return;
    }
    if (p === "aspect-ratio" && decl.parent?.type === "rule") {
      const rule = decl.parent as Rule;
      if (rule.selectors.some((s) => s.includes("::"))) return;
      const box = postcss.atRule({ name: "supports", params: "not (aspect-ratio: 1 / 1)" });
      box.append(
        postcss.rule({ selectors: rule.selectors.map((s) => `${s}::before`) }).append(
          { prop: "content", value: '""' },
          { prop: "float", value: "left" },
          { prop: "padding-top", value: `calc(100% / (${decl.value}))` },
        ),
        postcss.rule({ selectors: rule.selectors.map((s) => `${s}::after`) }).append({ prop: "content", value: '""' }, { prop: "display", value: "block" }, { prop: "clear", value: "both" }),
      );
      rule.after(box);
    }
  },
};

export async function tvCss(css: string, filename = "tv.css"): Promise<string> {
  const fixed = (await postcss([tvCompat]).process(css, { from: undefined })).css;
  return transform({ filename, code: Buffer.from(fixed), minify: true, targets: browserslistToTargets(TARGETS) }).code.toString();
}

/** Rewrites the build's stylesheets once they're final. */
export function tvCssPlugin(): Plugin {
  return {
    name: "hypetv-tv-css",
    apply: "build",
    enforce: "post",
    async generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        const css = typeof file.source === "string" ? file.source : Buffer.from(file.source).toString("utf8");
        file.source = await tvCss(css, file.fileName);
      }
    },
  };
}
