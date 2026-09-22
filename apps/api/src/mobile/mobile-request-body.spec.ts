import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  dtoMezok,
  forras,
  kodSzoveg,
  mezok,
} from "./mobile-contract-source.js";

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
interface Par {
  mit: string;
  mobil: string;
  mobilNev: string;
  dto: string;
  dtoNev: string;
  /** Ismert mezők: ha ezek eltűnnek, a kiolvasás romlott el, nem a kód. */
  kontroll: readonly string[];
  /**
   * A POZITÍV KONTROLL KÜSZÖBE, PÁRONKÉNT. Alapból 2 és 3; egy EGY MEZŐS
   * kérés-törzsnél a közös küszöb egy HELYES kiolvasásra adna pirosat, és a
   * következő ember a küszöböt venné ki, nem a hibát keresné.
   */
  mobilMinimum?: number;
  dtoMinimum?: number;
}

const PAROK: readonly Par[] = [
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
    mit: "eszköz módosítása",
    mobil: "../mobile/src/lib/assets/asset-fields.ts",
    mobilNev: "UpdateAssetInput",
    dto: "src/service-assets/dto/asset.dto.ts",
    dtoNev: "UpdateAssetDto",
    kontroll: ["ownerType", "expectedUpdatedAt"],
  },
  {
    mit: "munkalap felvitele",
    mobil: "../mobile/src/lib/api/worksheets.ts",
    mobilNev: "CreateWorksheetInput",
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "CreateWorksheetDto",
    kontroll: ["customerId", "departmentId"],
  },
  {
    /**
     * A FELELŐSÖK ÁTÍRÁSA. 2026-09-17-én került ide, amikor a telefonra
     * megjött a kiosztás-szerkesztő: a lenti darabszám elmozdult, és a guard
     * saját üzenete kérte a döntést. A válasz IGEN, mert a törzs NEVESÍTETT
     * típussal megy -- tehát van mihez kötni.
     */
    mit: "hibajegy-fénykép felirata",
    mobil: "../mobile/src/lib/api/service-jobs.ts",
    mobilNev: "SetServiceJobDocumentCaptionInput",
    dto: "src/service-jobs/service-job-documents.dto.ts",
    dtoNev: "UpdateServiceJobDocumentCaptionDto",
    kontroll: ["caption"],
    /* EGY MEZOS TORZS: a kozos kuszob itt egy HELYES kiolvasasra adna pirosat. */
    mobilMinimum: 1,
    dtoMinimum: 1,
  },
  {
    /**
     * AZ ESZKÖZ-FÉNYKÉP FELIRATA. 2026-09-18-án került ide, amikor a telefonra
     * megjött az eszköz-galéria feliratozása -- a lenti darabszám elmozdult, és
     * a guard saját üzenete kérte a döntést. A válasz IGEN, ugyanabból az
     * okból, mint a hibajegynél: a törzs NEVESÍTETT típussal megy.
     *
     * ÉS AMIÉRT KÜLÖN PÁR, NEM A HIBAJEGYÉ ÚJRAHASZNÁLVA: két külön végpont,
     * két külön DTO. Egy közös bejegyzés azt állítaná, hogy a kettő együtt
     * változik -- és amikor az egyik elmozdul, a guard a MÁSIKAT nevezné meg.
     */
    mit: "eszköz-fénykép felirata",
    mobil: "../mobile/src/lib/api/assets.ts",
    mobilNev: "SetAssetDocumentCaptionInput",
    dto: "src/service-assets/dto/asset.dto.ts",
    dtoNev: "UpdateAssetDocumentCaptionDto",
    kontroll: ["caption"],
    /* EGY MEZOS TORZS, ugyanazert, amiert a hibajegynel. */
    mobilMinimum: 1,
    dtoMinimum: 1,
  },
  {
    mit: "felelősök átírása",
    mobil: "../mobile/src/lib/api/worksheets.ts",
    mobilNev: "SetWorksheetAssigneesInput",
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "SetWorksheetAssigneesDto",
    kontroll: ["userIds"],
    /**
     * EGY MEZŐS MIND A KÉT OLDALON. A kontroll ereje itt nem a darabszámból
     * jön, hanem a `kontroll` mezőből: az NÉV szerint mondja meg, hogy a
     * kiolvasás tényleg lát -- és egy rossz útvonalnál a `forras()`
     * hossz-ellenőrzése szól előbb.
     */
    mobilMinimum: 1,
    dtoMinimum: 1,
  },
  {
    /**
     * A MUNKALAP ALAIRASA -- ES EZ A PAR EGY KET-PR-ES SZETVALASZTAS MIATT KELL.
     *
     * A belsos alairas SZERVER-oldala (852) es a TELEFON gombja (854) ket kulon
     * korben keszult, es a ketto kozott EGYETLEN kapcsolodasi pont van: a
     * `signSelf` mezo NEVE. Mind a ket oldalon sztring, tehat egy elgepeles
     * barmelyik oldalon forditasidoben NEMA -- a keres kimegy, a szerver a
     * mezot nem ismeri fel, es a nev nelkuli agra fut. A hiba hangos, de CSAK
     * telefonon derul ki.
     *
     * A KONTROLLBAN KET MEZO ALL: a `signSelf` a belsos ag, a `signerUserId` a
     * partner-ag. Ha barmelyik kiesik a kiolvasasbol, a par ket ures halmazt
     * vetne ossze, zolden.
     */
    mit: "munkalap aláírása",
    mobil: "../mobile/src/lib/api/worksheets.ts",
    mobilNev: "SignWorksheetInput",
    dto: "src/worksheets/dto/worksheet.dto.ts",
    dtoNev: "SignWorksheetVersionDto",
    kontroll: ["signSelf", "signerUserId"],
    mobilMinimum: 4,
    dtoMinimum: 5,
  },
  {
    /**
     * ANYAGIGENYLES A MUNKALAPROL, MOBIL SZELET (2026-09-23). A torzs
     * NEVESITETT tipussal megy (`CreateMaterialRequestInput`), tehat PAR lett
     * belole itt, nem a hivohelyek kozott.
     */
    mit: "anyagigénylés felvitele",
    mobil: "../mobile/src/lib/api/material-requests.ts",
    mobilNev: "CreateMaterialRequestInput",
    dto: "src/material-requests/dto/material-request.dto.ts",
    dtoNev: "CreateMaterialRequestDto",
    kontroll: ["items"],
    /* EGY MEZOS TORZS mind a ket oldalon, ugyanugy, mint a felelosok atirasanal. */
    mobilMinimum: 1,
    dtoMinimum: 1,
  },
];

