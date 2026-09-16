import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AMIT A TELEFON A TÖRZSBEN KÜLD, AZ LÉTEZZEN A DTO-N.
 *
 * === A MÉRT HIBA, 2026-09-16 ===
 *
 * A telefonos jegy-nyitás MINDEN esetben elbukott volna, és nyolc zöld kapu
 * közül egyik sem látta. A képernyő `clientOperationId` mezőt küldött a
 * hibajegy törzsében; a `CreateServiceJobDto`-n ilyen mező NEM volt, a globális
 * `ValidationPipe` pedig `whitelist: true` ÉS `forbidNonWhitelisted: true`
 * (`app.configuration.ts`). Vagyis nem levágja a mezőt, hanem 400-zal elutasítja
 * az egész kérést: „property clientOperationId should not exist".
 *
 * Térerőnél ez azonnal látszott volna; térerő NÉLKÜL rosszabb: a bejelentés
 * bekerül a sorba, és a hálózat visszatértekor fut ugyanerre a 400-ra. A
 * szerelő addig azt látja, hogy a jegye „vár feltöltésre".
 *
 * === MIÉRT NEM FOGTA MEG SEMMI ===
 *
 * Az Expo app nem húzhatja be a munkatér csomagjait, tehát a kérés típusait
 * MÁSOLJA. A másolat ÖNMAGÁVAL konzisztens: a mobil typecheck azt méri, hogy a
 * képernyő a saját deklarációt helyesen tölti ki -- azt nem, hogy a deklaráció
 * igaz-e a szerverre. A `mobile-api-routes.spec.ts` az ÚTVONALAT veti össze, és
 * a saját fejlécében ki is mondja, hogy a törzset nem nézi. A
 * `mobile-response-mirror.spec.ts` a VÁLASZ mezőit méri. A KÉRÉS törzsére nem
 * volt semmi. Ez a fájl az.
 *
 * === AZ IRÁNY NEM SZIMMETRIKUS, ÉS EZ SZÁNDÉKOS ===
 *
 * A mobil mezői RÉSZHALMAZT alkotnak, nem egyenlő halmazt. A DTO-n állhat olyan
 * mező, amit csak a web küld (a jegynél például `assigneeIds` -- az iroda
 * delegál, a szerelő nem). Egyenlőséget követelve ez a guard minden webes
 * bővítésnél elbukna, és a következő ember a guardot venné ki, nem a hibát.
 *
 * A fordított irány NÉMA hiba: egy mező, amit a telefon küld és a DTO nem
 * ismer, 400-at ad, a telefonon pedig „nem sikerült" üzenetként jelenik meg.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * A MEZŐNEVEKET veti össze, nem a típusokat és nem a validátorokat: egy
 * `string` kontra `number` eltérés, vagy egy `@Matches` minta, amibe a telefon
 * értéke nem fér bele, átcsúszik rajta. PADLÓ, nem garancia -- de a mai hibát
 * megfogta volna, mert az NÉV volt.
 */
const PAROK = [
  {
    mit: "hibajegy felvitele",
    mobil: "../mobile/src/lib/service-jobs/types.ts",
    mobilNev: "CreateServiceJobInput",
    dto: "src/service-jobs/dto.ts",
    dtoNev: "CreateServiceJobDto",
    /** Ismert mezők: ha ezek eltűnnek, a kiolvasás romlott el, nem a kód. */
    kontroll: ["title", "originAssetId"],
  },
  {
    mit: "eszköz felvitele",
    mobil: "../mobile/src/lib/api/assets.ts",
    mobilNev: "CreateAssetInput",
    dto: "src/service-assets/dto/asset.dto.ts",
    dtoNev: "CreateAssetDto",
    kontroll: ["name", "ownerType"],
  },
  {
    mit: "munkalap felvitele",
    mobil: "../mobile/src/lib/api/worksheets.ts",
    mobilNev: "CreateWorksheetInput",
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "CreateWorksheetDto",
    kontroll: ["customerId", "departmentId"],
  },
] as const;

/**
 * AZ UTVONALAK A CSOMAG GYOKEREHEZ KEPEST ALLNAK (`apps/api`), ugyanugy, mint a
 * szomszed tukor-orzoben: a teszt a `test-dist` alol fut, tehat a fajl SAJAT
 * helye nem hasznalhato horgonykent. A rossz utvonalat a lenti hossz-ellenorzes
 * fogja meg -- enelkul ket URES halmazt vetnenk ossze, zolden.
 */
