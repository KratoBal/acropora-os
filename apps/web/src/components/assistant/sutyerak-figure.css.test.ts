import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  A FIGURA STÍLUSA ÉS RÉTEGEI (kártya e0780477). MI PIROSÍT: egy időzítés
  eltér a jóváhagyott elo-nezet.html-től; a nagyítón kívül más is pásztáz;
  csökkentett mozgásnál valami mégis mozog; a lap nincs bekötve; egy réteg
  nem 512 px-es, elveszti az átlátszóságát, vagy nem az, amit a manifest
  mond (a forrás sha-ja a csomagé).
*/
const here = __dirname;
const css = readFileSync(join(here, "sutyerak-figure.css"), "utf8");
const globals = readFileSync(join(here, "../../app/globals.css"), "utf8");
const publicDir = join(here, "../../../public/sutyerak/animated-v1");
const manifest = JSON.parse(
  readFileSync(join(publicDir, "manifest.json"), "utf8"),
) as {
  assets: Array<{
    file: string;
    width: number;
    height: number;
    hasAlpha: boolean;
    sha256: string;
    source: { file: string; sha256: string };
  }>;
};

/** The package's own ASSET-MANIFEST.json values (exchange/sutyerak/animated-v1, 2026-10-06). */
const SOURCE_SHA: Record<string, string> = {
  "assets/pihen-para.png":
    "aef96bd51fe2d56be228fa283d2cc632842f6e20490a77dd98aad6bc48fbc05c",
  "assets/pihen-alap.png":
    "475cad6926ee6fbf60f191b44081e4db7d6fe013bbd2c7cb0540369d075bf53b",
  "assets/pihen-szem.png":
    "5b55de5f265b8b7792eef257f95d39fe76fcd1f0ae6f5b918ab2781bb5e7fa94",
  "assets/pihen-szem-csukott.png":
    "422f3fb726893e4c937f3270484e6cbbb988ce9eeea880a088a0f224bdc97a53",
  "assets/jegyzetel-alap.png":
    "aad2964a538bb2d0374ce335b96467a7004876430235798a67a2bf776769563c",
  "assets/iro-ollo-ceruza.png":
    "67d4528fc46eb24573e2d699eb7af792eda97db058f3ab55500a4b6695302d61",
  "assets/keres-alap.png":
    "4c28371eb27a94dc01bff9c3dfc1d20dd8cea471ea351fe65f47bf8186f8eeba",
  "assets/nagyito-ollo.png":
    "f2b3ecd2e6d4051aa7662348726006df0fbb6f3b87da0aed0dc11f5bec0cc8ec",
  "assets/valaszol-alap.png":
    "81450f07e67305704b2a6d7c2b38584aada64c23cad64fe243f7f87ac84badfe",
  "assets/beszedbuborek.png":
    "78b5a4f377e798508f73e94ff88cc7c357dfeb4cc0e61d59dc275cf3c03a475e",
};

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("sutyerak-figure.css follows elo-nezet.html", () => {
  it("the timings and pivots are the reference's", () => {
    expect(rule(".sut-fig .sut-pose-resting")).toMatch(
      /animation:\s*sut-rest 5\.2s/,
    );
    expect(rule(".sut-fig .sut-pencil")).toMatch(
      /animation:\s*sut-write 0\.65s/,
    );
    expect(rule(".sut-fig .sut-pencil")).toMatch(/transform-origin:\s*87% 85%/);
    expect(rule(".sut-fig .sut-glass")).toMatch(/animation:\s*sut-scan 2\.4s/);
    expect(rule(".sut-fig .sut-glass")).toMatch(/transform-origin:\s*85% 83%/);
    expect(rule(".sut-fig .sut-bubble")).toMatch(
      /animation:\s*sut-reply 2\.6s/,
    );
    expect(rule(".sut-fig .sut-answer-body")).toMatch(
      /animation:\s*sut-answer-rest 3\.6s/,
    );
    expect(
      rule('.sut-fig[data-state="answering"] .sut-bubble-placement'),
    ).toMatch(/sut-appear 0\.38s/);
    expect(rule(".sut-fig .sut-pose-answering")).toMatch(/scale\(0\.94\)/);
    expect(rule(".sut-fig .sut-eyes")).toMatch(
      /translate\(3\.52%, -3\.28%\) scale\(0\.82\)/,
    );
    expect(rule(".sut-fig .sut-note-placement")).toMatch(
      /translate\(23\.4%, 28\.3%\) scale\(0\.6\)/,
    );
  });

  it("in searching only the magnifier moves; the paper is a fixed base layer", () => {
    expect(css).not.toMatch(/\.sut-pose-searching\s*\{[^}]*animation/);
    expect(css).toMatch(
      /\[data-state="searching"\] \.sut-glass\s*\{[^}]*running/,
    );
  });

  it("with reduced motion every animation and transition stops; the pose stays", () => {
    const block = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(block).toMatch(/animation:\s*none !important/);
    expect(block).toMatch(/transition:\s*none !important/);
    expect(block).not.toMatch(/opacity/);
  });

  it("is imported by the global stylesheet", () => {
    expect(globals).toContain(
      '@import "../components/assistant/sutyerak-figure.css";',
    );
  });
});