/**
 * A FORRASOLVASOK A `mobile-contract-source.ts` MODULBAN ALLNAK, ES NEM ITT.
 *
 * Ket orzo hasznalja oket: ez, es a `mobile-request-call-site.spec.ts`, ami a
 * HIVAS helyen kiirt kulcsokat meri. Ket masolat az elso napon egyezne, es
 * utana elcsuszna -- pontosan az a hiba, amit ezek az orzok kerülnek.
 */

/**
 * AMIT EZ AZ ORZO NEM FED LE, KIMONDVA -- ES EGY SZAM, AMI SZOL, HA NO A LISTA.
 *
 * A fenti parok NEVESITETT tipusokat vetnek ossze. A telefon nehany irasa
 * viszont HELYBEN megirt objektum-tipussal megy (`{ to, note }`, `{ body }`,
 * `{ id, description, quantity, unit }`), es azoknak nincs mihez kotni a
 * nevuket. Ezeket ma nem meri semmi.
 *
 * A LISTA NEM MARADHAT CSENDBEN: ha egy UJ iras-hivas keletkezik, ez a szam
 * elmozdul, es a teszt megnevezi, hogy dontesre var -- vagy par lesz belole
 * fent, vagy tudatosan itt marad. Enelkul a kovetkezo uj mezo pontosan ugyanigy
 * menne at nyolc zold kapun, mint 2026-09-17-en a `clientOperationId`.
 *
 * MIERT A SZAM ES NEM A NEVEK: egy nev-lista karbantartasa maga is elavul, es a
 * hianyat semmi nem jelzi. Egy szam viszont NEM tud csendben elavulni.
 */
/**
 * 2026-09-18: 13 -> 14. Az új hívás az ESZKÖZ fényképének FELIRATA
 * (`setAssetDocumentCaption`). A guard saját üzenete kérte a döntést, és a
 * válasz IGEN: a törzs NEVESÍTETT típust kapott
 * (`SetAssetDocumentCaptionInput`), tehát PÁR lett belőle fent.
 *
 * ÉS EZ A GUARD PONTOSAN AZT TETTE, AMIÉRT MEGÍRTÁK: a mai munkám a mobil
 * tükrét és a képernyőt írta át, és a beégetett szám volt az EGYETLEN, ami
 * megállított, hogy a törzsről is döntsek. Sem a fordító, sem a mobil
 * teszt-készlet nem szólt volna -- a 2026-09-17-i `clientOperationId` pontosan
 * ugyanígy ment át nyolc zöld kapun.
 */
/**
 * 2026-09-17: 12 -> 13. Az új hívás a hibajegy fényképének FELIRATA
 * (`setServiceJobDocumentCaption`). A guard saját üzenete kérte a döntést, és a
 * válasz IGEN: a törzs NEVESÍTETT típust kapott
 * (`SetServiceJobDocumentCaptionInput`), tehát PÁR lett belőle fent -- nem a
 * „nem mérjük" halmazba került. Egy mezős törzs, ezért a páron a küszöbök
 * EGYRE mennek: a közös kettes-hármas küszöb egy HELYES kiolvasásra adna
 * pirosat.
 */
