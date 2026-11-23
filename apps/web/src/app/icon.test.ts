import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A FAVICON A LOGÓ JELE, SZÍNVÁLTOZÁS NÉLKÜL (acrobot 60068, kártya c89b87a0).
 *
 * Az `icon.svg` a `public/acropora-logo.svg` négy jel-útvonalát (a két ív, a kék
 * négyzet és a narancs alak) viszi át a felirat nélkül. MI PIROSÍT: ha a favicon
 * egy útvonala vagy egy színe eltér a logóétól (a kék ív kontrasztja Balázs
 * döntése, nem itt dől el), ha a felirat betűi bekerülnek, vagy ha a vágás nem
 * négyzetes.
 */
const WEB = process.cwd();
const read = (p: string) => readFileSync(join(WEB, p), "utf8");
const paths = (svg: string) =>
  new Map(
    [...svg.matchAll(/<path[\s\S]*?\/>/g)].map((m) => [
      m[0].match(/id="([^"]+)"/)![1]!,
      m[0].replace(/\s+/g, " "),
    ]),
  );

describe("a webes felület faviconja", () => {
  const logo = paths(read("public/acropora-logo.svg"));
  const icon = read("src/app/icon.svg");
  const iconPaths = paths(icon);

  it("a logó négy jel-útvonala, betű nélkül", () => {
    expect([...iconPaths.keys()].sort()).toEqual([
      "path12",
      "path13",
      "path2",
      "path3",
    ]);
  });

  it("minden útvonal betűre a logóé: rajz, szín, vastagság, transzformáció", () => {
    for (const [id, path] of iconPaths) expect(path).toBe(logo.get(id));
  });

  it("négyzetes vágás", () => {
    const [, , w, h] = icon
      .match(/viewBox="([^"]+)"/)![1]!
      .split(/\s+/)
      .map(Number);
    expect(w).toBe(h);
  });
});
