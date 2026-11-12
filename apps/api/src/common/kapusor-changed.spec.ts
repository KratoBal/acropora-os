import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

/**
 * A `pnpm gates --changed` SZURO (`scripts/kapusor-changed.mjs`) KALIBRACIOJA (T6.1, kartya 8b436dcb).
 *
 * A szuro egy RESZHALMAZ-ellenorzes, es a fo allitasa nem az, hogy hibat fog, hanem hogy NEM IGER TOBBET, mint amit fed.
 * Ezert a teszt ket iranyba merik: (1) elkap egy tipushibat a valtozott fajlban; (2) NEM kap el egy hibat, ami egy,
 * a valtozottra EPULO, nem valtozott fajlban all (a dokumentalt vak folt), es ekkor is kimondja, hogy reszleges.
 * Ami meg pirosra fordulna: a nyilatkozat hianya; a "nem futott" allapot zoldkent (nincs TS valtozas, kevés szabad
 * memoria, megszakadt tsc); az ideiglenes tsconfig a munkafan marad.
 *
 * A FIXTURAK KICSIK, EGY VALODI ALFOLYAMAT-HIVAS EGY IDEIGLENES GIT-REPON (ugyanaz a minta, mint a meres-kapu.spec.ts):
 * a szkript PONTOSAN azt adja, amit egy hivo a parancssorbol kap. A tsc a repo sajat typescriptje (KAPUSOR_TSC), a memoria-
 * kapu egy fixtura-cgroup mappabol olvas, hogy a teszt ne fuggjon a gep aktualis szabad memoriajatol.
 */
const MODUL = join(process.cwd(), "..", "..", "scripts", "kapusor-changed.mjs");
/** A BELEPESI PONT a `kapusor.mjs --changed`: a teszt azt hivja, amit egy hivo a parancssorbol. */
const SZKRIPT = join(process.cwd(), "..", "..", "scripts", "kapusor.mjs");
const TSC = join(
  process.cwd(),
  "..",
  "..",
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

/**
 * A gazda PATH-ja a gyermekfolyamatoknak. BRACKET-ALAKBAN, nem pontos alakban: a `reefclub-environment.spec.ts` a
 * forrasban (kornyezet).NEV alakot keres, es minden talalt valtozonak vagy tiltottnak, vagy nem-titoknak kell lennie a listan.
 * A PATH nem az alkalmazas beallitasa, csak a teszt alfolyamatanak kornyezete.
 */
const HOST_PATH = process.env["PATH"] ?? "";

const ELSO_SOR = "RESZLEGES ELLENORZES, NEM KAPU";

function cgroup(szabadMB: number) {
  const mappa = mkdtempSync(join(tmpdir(), "kapusor-cgroup-"));
  const MB = 1024 * 1024;
  writeFileSync(join(mappa, "memory.max"), String(4000 * MB));
  writeFileSync(join(mappa, "memory.current"), String((4000 - szabadMB) * MB));
  return mappa;
}

function repo(fajlok: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "kapusor-repo-"));
  const ir = (rel: string, tartalom: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), tartalom);
  };
  ir(
    "pkg/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  for (const [rel, tartalom] of Object.entries(fajlok)) ir(rel, tartalom);
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], {
      cwd: dir,
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { dir, ir };
}

function fut(dir: string, kornyezet: Record<string, string> = {}) {
  const r = spawnSync(
    process.execPath,
    [SZKRIPT, "--changed", "--repo", dir, "--base", "HEAD"],
    {
      encoding: "utf8",
      env: {
        PATH: HOST_PATH,
        KAPUSOR_TSC: `${process.execPath} ${TSC}`,
        KAPUSOR_CGROUP_DIR: cgroup(8000),
        NODE_OPTIONS: "--max-old-space-size=512",
        ...kornyezet,
      },
    },
  );
  return { kod: r.status, ki: `${r.stdout}${r.stderr}` };
}

const BAZIS = {
  "pkg/src/a.ts":
    "export function dupla(x: number): number { return x * 2; }\n",
  "pkg/src/b.ts":
    'import { dupla } from "./a.js";\nexport const nyolc = dupla(4);\n',
  "pkg/src/c.ts": "export const kulon = 1;\n",
};