/** A keyframe-blokk töréspontjai: [százalék, átlátszóság] párok, sorrendben. */
const stops = (name: string): Array<[number, number]> => {
  const start = css.indexOf(`@keyframes ${name} {`);
  expect(start, name).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("\n}\n", start));
  const out: Array<[number, number]> = [];
  for (const block of body.matchAll(
    /((?:\d+(?:\.\d+)?%,?\s*)+)\{\s*opacity:\s*([01]);/g,
  ))
    for (const at of block[1]!.matchAll(/(\d+(?:\.\d+)?)%/g))
      out.push([Number(at[1]), Number(block[2])]);
  return out;
};

describe("Sutyerák blinks while resting (card bbbc6120)", () => {
  const CYCLE_MS = 17000;

  it("each blink is short (120–150 ms), every 3–6 s, and not in a regular rhythm", () => {
    expect(css).toMatch(/animation:\s*sut-blink-closed 17s/);
    const points = stops("sut-blink-closed");
    const closed: Array<[number, number]> = [];
    for (let i = 0; i < points.length; i++)
      if (points[i]![1] === 1 && points[i - 1]?.[1] !== 1) {
        let j = i;
        while (points[j + 1]?.[1] === 1) j++;
        closed.push([points[i]![0], points[j]![0]]);
      }
    expect(closed.length).toBeGreaterThanOrEqual(3);
    for (const [from, to] of closed) {
      const ms = ((to - from) / 100) * CYCLE_MS;
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(150);
    }
    const gaps = closed.map(([, end], i) => {
      const next =
        closed[(i + 1) % closed.length]![0] +
        (i + 1 === closed.length ? 100 : 0);
      return ((next - end) / 100) * CYCLE_MS;
    });
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3000);
      expect(gap).toBeLessThanOrEqual(6000);
    }
    expect(
      new Set(gaps.map((gap) => Math.round(gap / 100))).size,
    ).toBeGreaterThan(1);
  });

  it("the open eye is the closed eye's exact mirror, so there is never no eye and never two", () => {
    const closed = stops("sut-blink-closed");
    const open = stops("sut-blink-open");
    expect(open.map(([at]) => at)).toEqual(closed.map(([at]) => at));
    expect(open.map(([, value]) => value)).toEqual(
      closed.map(([, value]) => 1 - value),
    );
  });

  it("only resting blinks; the closed eye sits where the package puts it", () => {
    expect(css).toMatch(
      /\.sut-fig \.sut-eyes-closed\s*\{[^}]*animation-play-state:\s*paused/,
    );
    expect(css).toMatch(
      /\[data-state="resting"\] \.sut-eyes,\s*\.sut-fig\[data-state="resting"\] \.sut-eyes-closed\s*\{\s*animation-play-state:\s*running/,
    );
    expect(css).toMatch(
      /\.sut-fig \.sut-eyes-closed\s*\{[^}]*translate\(3\.52%, -4\.55%\) scale\(0\.82\)/,
    );
  });
});

describe("the animated-v1 layers", () => {
  it("are 512 px WebP with alpha, as the manifest says, from the package's sources", () => {
    expect(manifest.assets.map((a) => a.source.file).sort()).toEqual(
      Object.keys(SOURCE_SHA).sort(),
    );
    for (const asset of manifest.assets) {
      expect(asset.source.sha256, asset.file).toBe(
        SOURCE_SHA[asset.source.file],
      );
      expect([asset.width, asset.height, asset.hasAlpha], asset.file).toEqual([
        512,
        512,
        true,
      ]);
      const bytes = readFileSync(join(publicDir, asset.file));
      expect(createHash("sha256").update(bytes).digest("hex"), asset.file).toBe(
        asset.sha256,
      );
      expect(bytes.subarray(8, 12).toString("ascii"), asset.file).toBe("WEBP");
    }
  });
});
