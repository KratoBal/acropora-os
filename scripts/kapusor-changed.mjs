/**
 * `pnpm gates --changed`: A VALTOZOTT FAJLOK TIPUSELLENORZESE, PUSH ELOTT, RESZLEGESEN ES KIMONDVA.
 *
 * MIERT LETEZIK (T6.1, kartya 8b436dcb; acrobot dontese 2026-11-12). A teljes API `tsc` ezen a gepen nem fut le: 2 GB
 * heap mellett OOM, 6 GB mellett a konteiner memoriakorlatja SIGKILL-t ad (merve 2026-11-12). A CI ugyanazt a kapuhoz
 * tartozo teljes tipusellenorzest elvegzi, de egy kor. Ez a szuro a valtozott fajlok tipushibait push ELOTT elkapja,
 * es egy CI-kort sporol.
 *
 * NEM KAPU, ES MINDEN FUTAS KIMONDJA. Egy reszhalmaz zoldje ugyanugy nez ki, mint a teljes futase (ez a `Tasks: N`
 * csapda), ezert a kimenet ELEJEN es VEGEN ott all, hogy reszleges ellenorzes, hany fajlt fed a csomag fajljaibol, es
 * hogy a valtozott fajlokra EPULO fajlokat (egy exportalt tipus vagy fuggveny alairasa megvaltozott) NEM latja. A CI
 * marad a kapu. Ami szinten kimarad: a torolt fajlok, a nem TS fajlok (pl. a Prisma-sema: a generalt kliens a sema
 * utan kulon `prisma generate`), es amit a csomag tsconfigja nem tartalmaz.
 *
 * HOGYAN. Csomagonkent (a legkozelebbi tsconfig.json) a `tsc --showConfig` kiadja a csomag fajlkeszletet, pontosan
 * azt, amit a CI is lat. Ebbol egy ideiglenes tsconfig (`extends` a csomag sajat tsconfigjara, `files`: a valtozott
 * fajlok plusz a csomag `.d.ts` fajljai) fordul `--noEmit --listFiles` mellett. A tsc az importokat kovetve beolvassa a
 * valtozott fajlok fuggosegeit, de CSAK azokat; a program meretebol jon a "hanyat fedtunk" szam.
 *
 * KILEPESI KODOK (egy gep, egy `&&` lanc vagy egy ageens a kodot nezi, nem a szoveget): 0 = a fedett resz zold; 1 = tipushiba,
 * megszakadt a tsc, vagy nem indult el (kevés szabad memoria); 2 = hasznalati hiba / rossz bazis; 3 = NEM FUTOTT
 * TIPUSELLENORZES (nincs valtozott TS fajl, vagy egyik sem esik a csomag fajlkeszletebe). A 3 azert kulon es nem 0: egy
 * torolt TS fajl vagy egy Prisma-sema valtozas eltorhet raepulo fajlokat, es a szuro ilyenkor "nincs mit nezni"-t mond;
 * az nem zold, tehat nem lehet 0.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

/** FOLYAMAT-AZONOSITOS nev: ket parhuzamos futas ugyanabban a munkafaban nem irja felul egymas ideiglenes konfigjat. */
export const ideiglenesNev = (pid = process.pid) =>
  `tsconfig.kapusor-changed-${pid}.json`;
const TS_KITERJESZTES = /\.(ts|tsx)$/;
/**
 * A heap-plafon, ha a hivo nem adott sajatot. Merve 2026-11-12 (apps/api, egy valtozott fajl: 7 repo-fajl a
 * programban) 900 MB elegendo volt; a Prisma-kliens tipusait is olvaso, nagyobb import-halmaz tobbet kerhet, ezert
 * az alapertek 1,5 GB. Felulirhato: NODE_OPTIONS=--max-old-space-size=<MB>.
 */
const ALAPERTELMEZETT_HEAP_MB = 1536;
/** A heap-plafonon felul a tsc folyamatnak es a nodenak ennyi ujabb MB kell (a mert ertek durva felso kozelitese). */
const FOLYAMAT_ELLENSULY_MB = 300;