describe("kapusor --changed", () => {
  it("egy tiszta valtozas zold, de MINDIG kimondja, hogy reszleges es hanyat nem nezett", () => {
    const { dir, ir } = repo(BAZIS);
    ir("pkg/src/a.ts", `${BAZIS["pkg/src/a.ts"]}// valtozas\n`);
    const r = fut(dir);
    assert.equal(r.kod, 0, r.ki);
    assert.ok(r.ki.includes(ELSO_SOR), "a nyilatkozat hianyzik");
    assert.match(r.ki, /A FEDETT RESZ ZOLD: 1 valtozott fajl/);
    assert.match(r.ki, /a csomag 3 fajljabol/);
    // az a.ts es a program: a.ts (a b.ts es c.ts NEM kerul be, mert nem importaltak)
    assert.match(r.ki, /a program 1 repo-fajlt tartalmazott/);
    assert.match(r.ki, /a maradek 2 fajlt NEM nezte/);
    assert.ok(r.ki.trimEnd().split("\n").pop()!.includes("a CI a kapu"));
  });

  it("elkap egy tipushibat a VALTOZOTT fajlban (kilepesi kod 1, a hibasor kiirva)", () => {
    const { dir, ir } = repo(BAZIS);
    ir(
      "pkg/src/a.ts",
      `${BAZIS["pkg/src/a.ts"]}export const rossz: number = "x";\n`,
    );
    const r = fut(dir);
    assert.equal(r.kod, 1, r.ki);
    assert.match(r.ki, /error TS2322/);
    assert.match(r.ki, /BUKOTT/);
  });

  it("A VAK FOLT: egy valtozott alairas a RAJA EPULO, nem valtozott fajlt eltori, a szuro ezt NEM latja (es ezt kimondja)", () => {
    const { dir, ir } = repo(BAZIS);
    // a `dupla` mostantol ket argumentumot var: a b.ts hivasa hibas, de a b.ts nem valtozott
    ir(
      "pkg/src/a.ts",
      "export function dupla(x: number, y: number): number { return x * y; }\n",
    );
    const r = fut(dir);
    assert.equal(r.kod, 0, `a vak folt mar nem vak?\n${r.ki}`);
    assert.ok(r.ki.includes(ELSO_SOR));
    assert.match(r.ki, /a rajuk EPULO fajlokat/);
    // ugyanezt a teljes tsc elkapna: kontroll, hogy a hiba tenyleg ott van
    const teljes = spawnSync(process.execPath, [TSC, "-p", join(dir, "pkg")], {
      encoding: "utf8",
    });
    assert.notEqual(
      teljes.status,
      0,
      "a kontroll: a teljes tsc piros kell legyen",
    );
    assert.match(teljes.stdout, /b\.ts.*error TS2554/);
  });

  it("nincs valtozott TS fajl: kimondja, hogy NEM futott tipusellenorzes (nem zold kapu)", () => {
    const { dir, ir } = repo(BAZIS);
    ir("pkg/README.md", "csak szoveg\n");
    const r = fut(dir);
    // 3, nem 0: egy gep (&& lanc, ageens) a kodot nezi, es a "nem futott" nem zold
    assert.equal(r.kod, 3, r.ki);
    assert.match(r.ki, /NEM FUTOTT TIPUSELLENORZES/);
    assert.match(r.ki, /pkg\/README\.md {2}\[nem TS fajl\]/);
    assert.ok(!r.ki.includes("ZOLD:"));
  });

  it("kevés szabad memoria: NEM indul el (kilepesi kod 1), a tsc-t egyaltalan nem hivja meg", () => {
    const { dir, ir } = repo(BAZIS);
    ir("pkg/src/a.ts", `${BAZIS["pkg/src/a.ts"]}// valtozas\n`);
    const r = fut(dir, {
      KAPUSOR_CGROUP_DIR: cgroup(100),
      // ha elindulna, ez a parancs nem letezik, es MAS hibauzenet jonne
      KAPUSOR_TSC: "nincs-ilyen-parancs-a-gepen",
    });
    assert.equal(r.kod, 1, r.ki);
    assert.match(r.ki, /NEM INDULT EL: a konteiner szabad memoriaja 100 MB/);
    assert.ok(!r.ki.includes("ZOLD"));
  });

  it("egy megszakadt tsc (kiolve) nem zold: megnevezi a jelet, kilepesi kod 1", () => {
    const { dir, ir } = repo(BAZIS);
    ir("pkg/src/a.ts", `${BAZIS["pkg/src/a.ts"]}// valtozas\n`);
    const halalos = join(
      mkdtempSync(join(tmpdir(), "kapusor-kill-")),
      "kill.mjs",
    );
    writeFileSync(
      halalos,
      `import { spawnSync } from "node:child_process";
if (process.argv.includes("--listFiles")) process.kill(process.pid, "SIGKILL");
const r = spawnSync(process.execPath, [${JSON.stringify(TSC)}, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
`,
    );
    const r = fut(dir, { KAPUSOR_TSC: `${process.execPath} ${halalos}` });
    assert.equal(r.kod, 1, r.ki);
    assert.match(r.ki, /A TSC MEGSZAKADT \(SIGKILL\)/);
    assert.ok(!r.ki.includes("A FEDETT RESZ ZOLD"));
  });

  it("az ideiglenes tsconfig nem marad a munkafan (se zold, se piros futas utan)", () => {
    const { dir, ir } = repo(BAZIS);
    ir(
      "pkg/src/a.ts",
      `${BAZIS["pkg/src/a.ts"]}export const rossz: number = "x";\n`,
    );
    fut(dir);
    const maradt = readdirSync(join(dir, "pkg")).filter((f) =>
      f.startsWith("tsconfig.kapusor-changed"),
    );
    assert.deepEqual(maradt, []);
  });

  it("egy TOROLT TS fajl: a szuro nem lat semmit, kimondja a torlest, es 3-mal lep ki (nem 0)", () => {
    const { dir } = repo(BAZIS);
    rmSync(join(dir, "pkg", "src", "a.ts"));
    const r = fut(dir);
    assert.equal(r.kod, 3, r.ki);
    assert.match(r.ki, /TOROLT TS FAJL \(1\)/);
    assert.match(r.ki, /pkg\/src\/a\.ts/);
    assert.match(r.ki, /NEM FUTOTT TIPUSELLENORZES/);
    // a kontroll: a torles tenyleg eltori a b.ts-t, a teljes tsc ezt lenne
    const teljes = spawnSync(process.execPath, [TSC, "-p", join(dir, "pkg")], {
      encoding: "utf8",
    });
    assert.notEqual(teljes.status, 0);
  });

  it("ha a hivo NODE_OPTIONS-a heap-plafon nelkuli, a plafon a meglevo ele-moge kerul (a tsc is megkapja)", () => {
    const { dir, ir } = repo(BAZIS);
    ir("pkg/src/a.ts", `${BAZIS["pkg/src/a.ts"]}// valtozas\n`);
    const mappa = mkdtempSync(join(tmpdir(), "kapusor-opts-"));
    const naplo = join(mappa, "node-options.txt");
    const figyelo = join(mappa, "figyelo.mjs");
    writeFileSync(
      figyelo,
      `import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (process.argv.includes("--listFiles")) appendFileSync(${JSON.stringify(naplo)}, (process.env["NODE_OPTIONS"] ?? "") + "\\n");
const r = spawnSync(process.execPath, [${JSON.stringify(TSC)}, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
`,
    );
    const r = fut(dir, {
      KAPUSOR_TSC: `${process.execPath} ${figyelo}`,
      NODE_OPTIONS: "--enable-source-maps",
    });
    assert.equal(r.kod, 0, r.ki);
    const latott = readFileSync(naplo, "utf8");
    assert.match(latott, /--enable-source-maps/);
    assert.match(latott, /--max-old-space-size=1536/);
  });

  it("rossz bazis: megnevezi, nem futott semmi, kilepesi kod 2", () => {
    const { dir } = repo(BAZIS);
    const r = spawnSync(
      process.execPath,
      [SZKRIPT, "--changed", "--repo", dir, "--base", "nincs-ilyen-ref"],
      { encoding: "utf8", env: { PATH: HOST_PATH } },
    );
    assert.equal(r.status, 2);
    assert.match(r.stdout, /Nem futott semmi/);
  });
});

