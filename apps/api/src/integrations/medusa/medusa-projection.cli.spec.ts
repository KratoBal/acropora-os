import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  describeSkuLookupFailure,
  describePublication,
  MEDUSA_PROJECTION_FALLBACK_NOTICE,
  medusaClientForProjection,
  runProjectionCli,
} from "./medusa-projection.cli.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import type { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import type { MedusaConnectionSettingRecord } from "./medusa-connection.types.js";

/**
 * A VETÍTÉS A TÁROLT KULCSOT HASZNÁLJA, mérve.
 *
 * A kör állítása egyetlen mondat: a vetítés a kulcs környezeti vagy parancssori
 * átadása NÉLKÜL is lefut, tehát a titok többé nem kerül a héj előzményeibe és a
 * folyamatlistába. A cím marad a környezetben, mert az nem titok.
 *
 * A VALÓDI hitelesítő-szolgáltató és a VALÓDI kliens-gyár fut ezekben a
 * tesztekben, csak a tároló sora és a `fetch` hamis. Egy saját hamis kliens
 * pontosan azt az utat nem mérné, ami itt a tét: a kulcsot ezért a KIMENŐ
 * FEJLÉCBŐL olvassuk vissza, mert az az egyetlen hely, ahol az látszik, amit a
 * kliens tényleg használt.
 */

const STORED = "sk_tarolt_kulcs_a_tarolobol";
const ENVIRONMENT_KEY = "sk_kornyezeti_tartalek";
const MASTER_KEY = Buffer.alloc(32, 5).toString("base64");

/**
 * ASZINKRON, és ez nem részletkérdés: szinkron `finally` mellett a változók
 * eltűnnének, mielőtt a mért hívás lefut. (A hitelesítő-szolgáltató specjében
 * ez egyszer már pirosra váltott, méghozzá MÁS hibakóddal, mint amit mér.)
 */
async function withEnvironment<T>(
  environment: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const before = { ...process.env };
  for (const [key, value] of Object.entries(environment))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;

  try {
    return await run();
  } finally {
    for (const key of Object.keys(environment))
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
  }
}

/** A cím kell, a mesterkulcs kell, a titok NEM: pont ez a kör állítása. */
const withoutEnvironmentKey = {
  MEDUSA_ADMIN_URL: "https://pelda.invalid",
  MEDUSA_ADMIN_API_KEY: undefined,
  MEDUSA_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  MEDUSA_CREDENTIAL_MASTER_KEY_V1: MASTER_KEY,
};

const withEnvironmentKey = {
  ...withoutEnvironmentKey,
  MEDUSA_ADMIN_API_KEY: ENVIRONMENT_KEY,
};

function collector() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: {
      stdout: (value: string) => void stdout.push(value),
      stderr: (value: string) => void stderr.push(value),
    },
  };
}

