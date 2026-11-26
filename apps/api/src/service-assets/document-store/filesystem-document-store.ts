import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { Logger } from "@nestjs/common";

import {
  DOCUMENT_OWNERS,
  ownerDirectory,
  type DocumentKey,
  type DocumentOwner,
  type DocumentStore,
  type DocumentStoreStatus,
} from "./document-store.js";

/**
 * FÁJLRENDSZERES DOKUMENTUM-TÁROLÓ: a bájtok egy csatolt könyvtárba kerülnek,
 * `<gazda>/<ownerId>/<documentId>` néven (ma `assets/` és `worksheets/`).
 *
 * AZ ÍRÁS HÁROM LÉPÉSBEN MEGY, és a sorrend nem stílus kérdése:
 * ideiglenes névre írunk, `fsync`-elünk, és csak azután nevezzük át a végleges
 * névre. Az átnevezés ugyanazon a fájlrendszeren atomi, tehát a végleges néven
 * SOHA nem keletkezik félig megírt fájl. Aki közvetlenül a végleges névre írna,
 * annak egy megszakadt írás után egy csonka, de LÉTEZŐ fájlja maradna -- és a
 * hívó azt nem tudja megkülönböztetni az éptől, mert a hossz maga is adat.
 *
 * AZ IDEIGLENES FÁJL UGYANABBAN A KÖNYVTÁRBAN KELETKEZIK. Egy közös átmeneti
 * könyvtár (például `/tmp`) más fájlrendszeren állhat, és akkor az átnevezés
 * nem átnevezés, hanem másolás plusz törlés: pontosan az az atomiság vész el,
 * amiért az egész alak készül.
 */
export class FilesystemDocumentStore implements DocumentStore {
  private readonly root: string;
  private readonly logger = new Logger(FilesystemDocumentStore.name);

  /** `isMountPoint`: whether the root is a mounted volume (the default reads the kernel's mount table; a test passes its own). */
  /**
   * `isMountPoint`: whether the root is a mounted volume (the default reads the kernel's mount table). `startedAtMs`: when this
   * process started (the default); a document older than it was on the volume before this run. A test passes its own.
   */
  constructor(
    rootDirectory: string,
    private readonly isMountPoint: (
      root: string,
    ) => Promise<boolean> = rootIsMountPoint,
    private readonly startedAtMs: number = PROCESS_STARTED_AT_MS,
  ) {
    this.root = path.resolve(rootDirectory);
  }