describe("kapusor-changed segedfuggvenyek", () => {
  const modul = import(pathToFileURL(MODUL).href) as Promise<{
    csoportosit: (
      f: string[],
      v: (d: string) => boolean,
    ) => {
      csomagok: Map<string, string[]>;
      nemFedett: { fajl: string; ok: string }[];
    };
    szabadMemoriaMB: (d?: string) => number | null;
    heapMB: (s?: string) => number | null;
    nodeOptionsPlafonnal: (s?: string, alapMB?: number) => string;
    ideiglenesNev: (pid?: number) => string;
    programMerete: (k: string, gyoker: string) => number;
  }>;

  it("csoportosit: a legkozelebbi tsconfig a csomag, a nem TS es a tsconfig nelkuli fajl nem fedett", async () => {
    const { csoportosit } = await modul;
    const van = (d: string) => ["apps/api", "packages/types"].includes(d);
    const { csomagok, nemFedett } = csoportosit(
      [
        "apps/api/src/x.ts",
        "apps/api/src/deep/y.tsx",
        "packages/types/src/z.ts",
        "apps/api/prisma/schema.prisma",
        "scripts/tool.ts",
      ],
      van,
    );
    assert.deepEqual([...csomagok.keys()].sort(), [
      "apps/api",
      "packages/types",
    ]);
    assert.deepEqual(csomagok.get("apps/api"), [
      "apps/api/src/x.ts",
      "apps/api/src/deep/y.tsx",
    ]);
    assert.deepEqual(nemFedett.map((n) => n.ok).sort(), [
      "nem TS fajl",
      "nincs csomag-tsconfig",
    ]);
  });

  it("szabadMemoriaMB: korlat minusz hasznalat; 'max' vagy hianyzo fajl: null (nincs mit merni)", async () => {
    const { szabadMemoriaMB } = await modul;
    assert.equal(szabadMemoriaMB(cgroup(1234)), 1234);
    const mappa = cgroup(10);
    writeFileSync(join(mappa, "memory.max"), "max\n");
    assert.equal(szabadMemoriaMB(mappa), null);
    assert.equal(
      szabadMemoriaMB(join(tmpdir(), "nincs-ilyen-mappa-kapusor")),
      null,
    );
  });

  it("nodeOptionsPlafonnal: van plafon: valtozatlan; nincs: a meglevo moge, vagy onalloan; az ideiglenes nev pid-es", async () => {
    const { nodeOptionsPlafonnal, ideiglenesNev } = await modul;
    assert.equal(
      nodeOptionsPlafonnal("--max-old-space-size=900 --x"),
      "--max-old-space-size=900 --x",
    );
    assert.equal(
      nodeOptionsPlafonnal("--enable-source-maps"),
      "--enable-source-maps --max-old-space-size=1536",
    );
    assert.equal(nodeOptionsPlafonnal(undefined), "--max-old-space-size=1536");
    assert.equal(nodeOptionsPlafonnal(""), "--max-old-space-size=1536");
    assert.notEqual(ideiglenesNev(1), ideiglenesNev(2));
  });

  it("heapMB es programMerete", async () => {
    const { heapMB, programMerete } = await modul;
    assert.equal(heapMB("--foo --max-old-space-size=2200"), 2200);
    assert.equal(heapMB(undefined), null);
    const kimenet = [
      "/usr/lib/typescript/lib.es2022.d.ts",
      "/r/pkg/src/a.ts",
      "/r/pkg/src/b.ts",
      "/r/node_modules/x/index.d.ts",
      "/r/pkg/src/a.ts",
      "error TS1: valami",
    ].join("\n");
    // a repo gyokere /r: a node_modules es a repon kivuli lib nem szamit, az ismetlodes egyszer
    assert.equal(programMerete(kimenet, "/r"), 2);
  });
});