/**
 * A SZABAD MEMORIA, A KONTEINER CGROUP-KORLATJABOL (MB), vagy null, ha nem olvashato / nincs korlat.
 *
 * MIERT KELL: a konteiner korlatja (4,7 GB) a flottaval kozos. Ha a tsc a korlatot a sajat heap-plafona ELOTT eri el,
 * a kernel OOM-killere dont arrol, melyik folyamatot oli ki, es az nem feltetlenul a tsc: egy masik ageens munkamenete
 * is lehet. Ezert a szuro NEM INDUL el, ha nincs meg a heap-plafonnak megfelelo szabad hely. Egy elmaradt futas
 * kimondva, nem egy kiolt masik folyamat.
 */
export function szabadMemoriaMB(cgroupMappa = "/sys/fs/cgroup") {
  try {
    const max = readFileSync(join(cgroupMappa, "memory.max"), "utf8").trim();
    if (max === "max") return null;
    const hasznalt = Number(
      readFileSync(join(cgroupMappa, "memory.current"), "utf8").trim(),
    );
    const korlat = Number(max);
    if (!Number.isFinite(hasznalt) || !Number.isFinite(korlat)) return null;
    return Math.floor((korlat - hasznalt) / (1024 * 1024));
  } catch {
    return null;
  }
}

/**
 * A NODE_OPTIONS HEAP-PLAFONNAL: ha a hivo mar allitott NODE_OPTIONS-t, de nincs benne heap-plafon (pl. csak
 * `--enable-source-maps`), a plafon a meglevo ele-moge kerul. Enelkul a tsc a V8 sajat plafonjaval futna, a memoria-kapu
 * viszont a 1,5 GB-os alapertek alapjan dont, es pont az nyilna ki, ami ellen a kapu all.
 */
export function nodeOptionsPlafonnal(
  nodeOptions,
  alapMB = ALAPERTELMEZETT_HEAP_MB,
) {
  if (heapMB(nodeOptions) !== null) return nodeOptions;
  const plafon = `--max-old-space-size=${alapMB}`;
  return nodeOptions ? `${nodeOptions} ${plafon}` : plafon;
}

/** A `--max-old-space-size=<MB>` erteke a NODE_OPTIONS-bol, vagy null. */
export function heapMB(nodeOptions) {
  const talalat = /--max-old-space-size=(\d+)/.exec(nodeOptions ?? "");
  return talalat ? Number(talalat[1]) : null;
}

export const NYILATKOZAT =
  "RESZLEGES ELLENORZES, NEM KAPU. Csak a valtozott fajlokat es az importjaikat nezi; a rajuk EPULO fajlokat\n" +
  "(ahol egy exportalt tipus vagy fuggveny alairasa megvaltozott), a torolt fajlokat es a nem TS fajlokat NEM latja.\n" +
  "A CI a kapu.";

/**
 * A valtozott fajlok csoportositasa csomagok szerint.
 * `tsconfigVan(dir)`: van-e ott tsconfig.json (kivulrol jon, hogy a fuggveny tiszta maradjon).
 * A fajl nem TS: `nemFedett` (ok: "nem TS"). Nincs csomag-tsconfig a fajl folott: `nemFedett` ("nincs tsconfig").
 */
export function csoportosit(fajlok, tsconfigVan) {
  const csomagok = new Map();
  const nemFedett = [];
  for (const fajl of fajlok) {
    if (!TS_KITERJESZTES.test(fajl)) {
      nemFedett.push({ fajl, ok: "nem TS fajl" });
      continue;
    }
    let dir = dirname(fajl);
    let talalt = null;
    for (;;) {
      if (dir !== "." && tsconfigVan(dir)) {
        talalt = dir;
        break;
      }
      if (dir === "." || dir === "/" || dirname(dir) === dir) break;
      dir = dirname(dir);
    }
    if (talalt === null) {
      nemFedett.push({ fajl, ok: "nincs csomag-tsconfig" });
      continue;
    }
    csomagok.set(talalt, [...(csomagok.get(talalt) ?? []), fajl]);
  }
  return { csomagok, nemFedett };
}