/**
 * 2026-09-17: 11 -> 12. Az új hívás a munkalap FELELŐSEINEK átírása
 * (`setWorksheetAssignees`). NEM csak a szám mozdult: a törzs nevesített
 * típust kapott (`SetWorksheetAssigneesInput`), és PÁR is lett belőle fent --
 * vagyis a hívás nem a „nem mérjük" halmazba került.
 */
/**
 * 2026-09-21: 14 -> 15. Az uj hivas az ATADAS jelolese
 * (`setWorksheetHandedOver`, `lib/api/worksheets.ts`). A guard sajat uzenete
 * kerte a dontest, es a valasz NEM: a torzs HELYBEN kiirt kulcs
 * (`{ handedOver }`), nincs nevesitett tipusa, tehat nincs mihez PARBA
 * allitani itt. A hivas ettol nem meretlen: a szomszed orzo a HIVOHELYEK
 * kozott meri, kulcs szerint, a `SetWorksheetHandedOverDto`-hoz.
 *
 * Ez tehat az az eset, amit a ket szam kulon mozgasarol szolo jegyzet lent
 * leir, csak FORDITVA: itt MIND A KETTO mozdult (a hivas a `lib/api`-ban van),
 * de PAR csak az egyikben lett belole.
 */
/**
 * 2026-09-21: 15 -> 16. Az uj hivas a KIKULDES ALAIRASRA
 * (`sendWorksheetForSignature`, `lib/api/worksheets.ts`). A guard sajat
 * uzenete kerte a dontest, es a valasz UGYANAZ, mint az atadasnal: NEM. A
 * torzs HELYBEN kiirt kulcs (`{ signerUserId }`), nincs nevesitett tipusa,
 * tehat nincs mihez PARBA allitani ITT.
 *
 * A HIVAS ETTOL NEM MERETLEN, es ezt ki kell mondani, kulonben a kovetkezo
 * olvaso hianynak veszi: a szomszed orzo a HIVOHELYEK kozott meri, kulcs
 * szerint, a `SendWorksheetForSignatureDto`-hoz -- oda fel is vettem.
 */
/**
 * 2026-09-23: 16 -> 17. Az uj hivas az ANYAGIGENYLES FELVITELE
 * (`createMaterialRequest`, `lib/api/material-requests.ts`). A guard sajat
 * uzenete kerte a dontest, es a valasz IGEN: a torzs NEVESITETT tipussal megy
 * (`CreateMaterialRequestInput`), tehat PAR lett belole fent.
 */
const IRAS_HIVASOK_MA = 17;

describe("a mobil kérés-törzsei a szerver DTO-ihoz mérve", () => {
  it(`ma pontosan ${IRAS_HIVASOK_MA} JSON-törzset küld a telefon`, () => {
    const konyvtar = "../mobile/src/lib/api";
    const fajlok = readdirSync(konyvtar).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
    );
    // POZITIV KONTROLL: rossz konyvtarnal a szamlalas nullat adna, es egy
    // nullara allitott varakozas mellett ez zolden atmenne.
    assert.ok(fajlok.length >= 4, `gyanúsan kevés fájl: ${fajlok.join(", ")}`);
    let db = 0;
    for (const f of fajlok) {
      const t = kodSzoveg(readFileSync(`${konyvtar}/${f}`, "utf8"));
      db += t.split("body: JSON.stringify").length - 1;
    }
    assert.equal(
      db,
      IRAS_HIVASOK_MA,
      "a telefon írás-hívásainak száma megváltozott. Ha ÚJ hívás született, " +
        "döntsd el, hogy bekerül-e a fenti párok közé (nevesített típusnál igen), " +
        "és csak azután írd át ezt a számot.",
    );
  });

  for (const par of PAROK) {
    it(`POZITÍV KONTROLL: a(z) ${par.mit} két halmaza nem üres`, () => {
      const mobilMezok = mezok(forras(par.mobil), par.mobilNev);
      const dto = dtoMezok(forras(par.dto), par.dtoNev);
      /**
       * A MOBIL KÜSZÖB IS PÁRONKÉNT ÁLL: egy egy mezős kérés-törzsnél a `>= 2`
       * ugyanúgy hamis pirosat adna, mint a DTO oldalán a `>= 3`.
       */
      const mobilMinimum = par.mobilMinimum ?? 2;
      const dtoMinimum = par.dtoMinimum ?? 3;
      assert.ok(
        mobilMezok.size >= mobilMinimum,
        `mobil oldal: ${[...mobilMezok]}`,
      );
      assert.ok(dto.size >= dtoMinimum, `DTO oldal: ${[...dto]}`);
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
