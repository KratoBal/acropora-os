import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO_RELATIVE_PATH = join("assets", "branding", "acropora-logo.svg");

interface SvgPath {
  d: string;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  transform: readonly [number, number, number, number, number, number];
}

const attr = (source: string, name: string): string | null =>
  new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(source)?.[1] ?? null;

function styleValue(style: string, name: string): string | null {
  return new RegExp(`${name}:([^;]+)`).exec(style)?.[1]?.trim() ?? null;
}

function parseTransform(value: string | null): SvgPath["transform"] {
  const values = (value?.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(
    Number,
  );
  if (values.length !== 6)
    throw new Error("The Acropora logo contains an unsupported SVG transform.");
  return values as unknown as SvgPath["transform"];
}

function parseLogo(svg: string): readonly SvgPath[] {
  return [...svg.matchAll(/<path\b([\s\S]*?)\/>/g)].map((match) => {
    const raw = match[1] ?? "";
    const style = attr(raw, "style") ?? "";
    const d = attr(raw, "d");
    if (!d) throw new Error("The Acropora logo contains a path without data.");
    const fill = styleValue(style, "fill");
    const stroke = styleValue(style, "stroke");
    return {
      d,
      fill: fill === "none" ? null : fill,
      stroke: stroke === "none" ? null : stroke,
      strokeWidth: Number(styleValue(style, "stroke-width") ?? "1"),
      lineCap: (styleValue(style, "stroke-linecap") ??
        "butt") as SvgPath["lineCap"],
      transform: parseTransform(attr(raw, "transform")),
    };
  });
}

function logoPath(): string {
  let directory = HERE;
  for (;;) {
    const candidate = join(directory, LOGO_RELATIVE_PATH);
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error(
    "The Acropora vector logo is not available to the PDF renderer.",
  );
}

let paths: readonly SvgPath[] | null = null;

function logoPaths(): readonly SvgPath[] {
  paths ??= parseLogo(readFileSync(logoPath(), "utf8"));
  return paths;
}

/** Draw the canonical SVG logo without rasterizing it. */
export function drawAcroporaLogo(
  document: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
): void {
  const scale = width / 645.2;
  document.save();
  document.translate(x, y);
  document.scale(scale, scale);
  document.translate(-85.7, -332.5);

  for (const path of logoPaths()) {
    document.save();
    document.transform(...path.transform);
    document.path(path.d);
    if (path.fill) document.fillColor(path.fill).fill();
    if (path.stroke)
      document
        .strokeColor(path.stroke)
        .lineWidth(path.strokeWidth)
        .lineCap(path.lineCap)
        .stroke();
    document.restore();
  }
  document.restore();
}