/**
 * Az ideiglenes tsconfig tartalma: a csomag sajat tsconfigjara epul, a fajlkeszlet a valtozott fajlok (a csomag
 * fajlkeszletebol) plusz a csomag `.d.ts` fajljai (a globalis deklaraciok nelkul hamis hibak jonnek).
 * Visszaad: { tsconfig, fedett, nemFedett } -- a `csomagFajlok` a `tsc --showConfig` `files` listaja, a csomag
 * mappajahoz viszonyitva.
 */
export function ideiglenesTsconfig(valtozott, csomagFajlok) {
  const kulcs = (f) => f.replace(/^\.\//, "");
  const lista = new Set(csomagFajlok.map(kulcs));
  const fedett = valtozott.filter((f) => lista.has(kulcs(f)));
  const nemFedett = valtozott.filter((f) => !lista.has(kulcs(f)));
  const deklaraciok = [...lista].filter((f) => f.endsWith(".d.ts"));
  return {
    tsconfig: {
      extends: "./tsconfig.json",
      compilerOptions: { noEmit: true, incremental: false },
      // a `include` is ORZODIK a csomag tsconfigjabol: ures lista nelkul az EGESZ csomag a programba kerulne (merve: 3/3 fajl)
      include: [],
      files: [...new Set([...fedett.map(kulcs), ...deklaraciok])],
    },
    fedett,
    nemFedett,
  };
}

/** A `tsc --listFiles` kimenetebol a repon BELULI, nem node_modules-beli TS fajlok szama (a program merete). */
export function programMerete(kimenet, gyoker) {
  const elo = gyoker.endsWith(sep) ? gyoker : gyoker + sep;
  return new Set(
    kimenet
      .split("\n")
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.startsWith(elo) &&
          !s.includes(`${sep}node_modules${sep}`) &&
          TS_KITERJESZTES.test(s),
      ),
  ).size;
}