/** A kimenő fejlécből visszaolvasott kulcs, nem a paraméterből. */
function recordingFetch(seenKeys: string[]): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const header = (init?.headers as Record<string, string> | undefined)
      ?.authorization;
    const decoded = Buffer.from(
      (header ?? "").replace(/^Basic /, ""),
      "base64",
    ).toString("utf8");
    seenKeys.push(decoded.replace(/:$/, ""));
    return {
      ok: true,
      json: async () => ({ products: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function provider(setting: MedusaConnectionSettingRecord) {
  const repository = {
    getSetting: async () => setting,
  } as unknown as MedusaConnectionRepository;
  return new MedusaCredentialProvider(
    repository,
    new MedusaCredentialCryptoService(),
  );
}

/** VALÓDI titkosított boríték, nem kézzel összerakott mező-halom. */
function storedSetting(): MedusaConnectionSettingRecord {
  const envelope = new MedusaCredentialCryptoService().encrypt(STORED, 1);
  return {
    id: "medusa",
    credentialMode: "DATABASE",
    credentialRevision: 1,
    encryptedApiKey: envelope.encryptedApiKey,
    encryptionIv: envelope.encryptionIv,
    authenticationTag: envelope.authenticationTag,
    keyVersion: envelope.keyVersion,
  } as unknown as MedusaConnectionSettingRecord;
}

const environmentSetting = {
  id: "medusa",
  credentialMode: "ENV_FALLBACK",
  credentialRevision: 1,
} as MedusaConnectionSettingRecord;

describe("a vetítés hitelesítő adata", () => {
  /**
   * A KÖR KULCSÁLLÍTÁSA. Környezeti kulcs SEHOL nincs, és a vetítés kliense
   * mégis elindul, a tárolt kulccsal. Ha valaki ide visszacsempészi a környezeti
   * olvasást, ez pirosra vált: a kulcs nem a paraméterből, hanem a kimenő
   * fejlécből jön vissza.
   */
  it("runs from the stored key with no environment key at all", async () => {
    const seenKeys: string[] = [];
    const { out, stdout, stderr } = collector();

    await withEnvironment(withoutEnvironmentKey, async () => {
      const client = await medusaClientForProjection(
        provider(storedSetting()),
        out,
        process.env,
        recordingFetch(seenKeys),
      );
      await client.probe();
    });

    assert.deepEqual(seenKeys, [STORED]);
    // A tartalék sora NEM szólalhat meg a tárolt úton: ha mindig megszólalna,
    // ugyanolyan használhatatlan lenne, mintha soha.
    assert.equal(stderr.join(""), "");
    assert.match(stdout.join(""), /tárolt hitelesítő adatot használom/);
    // A revízió a kulcs AZONOSSÁGA, nem a kulcs. A kulcs nem mehet kimenetre.
    assert.equal(stdout.join("").includes(STORED), false);
  });

  /**
   * A TARTALÉK MŰKÖDIK, DE NEM NÉMA. A tartalék természete, hogy működik, és
   * amíg működik, senki nem veszi észre, hogy még mindig azt használjuk.
   */
  it("says out loud when the key came from the environment", async () => {
    const seenKeys: string[] = [];
    const { out, stderr } = collector();

    await withEnvironment(withEnvironmentKey, async () => {
      const client = await medusaClientForProjection(
        provider(environmentSetting),
        out,
        process.env,
        recordingFetch(seenKeys),
      );
      await client.probe();
    });

    assert.deepEqual(seenKeys, [ENVIRONMENT_KEY]);
    assert.match(stderr.join(""), /TARTALÉK ÚT/);
    assert.equal(
      stderr.join("").includes(MEDUSA_PROJECTION_FALLBACK_NOTICE),
      true,
    );
    // A sor a VÁLTOZÓT nevezi meg, nem az értékét.
    assert.equal(stderr.join("").includes(ENVIRONMENT_KEY), false);
  });

  /**
   * A tárolt kulcs ÉRTÉKE akkor is a tárolóból jön, ha a környezetben véletlenül
   * ott áll egy másik. A vetítés útján ez a legkönnyebben elrontható pont.
   */
  it("ignores an environment key that happens to be present", async () => {
    const seenKeys: string[] = [];
    const { out, stderr } = collector();

    await withEnvironment(withEnvironmentKey, async () => {
      const client = await medusaClientForProjection(
        provider(storedSetting()),
        out,
        process.env,
        recordingFetch(seenKeys),
      );
      await client.probe();
    });

    assert.deepEqual(seenKeys, [STORED]);
    assert.equal(seenKeys.includes(ENVIRONMENT_KEY), false);
    assert.equal(stderr.join(""), "");
  });

  /**
   * SEM TÁROLT, SEM KÖRNYEZETI KULCS. A parancs egy sorral áll meg, és a sor a
   * TEENDŐT mondja meg, nem a hibakódot. Adatbázishoz itt nem nyúlunk: a
   * hitelesítő adat a termékek kikeresése ELŐTT dől el.
   */
  it("stops with one line when there is no key anywhere", async () => {
    const { out, stdout, stderr } = collector();

    const code = await withEnvironment(withoutEnvironmentKey, async () =>
      runProjectionCli(["prod_teszt"], out, provider(environmentSetting)),
    );

    assert.equal(code, 1);
    assert.equal(stderr.length, 1);
    assert.match(stderr.join(""), /nincs beállítva/);
    assert.match(stderr.join(""), /Beállítások/);
    assert.equal(stdout.join(""), "");
  });
});

/**
 * SZERKEZETI ÁLLÍTÁS: a titok többé nem olvasható közvetlenül a környezetből a
 * vetítés útján.
 *
 * Ez nem a viselkedést méri, hanem a LEFEDETTSÉGET, mint az integrációs kapu
 * specje: egy holnap született új fájl, ami visszacsempészi az env-olvasást,
 * ugyanaz a hiba lenne, csak más helyen. A lista ezért nem kézzel karbantartott.
 *
 * A KERESÉS ALAKJA a lényeg, és két alakban kell futtatni:
 *
 * 1. KÖZVETLEN olvasás (`process.env.MEDUSA_ADMIN_API_KEY`, `env.MEDUSA_...`);
 * 2. KÖZVETETT olvasás a kombinált beállítás-olvasón át
 *    (`medusaAdminConfigFromEnv(...)`), ami a címet ÉS a kulcsot is a
 *    környezetből veszi.
 *
 * A NÉVRE keresni kevés lenne: a parancs kimenete maga NEVEZI MEG a változót a
 * tartalék-sorban, tehát a puszta név ott is előfordul, ahol semmit nem
 * olvasunk. Ezért az OLVASÁS alakját keressük, nem a nevet.
 *
 * EGY KIVÉTEL SZÁNDÉKOS, és nem lelet: a hitelesítő-szolgáltató tartalék-ága,
 * mert az MAGA a tartalék.
 *
 * A KOMBINÁLT ALAKNAK VISZONT MÁR SEHOL NEM SZABAD TALÁLATOT ADNIA: a függvény
 * megszűnt, tehát az engedélyezett halmaza ÜRES. Egy üres halmaz és egy elromlott
 * keresés viszont ugyanúgy néz ki, ezért a nulla találat CSAK a két kontrollal
 * együtt jelent valamit: a fájl-oldali (a lista nem üres, és benne van a parancs
 * fájlja) és az alak-oldali (a minta, ami mindkét alakot tartalmazza, találatot
 * ad). Bármelyik hiányában a zöld nem azt mondaná, hogy nincs olvasás, hanem
 * azt, hogy nem néztük meg.
 */
const SECRET_ENV_READ =
  /(?:process\s*\.\s*)?env(?:ironment)?\s*(?:\.\s*MEDUSA_ADMIN_API_KEY|\[\s*["'`]MEDUSA_ADMIN_API_KEY)/;
const COMBINED_READER_CALL = /medusaAdminConfigFromEnv\s*\(/;

const ALLOWED_DIRECT = new Set([
  "src/integrations/medusa/medusa-credential.provider.ts",
]);
/** ÜRES, és ez az állítás: a kombinált olvasó sehol nem hívható, mert nincs. */
const ALLOWED_COMBINED = new Set<string>();
const PROJECTION_CLI = "src/integrations/medusa/medusa-projection.cli.ts";

async function medusaSources(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/integrations/medusa/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("a titok környezeti olvasása a vetítés útján", () => {
  /**
   * A KONTROLL A KERESÉSRE. Enélkül egy elrontott minta nulla találatot adna,
   * és a teszt zölden azt állítaná, hogy sehol nincs env-olvasás - miközben azt
   * jelentené, hogy a keresés romlott el.
   */
  it("finds both shapes in a sample that has them", () => {
    const sample = [
      "const apiKey = process.env.MEDUSA_ADMIN_API_KEY?.trim();",
      'const other = env["MEDUSA_ADMIN_API_KEY"];',
      "const config = medusaAdminConfigFromEnv(process.env);",
    ].join("\n");

    assert.equal(SECRET_ENV_READ.test(sample), true);
    assert.equal(COMBINED_READER_CALL.test(sample), true);
    // És a NÉV önmagában NEM olvasás: a tartalék-sor szövege nem találat.
    assert.equal(
      SECRET_ENV_READ.test(
        "a kulcs a MEDUSA_ADMIN_API_KEY környezeti változóból jött",
      ),
      false,
    );
  });

  it("reads the files it claims to read", async () => {
    const sources = await medusaSources();

    // Nulla találat itt zöld lenne, és pontosan azt állítaná, hogy minden
    // rendben. A parancs fájljának NÉV SZERINT benne kell lennie.
    assert.ok(
      sources.length >= 10,
      `Csak ${sources.length} forrásfájlt találtam. Ez a keresés hibája, nem a lefedettségé.`,
    );
    assert.equal(sources.includes(PROJECTION_CLI), true);
  });

  it("leaves the secret env read only where it belongs", async () => {
    const sources = await medusaSources();

    const direct = sources.filter((file) =>
      SECRET_ENV_READ.test(readFileSync(file, "utf8")),
    );
    const combined = sources.filter((file) =>
      COMBINED_READER_CALL.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      direct.filter((file) => !ALLOWED_DIRECT.has(file)),
      [],
      "Ezek a fájlok közvetlenül olvassák a titkot a környezetből: " +
        direct.join(", "),
    );
    assert.deepEqual(
      combined.filter((file) => !ALLOWED_COMBINED.has(file)),
      [],
      "Ezek a fájlok a kombinált beállítás-olvasón át veszik a titkot a " +
        "környezetből: " +
        combined.join(", "),
    );

    // És kimondva a lényeg: a vetítés parancsa egyik alakot sem használja.
    assert.equal(direct.includes(PROJECTION_CLI), false);
    assert.equal(combined.includes(PROJECTION_CLI), false);
  });

  /**
   * AZ ENGEDÉLY IS ELAVUL, és az elavult engedély csendben marad zöld: a szűrő
   * csak azt nézi, mi VAN a listán kívül, azt nem, hogy amit engedélyeztünk, még
   * mindig olvas-e. Egy ilyen sor fél év múlva azt állítaná egy olvasónak, hogy
   * ott env-olvasás van, holott már nincs. A kombinált olvasó törlésekor pontosan
   * ez történt volna, ezért ez az állítás nem óvatosság, hanem mért eset.
   *
   * EZ EGY NAP JOGGAL PIROSRA VÁLT, és akkor sem törölni kell. Amikor valaki a
   * tartalék utat (`ENV_FALLBACK`) ténylegesen kivezeti, a hitelesítő-szolgáltató
   * sem olvas többé env-titkot, és ez a sor pirosat ad. Az a piros NEM hiba,
   * hanem üzenet: a LISTÁT kell szűkíteni, nem a tesztet kivenni. A törlés a
   * legkézenfekvőbb reakció, és pont azt a féket venné el, ami szólt.
   */
  it("keeps no permission for a file that no longer reads the secret", async () => {
    const stale = [...ALLOWED_DIRECT].filter(
      (file) => !SECRET_ENV_READ.test(readFileSync(file, "utf8")),
    );
    const staleCombined = [...ALLOWED_COMBINED].filter(
      (file) => !COMBINED_READER_CALL.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      stale,
      [],
      "Ezek a fájlok engedélyt kaptak a közvetlen olvasásra, de már nem " +
        "olvasnak: " +
        stale.join(", "),
    );
    assert.deepEqual(
      staleCombined,
      [],
      "Ezek a fájlok engedélyt kaptak a kombinált olvasóra, de már nem hívják: " +
        staleCombined.join(", "),
    );
  });
});

describe("describePublication", () => {
  /**
   * A brief falszifikálási kikötése négy állítást kér, és mind a négy külön
   * tesztet kapott: a published döntésnél látszik a megfelelő indok, a
   * draftnál is, a csatorna NEVE látszik, és az AZONOSÍTÓ önmagában nem
   * helyettesíti a nevet.
   */
  it("published döntésnél az állapot, a művelet és az INDOK is látszik", () => {
    const lines = describePublication({
      status: "published",
      salesChannel: "attach",
      reason: "értékesíthető a webshopban",
      salesChannelName: "Acropora Webshop",
    });

    assert.match(lines, /publication: published/);
    assert.match(lines, /sales channel: attached -> Acropora Webshop/);
    assert.match(lines, /reason: értékesíthető a webshopban/);
  });

  it("draft döntésnél ugyanaz a három sor, a saját indokával", () => {
    const lines = describePublication({
      status: "draft",
      salesChannel: "detach",
      reason: "nincs webshopos értékesítésre jelölve",
      salesChannelName: "Acropora Webshop",
    });

    assert.match(lines, /publication: draft/);
    assert.match(lines, /sales channel: detached -> Acropora Webshop/);
    assert.match(lines, /reason: nincs webshopos értékesítésre jelölve/);
  });

  it("a csatorna NEVE lekötésnél is látszik", () => {
    /**
     * Az első változatom itt elhagyta a nevet, azzal, hogy odatartozást
     * sugallna. Gyengébb érv annál, amit elveszít: a lekötés ugyanolyan
     * művelet egy csatornán, mint a hozzákötés, és aki egy MÁSIK bolt
     * csatornájáról köt le egy terméket, annak ugyanúgy látnia kell, melyikről.
     */
    assert.match(
      describePublication({
        status: "draft",
        salesChannel: "detach",
        reason: "a termék inaktív",
        salesChannelName: "Valaki más boltja",
      }),
      /detached -> Valaki más boltja/,
    );
  });

  it("az AZONOSÍTÓ önmagában nem helyettesíti a nevet", () => {
    /**
     * A brief kikötése, és ez az egyetlen hely, ahol egy LÉTEZŐ, de nem a
     * miénk csatorna kiderülhet: a hívás sikerül, a tesztek zöldek, és csak
     * az olvasható név mondja meg, hogy nem oda írtunk, ahova hittük.
     */
    const lines = describePublication({
      status: "published",
      salesChannel: "attach",
      reason: "értékesíthető a webshopban",
      salesChannelName: "Valaki más boltja",
    });

    assert.match(lines, /Valaki más boltja/);
    assert.doesNotMatch(
      lines,
      /^sales channel: attached -> sc_/m,
      "azonosító nem állhat a név helyén",
    );
  });
});

/**
 * KÉT ÁLLAPOT, KÉT TEENDŐ, KÉT MONDAT.
 *
 * A régi üzenet („nincs ilyen cikkszámú aktív változat") IGAZ volt, de két
 * különböző állapotot fedett, és a teendő nem ugyanaz. A lekérdezés mindkettőt
 * megmérte - csak eldobtuk a különbséget, mielőtt kiírtuk volna.
 */
describe("A cikkszám-keresés két sikertelen esete", () => {
  it("a nem létező cikkszám egyszerű mondatot kap", () => {
    const text = describeSkuLookupFailure("teszt0001", "no-such-sku");
    assert.match(text, /nincs ilyen cikkszámú változat/);
    assert.ok(
      !text.includes("INAKTÍV"),
      "a nem létező cikkszámnál nincs mit aktiválni",
    );
  });

  it("az inaktív változat a MÁSIK teendőt nevezi meg", () => {
    const text = describeSkuLookupFailure("teszt0001", "variant-inactive");
    assert.match(text, /INAKTÍV/);
    assert.match(text, /A cikkszám tehát jó/);
    assert.match(text, /aktiválása/);
  });

  it("a két mondat különbözik, különben a szétválasztás semmit nem ér", () => {
    assert.notEqual(
      describeSkuLookupFailure("x", "no-such-sku"),
      describeSkuLookupFailure("x", "variant-inactive"),
    );
  });
});

/**
 * A HIANY-SOROK CSATORNAJA, SZERKEZETI ALLITASSAL.
 *
 * MIERT NEM VISELKEDESI: ezek a sorok a parancsok TORZSEBEN allnak, azok pedig
 * a `prisma`-t MODUL-SZINTU importbol veszik -- teszt-duplat nem lehet nekik
 * adni. Ugyanaz a korlat, ami miatt a kategoria-dontes kulon modulba kerult.
 *
 * MIT VED: egy utemezett futast burkolo szkript gyakran a STDERR JELENLETET
 * olvassa hibanak, akkor is, ha a kilepesi kod nulla. A hianyzo lekepezes es a
 * hianyzo keszlet-sor viszont NEM bukas -- egyik sem noveli a `failed`
 * szamlalot --, tehat a stderr-en egy egeszseges futas riasztasnak latszana.
 * Amig a kategoria-betoltes nincs kesz, ez MINDEN erintett termeknel megtortenne.
 *
 * A MINTA A PRETTIER ALAKJARA ILLESZKEDIK, es ezert kell hozza a darabszam-
 * kontroll: ha a formazas valaha mast ad, a nulla talalat ugy nezne ki, mint egy
 * tiszta eredmeny. A nevezot tehat allitjuk, nem csak a szamlalot.
 */
const MISSING_REPORTER_CALL =
  /out\.(stdout|stderr)\(\s*`\$\{(describeMissing\w+)\(/g;

const PROJECTION_COMMANDS = [
  "src/integrations/medusa/medusa-projection.cli.ts",
  "src/integrations/medusa/medusa-inventory.cli.ts",
];

function missingReporterCalls(): { channel: string; reporter: string }[] {
  const found: { channel: string; reporter: string }[] = [];
  for (const file of PROJECTION_COMMANDS)
    for (const match of readFileSync(file, "utf8").matchAll(
      MISSING_REPORTER_CALL,
    ))
      found.push({ channel: match[1]!, reporter: match[2]! });
  return found;
}

describe("which channel a missing-data line goes to", () => {
  /**
   * A KONTROLL A MINTARA, MINDKET IRANYBAN. Enelkul egy elromlott minta nulla
   * talalatot adna, es a teszt zolden azt allitana, hogy sehol nincs stderr.
   */
  it("recognises both channels in a sample that has them", () => {
    const sample = [
      "      out.stderr(`${describeMissingCategoryMapping(id, missing)}\\n`);",
      "      out.stdout(`${describeMissingStockRow(sku, name)}\\n`);",
    ].join("\n");

    const seen = [...sample.matchAll(MISSING_REPORTER_CALL)].map(
      (match) => match[1],
    );
    assert.deepEqual(seen, ["stderr", "stdout"]);
  });

  it("reads the calls it claims to read", () => {
    const calls = missingReporterCalls();

    // A NEVEZO: ket parancs, egy-egy hiany-jelzessel. Ha ez nulla lenne, a
    // csatorna-allitas nem a kodrol szolna, hanem a sajat mintajarol.
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.reporter).sort(), [
      "describeMissingCategoryMapping",
      "describeMissingStockRow",
    ]);
  });

  it("keeps every missing-data line on stdout", () => {
    const stderrLines = missingReporterCalls().filter(
      (call) => call.channel === "stderr",
    );

    assert.deepEqual(
      stderrLines.map((call) => call.reporter),
      [],
      "A hiányzó adat nem bukás: a stderr ebben a két parancsban a valódi bukásoké, amik a failed számlálót is növelik.",
    );
  });
});