function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITIV KONTROLL A BEOLVASASRA: rossz útvonalnál a lenti állítások két
  // ÜRES halmazt vetnének össze -- zölden.
  assert.ok(s.length > 500, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** A blokk-kommentek nélküli szöveg: egy magyarázat nem mező. */
function kodSzoveg(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function torzs(s: string, fej: string, nev: string): string {
  const start = s.indexOf(`${fej} ${nev} `);
  assert.notEqual(start, -1, `nem találtam: ${fej} ${nev}`);
  const veg = s.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találtam a végét: ${nev}`);
  return kodSzoveg(s.slice(start, veg));
}

/**
 * AZ OSOSZTALY NEVE, HA VAN -- ES EZT EGY HAMIS PIROS KERTE.
 *
 * Az elso alakom a munkalapra elbukott: a `CreateWorksheetDto extends
 * WorksheetContentDto`, tehat a `subject` es a `description` az OSBEN all. A
 * guard "a telefon ismeretlen mezot kuld" hibat jelentett olyan mezokre, amiket
 * a szerver ma is elfogad. Egy orzo, ami hamisan bukik, ugyanolyan drag, mint
 * amelyik hallgat: a kovetkezo ember a guardot veszi ki, nem a hibat.
 *
 * A LANCOT UGYANABBAN A FAJLBAN koveti. Ha egy DTO valaha masik fajlbol
 * orokol, ez a fuggveny nem talalja meg az ost -- es akkor a POZITIV KONTROLL
 * bukik el elobb (az ismert mezok hianyoznanak), nem a fo allitas. Vagyis a
 * korlat HANGOS, nem nema.
 */
function osNeve(s: string, nev: string): string | null {
  const m = s.match(
    new RegExp(`export class ${nev}\\s+extends\\s+([A-Za-z_]\\w*)`),
  );
  return m ? m[1]! : null;
}

/** Egy `interface` mezőneveinek halmaza. */
function mezok(s: string, nev: string): Set<string> {
  return new Set(
    [
      ...torzs(s, "export interface", nev).matchAll(
        /^\s{2}([A-Za-z_]\w*)\??\s*:/gm,
      ),
    ].map((m) => m[1]!),
  );
}

/**
 * EGY DTO OSZTÁLY MEZŐNEVEI.
 *
 * KÉT ALAKBAN állhatnak, és mind a kettő kell: saját soron
 * (`  assigneeIds?: string[];`), vagy a dekorátorok UTÁN, ugyanabban a sorban
 * (`  @IsString() @IsOptional() customerId?: string | null;`). Csak az elsőre
 * mérve a jegy DTO-jának a FELE kimaradna.
 */
function dtoMezok(s: string, nev: string): Set<string> {
  const osszes = new Set<string>();
  const latott = new Set<string>();
  let aktualis: string | null = nev;
  while (aktualis && !latott.has(aktualis)) {
    latott.add(aktualis);
    const t = torzs(s, "export class", aktualis);
    for (const m of t.matchAll(/(?:^\s{2}|\)\s+)([A-Za-z_]\w*)[!?]?\s*:/gm))
      osszes.add(m[1]!);
    aktualis = osNeve(s, aktualis);
  }
  return osszes;
}

describe("a mobil kérés-törzsei a szerver DTO-ihoz mérve", () => {
  for (const par of PAROK) {
    it(`POZITÍV KONTROLL: a(z) ${par.mit} két halmaza nem üres`, () => {
      const mobilMezok = mezok(forras(par.mobil), par.mobilNev);
      const dto = dtoMezok(forras(par.dto), par.dtoNev);
      assert.ok(mobilMezok.size >= 2, `mobil oldal: ${[...mobilMezok]}`);
      assert.ok(dto.size >= 3, `DTO oldal: ${[...dto]}`);
      for (const ismert of par.kontroll)
        assert.ok(
          dto.has(ismert),
          `a DTO kiolvasásából hiányzik egy ISMERT mező (${ismert}): ${[...dto].sort().join(", ")}`,
        );
    });

    it(`a(z) ${par.mit} minden küldött mezője létezik a DTO-n`, () => {
      const mobilMezok = mezok(forras(par.mobil), par.mobilNev);
      const dto = dtoMezok(forras(par.dto), par.dtoNev);
      const ismeretlen = [...mobilMezok].filter((m) => !dto.has(m)).sort();
      assert.deepEqual(
        ismeretlen,
        [],
        `a telefon olyan mezőt küld, amit a DTO nem ismer -- a ValidationPipe ` +
          `(whitelist + forbidNonWhitelisted) ezt 400-zal utasítja el: ${ismeretlen.join(", ")}`,
      );
    });
  }
});