function git(gyoker, argumentumok) {
  const r = spawnSync("git", argumentumok, {
    cwd: gyoker,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { kod: r.status, ki: r.stdout ?? "", hiba: r.stderr ?? "" };
}

/** A valtozott fajlok: a merge-base ota commitolt + a munkafa valtozasai + a nem kovetett fajlok. A torlesek NEM. */
export function valtozottFajlok(gyoker, bazis) {
  const mb = git(gyoker, ["merge-base", "HEAD", bazis]);
  if (mb.kod !== 0)
    return {
      hiba: `a(z) ${bazis} bazis nem oldhato fel (git merge-base): ${mb.hiba.trim()}`,
    };
  const valtozas = git(gyoker, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    mb.ki.trim(),
  ]);
  const uj = git(gyoker, ["ls-files", "--others", "--exclude-standard"]);
  const torolt = git(gyoker, [
    "diff",
    "--name-only",
    "--diff-filter=D",
    mb.ki.trim(),
  ]);
  if (valtozas.kod !== 0 || uj.kod !== 0 || torolt.kod !== 0)
    return { hiba: `git hiba: ${(valtozas.hiba + uj.hiba).trim()}` };
  const fajlok = [
    ...new Set(
      [...valtozas.ki.split("\n"), ...uj.ki.split("\n")].filter(Boolean),
    ),
  ].sort();
  return {
    fajlok,
    mergeBase: mb.ki.trim(),
    // a torolt TS fajlok: a szuro NEM nezi, de a rajuk epulok eltorhetnek, ezert kimondja
    toroltTs: torolt.ki.split("\n").filter((f) => TS_KITERJESZTES.test(f)),
  };
}

/**
 * A tsc parancsa. KOZVETLENUL a typescript csomag binarisa (`node <tsc.js>`), NEM `pnpm exec`: a pnpm elnyeli a
 * gyermek jelzet (SIGKILL/SIGABRT), es sima `1` kilepesi koddal, hibasorok nelkul ter vissza -- egy megszakadt futas
 * ugy neznne ki, mint egy ismeretlen okbol bukott. Felulirhato: `KAPUSOR_TSC="<parancs>"` (a teszt ezt hasznalja).
 */
function tscParancs(env, cwd) {
  if (env.KAPUSOR_TSC) {
    const [exe, ...elore] = env.KAPUSOR_TSC.split(/\s+/);
    return { exe, elore };
  }
  const bin = createRequire(join(cwd, "package.json")).resolve(
    "typescript/bin/tsc",
  );
  return { exe: process.execPath, elore: [bin] };
}

/**
 * A futas: kiirja a nyilatkozatot, csomagonkent lefuttatja a szuk ellenorzest, kiirja az osszesitest.
 * Kilepesi kod: 0 a fedett resz zold; 1 tipushiba, megszakadt a tsc vagy nem indult el; 2 hasznalati hiba; 3 NEM FUTOTT
 * tipusellenorzes (lasd a fajl fejleceben).
 */
export function main(argumentumok, kornyezet = process.env, ki = console.log) {
  let gyoker = process.cwd();
  let bazis = "origin/main";
  for (let i = 0; i < argumentumok.length; i += 1) {
    if (argumentumok[i] === "--base") bazis = argumentumok[(i += 1)] ?? "";
    else if (argumentumok[i] === "--repo")
      gyoker = argumentumok[(i += 1)] ?? "";
  }
  if (!bazis || !gyoker) {
    ki("HASZNALAT: kapusor.mjs --changed [--base <ref, alap: origin/main>]");
    ki(
      "KILEPESI KOD: 0 a fedett resz zold; 1 hiba/megszakadt/nem indult el; 2 hasznalati hiba; 3 NEM FUTOTT tipusellenorzes.",
    );
    return 2;
  }

  ki(NYILATKOZAT);
  ki("");
  const valtozas = valtozottFajlok(gyoker, bazis);
  if (valtozas.hiba) {
    ki(`HIBA: ${valtozas.hiba}`);
    ki("Nem futott semmi. Ez NEM zold eredmeny.");
    return 2;
  }

  const { csomagok, nemFedett } = csoportosit(valtozas.fajlok, (dir) =>
    existsSync(join(gyoker, dir, "tsconfig.json")),
  );
  ki(
    `bazis: ${bazis} (merge-base ${valtozas.mergeBase.slice(0, 9)}), ${valtozas.fajlok.length} valtozott/uj fajl, ebbol ${[...csomagok.values()].flat().length} TS fajl ${csomagok.size} csomagban`,
  );

  const env = {
    ...kornyezet,
    NODE_OPTIONS: nodeOptionsPlafonnal(kornyezet.NODE_OPTIONS),
  };
  // csak akkor van mit nezni, ha van TS fajl; a memoria-kaput a tenyleges futas elott kell atengedni
  if (csomagok.size > 0) {
    const szabad = szabadMemoriaMB(kornyezet.KAPUSOR_CGROUP_DIR);
    const kell =
      (heapMB(env.NODE_OPTIONS) ?? ALAPERTELMEZETT_HEAP_MB) +
      FOLYAMAT_ELLENSULY_MB;
    if (szabad !== null && szabad < kell) {
      ki(
        `NEM INDULT EL: a konteiner szabad memoriaja ${szabad} MB, a tsc-hez (heap-plafon ${heapMB(env.NODE_OPTIONS) ?? ALAPERTELMEZETT_HEAP_MB} MB + folyamat) ${kell} MB kell.`,
      );
      ki(
        "Ha elindulna, a kernel egy MASIK folyamatot is kiolhetne a flotta kozos korlatjan belul. Ez NEM zold eredmeny: nem futott tipusellenorzes.",
      );
      ki(
        "Probald ujra, ha a flotta memoriaja felszabadult (a szabad hely a konteneren kozos); a CI a kapu.",
      );
      return 1;
    }
  }
  const futtat = (cwd, argumentumok2) => {
    const { exe, elore } = tscParancs(kornyezet, cwd);
    return spawnSync(exe, [...elore, ...argumentumok2], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  };

  let bukott = false;
  let fedettOsszes = 0;
  const kimaradt = [...nemFedett];

  for (const [dir, fajlokRepo] of csomagok) {
    const cwd = join(gyoker, dir);
    const valtozott = fajlokRepo.map((f) => relative(dir, f));

    const beallitas = futtat(cwd, ["--showConfig", "-p", "tsconfig.json"]);
    if (beallitas.status !== 0) {
      ki(
        `${dir}: A CSOMAG TSCONFIGJA NEM OLVASHATO (tsc --showConfig kod ${beallitas.status}).`,
      );
      ki(`${beallitas.stdout ?? ""}${beallitas.stderr ?? ""}`.trim());
      bukott = true;
      continue;
    }
    let csomagFajlok;
    try {
      csomagFajlok = JSON.parse(beallitas.stdout).files ?? [];
    } catch {
      ki(
        `${dir}: a tsc --showConfig kimenete nem JSON; a csomag nem ellenorizheto.`,
      );
      bukott = true;
      continue;
    }

    const terv = ideiglenesTsconfig(valtozott, csomagFajlok);
    for (const f of terv.nemFedett)
      kimaradt.push({
        fajl: join(dir, f),
        ok: "a csomag tsconfigja nem tartalmazza",
      });
    if (terv.fedett.length === 0) {
      ki(
        `${dir}: nincs a csomag fajlkeszletebe eso valtozott fajl, nem futott semmi.`,
      );
      continue;
    }

    const nev = ideiglenesNev();
    const ideiglenes = join(cwd, nev);
    writeFileSync(ideiglenes, JSON.stringify(terv.tsconfig, null, 2));
    let r;
    try {
      r = futtat(cwd, ["-p", nev, "--noEmit", "--listFiles"]);
    } finally {
      rmSync(ideiglenes, { force: true });
    }
    const kimenet = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const program = programMerete(kimenet, gyoker);
    fedettOsszes += terv.fedett.length;

    const memoria = /heap out of memory|Allocation failed/.test(kimenet);
    if (r.status === null || memoria) {
      ki(
        `${dir}: A TSC MEGSZAKADT (${r.signal ?? (memoria ? "JS memoria-hiba" : "ismeretlen jel")}), a memoriakorlat miatt (heap-plafon: ${env.NODE_OPTIONS}).` +
          " Ez NEM zold eredmeny. Tobb memoriaval: NODE_OPTIONS=--max-old-space-size=<MB> a parancs elott, a konteiner szabad memoriajan belul.",
      );
      bukott = true;
      continue;
    }
    // a hibasorokat a fajllista nelkul mutatjuk: a `--listFiles` kimenet utvonalsorai nem hibak
    const hibak = kimenet.split("\n").filter((s) => /error TS\d+/.test(s));
    ki(
      `${dir}: ${terv.fedett.length} valtozott fajl, a program ${program} repo-fajlt tartalmazott a csomag ${csomagFajlok.length} fajljabol; ` +
        `a maradek ${Math.max(csomagFajlok.length - program, 0)} fajlt NEM nezte (koztuk a valtozottakra epuloket).`,
    );
    if (r.status !== 0) {
      for (const sor of hibak) ki(`  ${sor}`);
      ki(`  BUKOTT (tsc kilepesi kod ${r.status}, ${hibak.length} hibasor).`);
      bukott = true;
    } else ki("  zold (a fedett resz)");
  }

  if (valtozas.toroltTs.length > 0) {
    ki("");
    ki(
      `TOROLT TS FAJL (${valtozas.toroltTs.length}), a szuro NEM nezi, a rajuk epulo fajlok eltorhetnek:`,
    );
    for (const f of valtozas.toroltTs) ki(`  ${f}`);
  }
  if (kimaradt.length > 0) {
    ki("");
    ki(`NEM FEDETT (${kimaradt.length}):`);
    for (const { fajl, ok } of kimaradt) ki(`  ${fajl}  [${ok}]`);
  }
  ki("");
  if (csomagok.size === 0 || fedettOsszes === 0) {
    ki(
      "NEM FUTOTT TIPUSELLENORZES: nincs TS fajl, amit ez a szuro nezhetne. Ez NEM zold kapu.",
    );
    ki(NYILATKOZAT);
    // 3: nem futott tipusellenorzes. Ha kozben valami bukott (pl. egy csomag tsconfigja nem olvashato), az 1.
    return bukott ? 1 : 3;
  }
  ki(
    bukott
      ? "VOLT BUKAS -- lasd fent. (Reszleges ellenorzes, a CI a kapu.)"
      : `A FEDETT RESZ ZOLD: ${fedettOsszes} valtozott fajl. (Reszleges ellenorzes, a CI a kapu; a rajuk epulo fajlokat nem latta.)`,
  );
  return bukott ? 1 : 0;
}