  async put(key: DocumentKey, bytes: Uint8Array): Promise<void> {
    const target = this.resolveWithin(key);
    await mkdir(path.dirname(target), { recursive: true });

    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx");
      try {
        await handle.write(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      // Az ideiglenes fájl a HIBA ÚTJÁN is eltűnik, különben minden megszakadt
      // írás hagyna egy szemetet, amit senki nem takarít el. A törlés hibáját
      // elnyeljük: az eredeti hiba a fontosabb, azt nem szabad elfednie.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(key: DocumentKey): Promise<Uint8Array | null> {
    try {
      // A `readFile` BUFFER-t ad, a port viszont `Uint8Array`-t igér, és a
      // kettő nem ugyanaz: a `Buffer` alosztály, tehát egy szigorú mély
      // összehasonlítás megkülönbözteti őket. Ha ezt itt nem alakítjuk vissza,
      // a két megvalósítás CSENDBEN tér el egymástól -- ugyanaz a hiba, amit a
      // memóriabeli változatnál a másolás előz meg. A teszt mérte, nem én
      // láttam előre.
      return new Uint8Array(await readFile(this.resolveWithin(key)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  /**
   * A MERET A `stat`-bol, NEM a fajl beolvasasabol.
   *
   * Egy `get()`-tel is meg lehetne allapitani, de az MINDEN bajtot behozna a
   * memoriaba, es az egyeztetes epp azon a koteten fut, ahol sok ezer fajl all.
   * Egy mereszkoz, ami elszall a nagy bemeneten, akkor mond csodot, amikor a
   * legnagyobb szukseg lenne ra -- ugyanaz az indok, amiert a `list()` folyam.
   *
   * A HIANYZO FAJL `null`, nem kivetel: a hivo mar tudja a kulcsot a `list()`
   * folyambol, tehat ha kozben eltunt, az VERSENYHELYZET, nem hiba. A `null`
   * ezt mondja el, es a futtato meg tudja kulonboztetni.
   */
  async size(key: DocumentKey): Promise<number | null> {
    try {
      const entry = await stat(this.resolveWithin(key));
      return entry.isFile() ? entry.size : null;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async delete(key: DocumentKey): Promise<boolean> {
    try {
      await rm(this.resolveWithin(key));
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  /**
   * A TÁROLÓBAN ÁLLÓ FÁJLOK, KÉT SZINT MÉLYEN BEJÁRVA.
   *
   * AZ ELRENDEZÉS `assets/<assetId>/<documentId>`, tehát a bejárás pontosan
   * két szintet megy, nem rekurzívan: egy mélyebb fájl nem a mi
   * elrendezésünkből származik, és ha csendben beleszámolnánk, egy idegen
   * könyvtár tartalma „elárvult fájlnak" látszana.
   *
   * AZ IDEIGLENES FÁJLOKAT KIHAGYJA. Egy `.tmp` végű név egy FUTÓ írás
   * közepe, nem elárvult fájl: ha beleszámolna, minden párhuzamos feltöltés
   * hamis leletet gyártana, és három ilyen után senki nem nézné meg a listát.
   *
   * ÉS EZ EGY KORLÁT, NEM CSAK EGY SZŰRŐ -- kiírva, mert javítani ma nem
   * tudjuk. Egy `.tmp` fájl KÉT különböző dolog lehet:
   *
   * 1. egy futó írás közepe (ezt védi a kihagyás), és
   * 2. egy MEGSZAKADT írásból ottmaradt törzs, ha a folyamat magát a `rename`
   *    előtt ölték meg. A `put` hibaága takarít, tehát egy elhasalt HÍVÁS nem
   *    hagy ilyet -- csak egy megölt vagy összeomlott FOLYAMAT.
   *
   * A második valódi szemét, helyet foglal, és ez a lista SOHA nem fogja
   * jelenteni. **Aki egyszer helyhiányt keres, itt nem talál semmit, és ez a
   * mondat mondja meg neki, hogy hol nem nézett meg semmi.**
   *
   * MIÉRT NINCS RÁ IDŐHATÁR: a kettőt csak az ÉLETKOR különbözteti meg, és ma
   * nem tudnánk megmondani, mennyi a jó szám. Egy önkényes határ vagy futó
   * írásokat jelentene leletként, vagy a szemetet hagyná láthatatlanul --
   * mérés nélkül mindkettő találgatás. Ha kiderül, hogy ez tényleg foglal,
   * akkor lesz mérésünk hozzá, és akkor lehet határt választani.
   *
   * NEM CSATOLT VAGY HIÁNYZÓ GYÖKÉR ESETÉN ÜRES A VÁLASZ, nem kivétel: a
   * beállítottság kérdését a `describe()` méri, és két helyen felelni rá annyit
   * tenne, hogy a hívó két különböző választ kaphat ugyanarra.
   */
  async *list(): AsyncIterable<DocumentKey> {
    /**
     * MINDEN ISMERT GAZDA GYOKERE, ES CSAK AZ.
     *
     * A bejaras a ZART halmazon megy vegig, nem azon, ami a lemezen all. Egy
     * idegen konyvtar (kezzel odamasolt adat, egy regi elrendezes maradeka)
     * igy NEM latszik elarvult fajlkent -- es ez helyes: a lista a MI
     * elrendezesunkrol szol, nem arrol, mi van meg azon a koteten.
     */
    for (const owner of DOCUMENT_OWNERS) {
      yield* this.listOwner(owner);
    }
  }

  private async *listOwner(owner: DocumentOwner): AsyncIterable<DocumentKey> {
    const ownerRoot = path.join(this.root, ownerDirectory(owner));
    let ownerDirectories;
    try {
      // AZ `opendir` EGYESEVEL AD, a `readdir` egyben olvassa be az egesz
      // konyvtarat. Sok ezer bejegyzesnel a masodik magat a merest teszi
      // kockazatta -- epp azt, aminek a baj MEGTALALASA a dolga.
      ownerDirectories = await opendir(ownerRoot);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }

    for await (const entry of ownerDirectories) {
      if (!entry.isDirectory()) continue;
      const documents = await opendir(path.join(ownerRoot, entry.name));
      for await (const document of documents) {
        if (!document.isFile()) continue;
        if (document.name.endsWith(".tmp")) continue;
        yield { owner, ownerId: entry.name, documentId: document.name };
      }
    }
  }

  /**
   * A TÁROLÓ AKKOR ÉS CSAK AKKOR BEÁLLÍTOTT, HA A JELÖLŐ OTT VAN ÉS A KÖNYVTÁR
   * ÍRHATÓ.
   *
   * A JELÖLŐT AZ ALKALMAZÁS SOHA NEM HOZZA LÉTRE, és ez a szakasz lényege. Ha
   * létrehozná, akkor egy NEM csatolt könyvtárban is létrejönne (a csatolási
   * pont üres könyvtára ugyanolyan írható, mint a csatolt kötet), és a védelem
   * MINDIG zöld lenne. Egy ellenőrzés, ami nem tud elbukni, díszlet: úgy néz
   * ki, mintha mérnénk, közben a fájlok a hoszt lemezére mennek, és a következő
   * újraindítás elviszi őket.
   *
   * A jelölőt a telepítés teszi le, a csatolt köteten belül. Ez a
   * végrehajtási sorrend 8. lépése, és más keze kell hozzá.
   *
   * A HÁROM ÁLLAPOT NEM UGYANAZ A HIBA: a hiányzó jelölő azt jelenti, hogy
   * senki nem csatolta a kötetet (`not-configured`, telepítési kérdés); az
   * írhatatlan vagy nem könyvtár gyökér azt, hogy ott VAN valami, de nem
   * használható (`broken`, jogosultsági kérdés). A kettőt más ember oldja fel,
   * ezért nem szabad egy közös „nem működik" alá vonni őket.
   */
  async describe(): Promise<DocumentStoreStatus> {
    let entry;
    try {
      entry = await stat(this.root);
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          state: "not-configured",
          reason: `A tároló gyökere nem létezik: ${this.root}`,
        };
      }
      throw error;
    }

    if (!entry.isDirectory()) {
      return {
        state: "broken",
        reason: `A tároló gyökere nem könyvtár: ${this.root}`,
      };
    }

    try {
      await access(path.join(this.root, MARKER_FILE), constants.F_OK);
    } catch {
      const missing = await this.markerMissing();
      if (missing) return missing;
    }

    // AZ ÍRHATÓSÁG A JELÖLŐ UTÁN JÖN, és a sorrend számít: egy csatolt, de
    // írásvédett kötet MÁS hiba, mint egy nem csatolt könyvtár, és ha az
    // írhatóságot néznénk előbb, a nem csatolt eset is `broken`-nek látszana.
    try {
      await access(this.root, constants.W_OK);
    } catch {
      return {
        state: "broken",
        reason: `A tároló gyökere nem írható: ${this.root}`,
      };
    }

    return { state: "ready" };
  }

  /**
   * A HIÁNYZÓ JELÖLŐ, AMIKOR A GYÖKÉR BIZONYÍTOTTAN CSATOLT KÖTET (kártya 0c122c27).
   *
   * A jelölő azt bizonyítja, hogy a kötet csatolva van: egy NEM csatolt, üres csatolási pont ugyanolyan írható, ezért az
   * alkalmazás magától nem teheti le (fent). Csakhogy a jelölőt el lehet veszíteni úgy, hogy a kötet és az adat végig ott
   * van: 2026-11-25-én a teszt OS tárolója egy újratelepítés után `not-configured` lett, és root kellett a visszatételéhez.
   *
   * A csatoltságot a jelölő NÉLKÜL is meg lehet mérni: a kernel csatolási táblája (`/proc/self/mountinfo`) megmondja, hogy
   * a gyökér maga csatolási pont-e. Ha az, a jelölő hiánya nem a csatolás hiánya, és pótolható: ez nem gyengíti a védelmet,
   * mert egy nem csatolt könyvtár NEM csatolási pont, és ott a válasz továbbra is `not-configured`. A pótlás hangos: a napló
   * figyelmeztet, mert egy eltűnt jelölő oka maga is kérdés.
   *
   * `null`: a jelölő pótolva, mehet tovább az írhatóság mérésére; különben a válasz.
   */
  private async markerMissing(): Promise<DocumentStoreStatus | null> {
    const marker = path.join(this.root, MARKER_FILE);
    if (!(await this.isMountPoint(this.root).catch(() => false))) {
      return {
        state: "not-configured",
        reason: `A jelölő fájl hiányzik, és a tároló gyökere nem csatolási pont, tehát a kötet nincs csatolva: ${marker}`,
      };
    }
    /*
      CSAK HA A KÖTETEN MÁR A FUTÁS ELŐTT IS VOLT ADAT (barracuda, #3057): egy ROSSZ, üres kötet is csatolási pont (a Coolify
      egy újratelepítésnél más néven újat hoz létre, vagy a név elírva). Ha arra is letenné, minden új dokumentum oda menne,
      a régiek pedig hiányoznának: az adat kettéválna. A 2026-11-25-i eset más volt: a kötet és a régi adat ott volt, csak a
      jelölő veszett el. A kettőt az választja szét, hogy van-e a köteten e folyamat indulása ELŐTT írt dokumentum. A "van-e
      adat" kevés lenne: több hívó (számla, sztornó, ajánlat, üzenet) állapot-kérdés nélkül ír, tehát egy rossz kötetre az első
      írás után már lenne "adat"; a futás előtti viszont nem lehet rajta.
    */
    if (!(await this.holdsDocumentFromBefore())) {
      return {
        state: "not-configured",
        reason: `A tároló gyökere csatolt kötet, de jelölő nélküli, és nincs rajta e futás előtti dokumentum (üres vagy új kötet): első beállításnál a jelölőt kézzel kell letenni: ${marker}`,
      };
    }
    try {
      // `wx`: egy közben letett jelölőt nem ír felül
      const handle = await open(marker, "wx");
      await handle.close();
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "EEXIST"
      )) {
        return {
          state: "broken",
          reason: `A tároló gyökere csatolt kötet, de a hiányzó jelölő nem pótolható (${(error as { code?: string }).code ?? "ismeretlen hiba"}): ${marker}`,
        };
      }
    }
    this.logger.warn(
      `A dokumentumtár jelölője hiányzott, a gyökér csatolt kötet, ezért pótoltam: ${marker}. Aki vagy ami törölte, azt meg kell keresni.`,
    );
    return null;
  }

  /** Whether a document of our layout on the volume was written before this process started (the first one found ends it). */
  private async holdsDocumentFromBefore(): Promise<boolean> {
    for await (const key of this.list()) {
      const entry = await stat(this.resolveWithin(key)).catch(() => null);
      if (entry && entry.mtimeMs < this.startedAtMs) return true;
    }
    return false;
  }

  /**
   * AZ ÚTVONAL A GYÖKÉR ALATT MARAD, VAGY NINCS MŰVELET.
   *
   * MIÉRT NEM ELÉG A SZÖVEGES ELLENŐRZÉS: egy `..` szegmens, egy abszolút
   * azonosító vagy egy perjeles azonosító mind a gyökér FÖLÉ vihet, és a három
   * eset szövegesen máshogy néz ki. A `resolve` mindegyiket ugyanarra a
   * kérdésre vezeti vissza: hol van a fájl VALÓJÁBAN. A `relative` pedig
   * megmondja, hogy az kívül esik-e -- ha igen, `..`-vel kezdődik, vagy maga is
   * abszolút.
   */
  private resolveWithin(key: DocumentKey): string {
    const target = path.resolve(
      this.root,
      ownerDirectory(key.owner),
      key.ownerId,
      key.documentId,
    );
    const relative = path.relative(this.root, target);

    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `A dokumentum útvonala a tároló gyökerén kívülre mutat: ${ownerDirectory(key.owner)}/${key.ownerId}/${key.documentId}`,
      );
    }

    return target;
  }
}

/**
 * A JELÖLŐ FÁJL NEVE. Pontos névvel szerepel a telepítési lépésben is: ha a
 * kettő eltér, a tároló minden indulásnál `not-configured`, és a hiba a
 * legrosszabb helyen derül ki, a felhasználó első feltöltésénél.
 */
export const MARKER_FILE = ".acropora-document-store";

/** When this process started: a document older than this was on the volume before this run. */
const PROCESS_STARTED_AT_MS = Date.now() - process.uptime() * 1000;

/**
 * The mount points in `/proc/self/mountinfo` (its fifth field; the kernel writes a space, a tab, a newline and a backslash
 * in a path as an octal escape).
 */
export function mountPointsFrom(mountinfo: string): Set<string> {
  const points = new Set<string>();
  for (const line of mountinfo.split("\n")) {
    const field = line.split(" ")[4];
    if (field)
      points.add(
        field.replace(/\\([0-7]{3})/g, (_m, octal: string) =>
          String.fromCharCode(parseInt(octal, 8)),
        ),
      );
  }
  return points;
}

/**
 * Whether a directory is itself a mount point: on the kernel's mount table when it can be read, else (no /proc) by its
 * device against its parent's (a mounted volume is another device than the directory it is mounted into).
 */
export async function rootIsMountPoint(root: string): Promise<boolean> {
  const real = await realpath(root);
  try {
    return mountPointsFrom(await readFile("/proc/self/mountinfo", "utf8")).has(
      real,
    );
  } catch {
    const [self, parent] = await Promise.all([
      stat(real),
      stat(path.dirname(real)),
    ]);
    return real !== path.dirname(real) && self.dev !== parent.dev;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
