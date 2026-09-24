import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import {
  ASSET_DOCUMENT_TYPES,
  rowBelongsToScope,
  rowIsScopeOwner,
  scopeMaySeeDocumentType,
  assetVisibilityForAndBranch,
  scopeOwnWhereForAndBranch,
  scopeVisibleDocumentTypes,
  type AssetDocumentTypeValue,
  type PartnerScope,
} from "../auth/partner-scope.util.js";
import { collectUnitSubtreeIds } from "./unit-subtree.js";

import { randomUUID } from "node:crypto";

import { conflictingFields, intendedFields } from "./asset-field-conflict.js";
import { assetListOrderBy } from "./asset-list-order.js";
import { assetLabelWhere } from "./asset-label-filter.js";
import { assetCategoryWhere } from "./asset-category-filter.js";
import { assetSearchWhere } from "./asset-search-filter.js";
import { mergeAssetWhere } from "./asset-where-merge.js";
import { assetStatusWhere } from "./asset-status-filter.js";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  AssetAddressSummary,
  AssetDetail,
  AssetDeletionBlockers,
  AssetDocumentSummary,
  AssetEventSummary,
  AssetHierarchyItem,
  AssetListItem,
  AssetListResponse,
  AssetOwnerListResponse,
  AssetOwnerType,
  AssetStatus,
} from "@acropora/types";
import {
  normalizeAssetLabelCode,
  normalizePerformanceValue,
  randomAssetLabelCode,
} from "@acropora/types";
import { teljesitmenyEredmenye } from "./asset-performance.js";
import {
  nextFreePartnerInternalCodeSerial,
  partnerInternalCodePrefix,
} from "./partner-internal-code.js";

import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";
import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { withUniqueCode } from "../common/unique-code.util.js";
import { retryOnSerializationConflict } from "../common/transaction-retry.util.js";
import { buildUnitPaths } from "./unit-path.js";
import type {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import {
  SERVICE_OWNER_PICKABLE_WHERE,
  assetDetailInclude,
  assetDocumentSummarySelect,
  assetOwnerScopeWhere,
  assetSummaryInclude,
  type AssetDetailRow,
  type AssetSummaryRow,
} from "./service-assets.types.js";

/**
 * LATHATJA-E A KERO EZT AZ ESEMENYT.
 *
 * A dokumentum-esemenyek payloadja NEVEN NEVEZI a dokumentumot
 * (`documentType`, `documentId`, `fileName`), tehat az esemenynaplo ugyanazt
 * hordozza, amit a dokumentum-lista mar nem ad ki. Egy korlat, ami csak az utak
 * egy reszen all, nem korlat: a szamla letezese, a neve es az idopontja itt
 * ugyanugy kimenne.
 *
 * A SZABALY A TIPUSRA ES A PAYLOAD ALAKJARA IS SZOL, es a ketto UNIOJA dont
 * (murena vetette fel, 2026-08-31). Egy tipus-lista onmagaban olyan kapu, ami
 * CSENDBEN elavul: aki holnap felvesz egy uj esemenytipust, ami fajlnevet ir a
 * payloadba, nem fogja tudni, hogy ide vissza kell jonnie. A payload alakja
 * onmagaban viszont az URES payloadu `DOCUMENT_UPLOADED`-et engedne at. Egyik
 * sem eleg egyedul, ezert all itt mind a ketto.
 *
 * MA A KETTO UGYANAZT ADJA: a nyolc `AssetEventType` kozul pontosan a
 * `DOCUMENT_UPLOADED` es a `DOCUMENT_DELETED` ir dokumentum-mezot. A kulonbseg
 * tehat nem a mai viselkedesben all, hanem a kilencedik tipusnal -- es epp
 * ezert van ra kontroll-teszt, ami MA is el tud bukni.
 *
 * ES A MERES MODJA IDE TARTOZIK, MERT AZ ELSO VALTOZATA SZUK VOLT: a
 * `assetEvent.create` hivasokra keresni NEM eleg. A frissitesi ut nem a hivas
 * helyen epiti a payloadot, hanem egy `events` tombbe gyujti, es `createMany`
 * irja ki `payload: event.payload` alakban -- egy indirekcio, ami mogott negy
 * tovabbi esemeny all. A helyes meres a TABLARA szol (`assetEvent.` minden
 * elofordulasa): ot irasi hely, mind ebben a fajlban, es mind a nyolc tipus
 * elofordul. Aki ezt a szabalyt valaha ujrameri, a tablara keressen, ne a
 * hivas nevere.
 *
 * A FEL NEM ISMERT DOKUMENTUM-TIPUS PARTNERNEL REJTVE MARAD. Ha a payload
 * dokumentumot nevez meg, de a tipusa hianyzik vagy ismeretlen, nem tudjuk,
 * mirol szol; az atengedese pont annal a sornal adna hozzaferest, amirol a
 * legkevesebbet tudjuk. Belsos keronel minden latszik, tehat a naplo
 * teljessege nem vesz el.
 *
 * A DONTES A PAYLOADBOL SZULETIK, SOHA NEM VISSZAKERESESBOL. A torles KEMENY
 * (`tx.assetDocument.delete`), tehat a `DOCUMENT_DELETED` esemeny olvasasakor a
 * dokumentum-sor MAR NINCS MEG: egy `documentId` alapu visszakereses semmit nem
 * talalna, es a szuro pont a torolt szamlanal nyilna ki. A payload maga
 * hordozza a tipust, tehat van biztonsagos forras.
 */
const DOCUMENT_PAYLOAD_KEYS = ["documentType", "documentId", "fileName"];
/**
 * A KULCS-VIZSGALAT MELY, NEM SEKELY, ES EZ MERESEN MULT.
 *
 * Murena javasolta, hogy egy komment jelolje: a szabaly LAPOS payloadot var. A
 * premisszat lemertem, es nem all: a `PLACEMENT_CHANGED` MA IS beagyaz
 * (`payload.from.customerId`, `payload.to.customerId`). Dokumentum-mezot ugyan
 * nem tesz melyre, tehat a mai viselkedes helyes -- de egy "ELVART: lapos
 * payload" komment mar a leirasa pillanataban hamis lenne, es a kovetkezo
 * olvaso vagy elavultnak nezne, vagy hibanak.
 *
 * Ezert nem komment lett belole, hanem mely bejaras. Egy komment nem orzo; ha
 * valaki holnap `payload.document.fileName` alakban ir, a sekely vizsgalat
 * CSENDBEN atengedne, a mely nem.
 *
 * A MELYSEG-KORLAT ZARVA BUKIK: egy ennel melyebb payload nem a mi irasunk,
 * tehat nem allitunk rola semmit, es a partner nem latja.
 */
const MAX_PAYLOAD_DEPTH = 8;

function payloadNamesADocument(value: unknown, depth = 0): boolean {
  if (depth > MAX_PAYLOAD_DEPTH) return true;
  if (Array.isArray(value))
    return value.some((item) => payloadNamesADocument(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  const fields = value as Record<string, unknown>;
  if (DOCUMENT_PAYLOAD_KEYS.some((key) => key in fields)) return true;
  return Object.values(fields).some((item) =>
    payloadNamesADocument(item, depth + 1),
  );
}
/**
 * A TIPUS-LISTA MEGMARAD A PAYLOAD-SZABALY MELLETT, es a ketto UNIOJA dont.
 *
 * A csere (csak payload-alak) egy meglevo garanciat vett volna el, es ezt a
 * sajat kontroll-teszt fogta meg: egy `DOCUMENT_UPLOADED`, aminek URES vagy
 * serult a payloadja, dokumentumot nevez meg a TIPUSAVAL, de egyetlen
 * dokumentum-mezot sem hordoz -- a puszta payload-szabaly atengedte volna.
 * Vagyis a tipus-lista nem elavult otlet, csak onmagaban nem eleg.
 */
const DOCUMENT_EVENT_TYPES = ["DOCUMENT_UPLOADED", "DOCUMENT_DELETED"];
/**
 * A NEGY FAJTA A KOZOS HELYROL JON (`partner-scope.util.ts`), es nem itt all
 * masodszor: a szures szabalya es a felsorolasa egy fajlban lakik, tehat egy
 * otodik fajta felvetelenel nincs lemarado ag.
 */
const DOCUMENT_TYPES = ASSET_DOCUMENT_TYPES;

/**
 * A KERT MATRICAKOD NEM KOTHETO: vagy nincs a keszletben, vagy mar mason all.
 *
 * A KETTOT SZANDEKOSAN NEM KULONBOZTETJUK MEG A HIVO FELE. Egy "letezik, de
 * foglalt" es egy "nincs ilyen" valasz kulon-kulon megmondana, hogy egy kod
 * KIADOTT-e -- es a matricakod gyenge (260 ezer lehetoseg). Aki vegigprobalja,
 * a ket valaszbol felterkepezne a teljes kiadott keszletet. A felvitelnel ez
 * nem is hasznos kulonbseg: mindket esetben ugyanaz a teendo, masik matricat
 * kell olvasni vagy szolni.
 */
/**
 * NEM SIKERULT ELEG UJ KODOT TALALNI.
 *
 * Nem "veletlen balszerencse": ez akkor all elo, ha a kod-ter (260 ezer)
 * nagy resze elfogyott. A szam benne van az uzenetben, mert enelkul a hivo
 * azt hinne, hogy a rendszer hibas -- holott a KESZLET fogyott el.
 */
export class AssetLabelPoolExhaustedError extends Error {
  constructor(
    readonly requested: number,
    readonly found: number,
  ) {
    super(
      `${requested} új matricakódot kértél, de csak ${found} szabadot találtam.`,
    );
  }
}

export class AssetLabelUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`A(z) ${code} matricakód nem köthető ehhez az eszközhöz.`);
  }
}

/**
 * A TELJESITMENY FEL PARJA -- ES A MONDAT MEGNEVEZI A HIANYZO FELET.
 *
 * Egy "hibas teljesitmeny" uzenetbol a kezelo nem tudja, mit tegyen. A ket
 * eset KET KULON teendo: az egyikben a legordulot kell kivalasztani, a
 * masikban szamot kell irni. Ezert hordozza a hiba, MELYIK oldal ures.
 *
 * ES EZ A SZOLGALTATAS FELE 400, NEM 409, a matricakoddal ELLENTETBEN: ott a
 * keres alakja jo volt es a VILAG allapota nem allt (a kod mason ul), itt
 * maga a keres hianyos. A megkulonboztetes nem stilus: a 409 azt mondja
 * "probald ujra maskepp", a 400 azt, hogy "javitsd ki, amit kuldtel".
 */
export class AssetPerformancePairError extends Error {
  constructor(readonly hiany: "unit" | "szam" | "alak") {
    super(
      hiany === "unit"
        ? "A teljesítményhez mértékegységet is kell választani."
        : hiany === "szam"
          ? "A mértékegység mellé teljesítmény-értéket is kell írni."
          : "A teljesítmény csak szám lehet, legfeljebb hat tizedesjeggyel (például 0,5 vagy 500).",
    );
  }
}

/**
 * A TERFOGAT ALAKJA -- UGYANAZ A SZABALY, MINT A TELJESITMENYNEL, DE PAR
 * NELKUL: a `volume`-nak nincs mertekegyseg-tarsa (mindig m3), tehat itt
 * csak az ALAK szamit, nem a par teljessege.
 */
export class AssetVolumeMalformedError extends Error {
  constructor() {
    super(
      "A térfogat csak szám lehet, legfeljebb hat tizedesjeggyel (például 0,5 vagy 500).",
    );
  }
}

/**
 * A FOGYASZTAS ALAKJA -- UGYANAZ A SZABALY, MINT A TERFOGATNAL. Balazs
 * kerese (2026-09-23, kanban 8c77cf3e): ossze akarja adni a fogyasztast,
 * tehat ennek SZAMNAK kell lennie -- a P1/P2 alaku eredeti szoveget a
 * `powerConsumptionRaw` orzi, arra nincs alak-megkotes.
 */
export class AssetPowerConsumptionMalformedError extends Error {
  constructor() {
    super(
      "A fogyasztás csak szám lehet, legfeljebb hat tizedesjeggyel (például 0,5 vagy 500). Az eredeti értéket a másik mezőbe írd.",
    );
  }
}

export function scopeMaySeeAssetEvent(
  event: { type: string; payload: unknown },
  scope: PartnerScope,
): boolean {
  if (scope.kind === "internal") return true;

  const payload = event.payload;
  const fields =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const namesADocument =
    DOCUMENT_EVENT_TYPES.includes(event.type) || payloadNamesADocument(payload);
  if (!namesADocument) return true;

  const documentType = fields.documentType;
  const known = DOCUMENT_TYPES.find((type) => type === documentType);
  if (!known) return false;
  return scopeMaySeeDocumentType(known, scope);
}

function optionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

function optionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

/**
 * A TERFOGAT NORMALIZALT ALAKJA, VAGY DOBAS -- A TRANZAKCION KIVUL, UGYANOTT,
 * AHOL A MATRICAKOD ALAK-ELLENORZESE ALL: nem ir, tehat nincs keresnivaloja
 * az ujraprobalt lezaron belul.
 *
 * URES SZOVEG TORLES (kivezetve a `null`-lal), NEM ALAK-HIBA -- ugyanaz a
 * kulonbsegtetel, mint a teljesitmenynel: az uresen hagyott mezo es az
 * elgepelt szam KET kulonbozo eset.
 */
function volumeValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const normalized = normalizePerformanceValue(trimmed);
  if (normalized === null) throw new AssetVolumeMalformedError();
  return normalized;
}

/**
 * A FOGYASZTAS NORMALIZALT ALAKJA, VAGY DOBAS -- SZO SZERINT A `volumeValue`
 * SZERKEZETE, mas hibaosztallyal.
 */
function powerConsumptionValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const normalized = normalizePerformanceValue(trimmed);
  if (normalized === null) throw new AssetPowerConsumptionMalformedError();
  return normalized;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function hierarchyItem(row: {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetHierarchyItem["kind"];
  status: AssetHierarchyItem["status"];
}): AssetHierarchyItem {
  return {
    id: row.id,
    assetNumber: row.assetNumber,
    name: row.name,
    kind: row.kind,
    status: row.status,
  };
}

function addressSummary(
  row: AssetSummaryRow["customerAddress"],
): AssetAddressSummary | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name ?? undefined,
    formatted: `${row.postalCode} ${row.city}, ${row.line1}${row.line2 ? `, ${row.line2}` : ""}`,
  };
}

function supplierAddressSummary(
  row: AssetSummaryRow["supplier"],
): AssetAddressSummary | undefined {
  if (!row) return undefined;
  const formatted = [
    [row.postalCode, row.city].filter(Boolean).join(" "),
    row.addressLine1,
    row.addressLine2,
  ]
    .filter(Boolean)
    .join(", ");
  return formatted
    ? { id: `supplier:${row.id}`, name: undefined, formatted }
    : undefined;
}

function jsonPayload(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

/**
 * A SZAMLALO KIINDULOPONTJA: MINDEN ALLAPOT NULLAN.
 *
 * KET DOLGOT CSINAL EGYSZERRE, es ezert nem tomb:
 *
 * 1. A NULLAS ALLAPOT IS SZEREPEL. A `groupBy` csak a LETEZO sorokat adja
 *    vissza, tehat egy ma ures allapot kulcs NELKUL erkezne -- a kliensen a
 *    hianyzo kulcs pontosan ugy nez ki, mint a nulla, csak eppen nem az: a
 *    csempe gondolatjelet mutatna "0" helyett.
 *
 * 2. A FORDITO KENYSZERITI A TELJESSEGET. `Record<AssetStatus, 0>` alakban egy
 *    UJ allapot ide is kell, kulonben a forditas all meg, nev szerint. Egy
 *    felsorolo TOMB ezt nem tudja: abbol csendben kimaradhat egy ertek, es a
 *    csempek egy letezo allapotot nem is emlitenenek.
 */
/**
 * AZ ESZKOZ-LISTA KET `where`-JE, EGY HIVASBOL -- ES EZ MAGA AZ ORZO.
 *
 * A fuggveny MIND A KETTOT visszaadja, ugyanabbol a `visibility` valtozobol.
 * Igy a jogosultsagi ag nem tud CSAK AZ EGYIKBOL kimaradni: nincs hova
 * "elfelejteni" odatenni, mert egyszer all ott.
 *
 * ELOSZOR KET KULON HIVAS VOLT, es a kalibracio megfogta, hogy az KEVES: a
 * hivasi helyen le lehetett cserelni a szamlalo feltetelet a jogosultsag
 * nelkulire, es SEM az itteni egyseg-teszt, SEM a forras-szintu
 * placement-orzo nem szolt. Az elso a fuggvenyt meri, a masodik azt, hogy a
 * MEGLEVO hivasok jo helyen allnak -- egyik sem azt, hogy a szamlalo
 * egyaltalan hasznalja-e. Egy orzo, ami a sajat hibajara nem tud elbukni,
 * nem orzo.
 *
 * MIERT KELL EZ KIMONDVA: a hibajegyeknel a mintat ugy irtak le, hogy a
 * szamlalo "szandekosan nem kap scope-ot". OTT a `scope` a felhasznalo sajat
 * szukitese. ITT a `PartnerScope` a LATHATOSAGI hatar: az dönti el, hogy egy
 * vevo- vagy szallito-felhasznalo latja-e egyaltalan a sort. Elhagyva a
 * csempek IDEGEN PARTNER eszkozeit szamolnak meg -- nem kenyelmi kerdes,
 * hanem adatszivargas.
 *
 * A JOGOSULTSAGI SZURO `AND` AGKENT ALL, SOHA NEM KULCSKENT: a felhasznaloi
 * szuro `customerId` / `supplierId` kulcson spreadel es felso szintu `OR`-t is
 * tartalmaz (kereses), barmelyik hatastalanitana egy szinten.
 */
/**
 * A RESZLETLAP FELTETELE -- KIEMELVE, HOGY MERHETO LEGYEN.
 *
 * Ugyanaz a megfontolas, ami az `assetListWheres`-t is kiemelte: a feltetel
 * ADATBAZIS NELKUL is allithato, tehat nem egy integracios futasra kell varni
 * ahhoz, hogy a lathatosagi hatar merve legyen.
 *
 * ES A LATHATOSAG UGYANABBOL A FUGGVENYBOL JON, AMIT A LISTA HASZNAL. Ez a
 * lenyeg, nem a kiemeles: 2026-09-21-ig a reszletlap egy MASIK szabalyt
 * futtatott (`rowBelongsToScope`, a betoltott soron), ami csak a sor sajat
 * gazdajat nezte -- es ettol a reszlegen at lathato eszkoz adatlapja 404-et
 * adott. Eles adat aznap: 79 eszkozbol 79 ilyen.
 *
 * A JOGOSULTSAGI SZURO `AND` AGKENT ALL, ugyanabbol az okbol, mint a listanal:
 * egy kesobb spreadelt testverkulcs kulonben hatastalanitana.
 */
export function assetDetailWhere(
  id: string,
  scope: PartnerScope,
  assignedUnitIds: readonly string[],
): Prisma.AssetWhereInput {
  return {
    AND: [{ id }, assetVisibilityForAndBranch(scope, assignedUnitIds)],
  };
}

export function assetListWheres(
  scope: PartnerScope,
  assignedUnitIds: readonly string[],
  userWhereWithoutStatus: Prisma.AssetWhereInput,
  statusWhere: Prisma.AssetWhereInput,
): { list: Prisma.AssetWhereInput; counts: Prisma.AssetWhereInput } {
  /**
   * A HIVAS MIND A KET AGBAN KIIRVA ALL, es NEM egy kozos valtozobol jon.
   *
   * Egy kozos valtozoba kiemelve olvashatobb lenne, de a
   * `auth/partner-scope-and-branch.spec.ts` a FORRAST olvassa, es azt nezi,
   * hogy minden hatokor-segedhivas `AND` tombon BELUL all.
   * Valtozoba tett hivast statikusan nem tud kovetni -- ki is bukott rajta,
   * amikor igy irtam meg. Az az orzo MINDEN hivasi helyet nezi, az enyem egyet:
   * az erosebbhez igazodom, nem forditva.
   *
   * ES A SEGEDFUGGVENY NEVET SEM IRJUK IDE KI HIVAS-ALAKBAN: az orzo a fajl
   * SZOVEGET nezi, tehat egy magyarazo komment, ami idezi a hivast, HAMIS
   * bukast okoz. Elso korben pont ez tortent.
   */
  return {
    list: {
      AND: [
        assetVisibilityForAndBranch(scope, assignedUnitIds),
        { ...userWhereWithoutStatus, ...statusWhere },
      ],
    },
    counts: {
      AND: [
        assetVisibilityForAndBranch(scope, assignedUnitIds),
        userWhereWithoutStatus,
      ],
    },
  };
}

const ZERO_PER_STATUS: Record<AssetStatus, 0> = {
  ACTIVE: 0,
  WARM_STANDBY: 0,
  COLD_STANDBY: 0,
  IN_REPAIR: 0,
  RETIRED: 0,
};

@Injectable()
export class ServiceAssetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * AZ ALEGYSÉG SZERINTI SZŰRÉS EGY ELŐZETES LEKÉRDEZÉST IGÉNYEL, és ezért áll
   * a `where` fölött: a fa mélysége nem korlátos, a Prisma pedig rekurzív
   * lekérdezést nem tud kifejezni. A részfát ezért két lépésben állítjuk elő --
   * egy köteg sor, majd egy tiszta bejárás (`collectUnitSubtreeIds`).
   */
  private async unitSubtreeIds(
    departmentIds: readonly string[],
  ): Promise<string[]> {
    const found = await prisma.worksheetDepartment.findMany({
      where: { id: { in: [...departmentIds] } },
      select: { id: true, customerId: true },
    });
    const customerIdOf = new Map(found.map((row) => [row.id, row.customerId]));

    // A BEJÁRÁS AZ ÖSSZES ÉRINTETT PARTNER SORAIT KAPJA, NEM CSAK EGYÉT. Egy
    // értéknél ez nem tudott előállni, a többes alak hozza be: ha a megadott
    // azonosítók KÜLÖNBÖZŐ partnerekhez tartoznak, egyetlen partner sorai
    // hiányos részfát adnának -- és az nem üres listaként jelentkezne, hanem
    // KEVESEBB SORKÉNT, ami sokkal kevésbé feltűnő.
    const customerIds = [...new Set(customerIdOf.values())];
    const units = customerIds.length
      ? await prisma.worksheetDepartment.findMany({
          where: { customerId: { in: customerIds } },
          select: { id: true, name: true, parentId: true },
        })
      : [];

    // NEM LÉTEZŐ ALEGYSÉG: a saját azonosítójára szűkül, ami egyetlen eszközre
    // sem illeszkedik. Unióban ez azt jelenti, hogy a nem létező ág nulla sort
    // hoz, és a TÖBBIT nem rontja el -- de nem is tűnik el csendben. A csábító
    // alternatíva (nincs szűrő) egy elgépelt azonosítóra a TELJES listát adná
    // vissza, hibaüzenet nélkül.
    const ids = new Set<string>();
    for (const departmentId of departmentIds) {
      if (!customerIdOf.has(departmentId)) {
        ids.add(departmentId);
        continue;
      }
      for (const id of collectUnitSubtreeIds(units, departmentId)) ids.add(id);
    }
    return [...ids];
  }

  async list(
    query: AssetListQueryDto,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ): Promise<AssetListResponse> {
    // A KÉT MEZŐ EGYÜTT IS MEGADHATÓ, és a szűrő az uniójuk. A singularis alak
    // marad, hogy a meglévő hívások betűre változatlanok legyenek.
    const requestedUnitIds = [
      ...(query.departmentId ? [query.departmentId] : []),
      ...(query.departmentIds ?? []),
    ];
    const departmentIds = requestedUnitIds.length
      ? await this.unitSubtreeIds(requestedUnitIds)
      : null;
    // A JOGOSULTSAGI SZURO `AND` AGKENT, SOHA NEM KULCSKENT -- lasd a
    // scopeWhereForAndBranch jegyzetet. Az alabbi objektum a FELHASZNALOI
    // szurot `customerId` / `supplierId` KULCSON spreadeli, es felso szintu
    // `OR`-t is tartalmaz (kereses); barmelyik hatastalanitana a jogosultsagot,
    // ha egy szintre kerulne vele.
    /**
     * A FELHASZNALOI SZURO AZ ALLAPOT NELKUL. A csempek EZT a halmazt bontjak
     * allapotokra, tehat a sajat dimenziojuk nem lehet benne -- kulonben a
     * "javitas alatt" csempe a MAR javitas alatt szurt listat szamolna meg, es
     * mindig a lista hosszat mutatna.
     *
     * Minden MAS szuro viszont benne marad (kereses, tipus, tulajdonos,
     * helyszin): a csempek es a lista igy ugyanarrol a halmazrol beszelnek.
     */
    const userWhereWithoutStatus: Prisma.AssetWhereInput = {
      ...assetOwnerScopeWhere(query.ownerScope),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.ownerType === "CUSTOMER" && query.ownerId
        ? { customerId: query.ownerId }
        : query.ownerType === "SUPPLIER" && query.ownerId
          ? { supplierId: query.ownerId }
          : {}),
      ...(departmentIds ? { departmentId: { in: departmentIds } } : {}),
      ...(query.aquariumId ? { aquariumId: query.aquariumId } : {}),
      /**
       * A KET MATRICA-SZURO EGY HELYEN EPUL OSSZE (`assetLabelWhere`).
       *
       * NEM KET SPREAD: mindketto ugyanarra a `label` kulcsra ir, tehat a
       * masodik NEMAN felulirna az elsot. A fuggveny jegyzete leirja a mert
       * esetet; a lenyeg, hogy a hiba nem ures listat adott volna, hanem egy
       * ertelmes, nem ures valaszt a MASIK kerdesre.
       *
       * A DTO MAR NORMALIZALT KODOT AD (`toStoredLabelCode`), es a rossz
       * alakut ELUTASITJA -- ide tehat vagy egy tarolhato kod erkezik, vagy
       * semmi.
       */
      /**
       * A KET SZURO EGY `AND` ALA KERUL, NEM KET SZORASSAL.
       *
       * Mindketto `{ AND: [...] }` alakot ad vissza, ha ket aga van -- ket
       * szorasnal tehat a MASODIK elnyelte volna az elsot, es a matrica-
       * feltetel csendben eltunt volna. A `mergeAssetWhere` fejlece leirja a
       * mert esetet; egy erdemi resszel a lekerdezes alakja valtozatlan.
       */
      ...mergeAssetWhere(
        assetLabelWhere(query.label, query.labelCode),
        assetCategoryWhere(query.category, query.categoryId),
      ),
      ...(query.parentAssetId ? { parentAssetId: query.parentAssetId } : {}),
      ...(query.dueBefore
        ? { nextServiceAt: { lte: new Date(query.dueBefore) } }
        : {}),
      /**
       * A KERESO OSSZEALLITASA KULON FAJLBAN (`asset-search-filter.ts`),
       * ugyanabbol az okbol, mint a matrica- es kategoria-szuro: Prisma-
       * kliens nelkul is lemerheto, hogy az OR lista TARTALMAZZA-e egy adott
       * mezot -- lasd az `asset-search-filter.spec.ts` allitasat.
       */
      ...assetSearchWhere(query.search),
    };
    const { list: where, counts: countsWhere } = assetListWheres(
      scope,
      assignedUnitIds,
      userWhereWithoutStatus,
      // A HAROM AG (egy allapot / minden / minden a kivezetetten kivul) egy
      // helyen all, tiszta fuggvenyben -- adatbazis nelkul merheto.
      assetStatusWhere(query.status),
    );
    const [rows, totalItems, counts] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: assetSummaryInclude,
        // A SORREND A LEKERDEZESBOL JON, nem a kliensbol: a lista lapozva megy
        // ki, tehat egy bongeszo-oldali rendezes csak az epp latszo lapot
        // rendezne. A parameter nelkuli hivas a ma is ervenyes nev szerinti
        // sorrendet kapja, beture valtozatlanul.
        orderBy: assetListOrderBy(query.sort, query.direction),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.asset.count({ where }),
      this.countsByStatus(countsWhere),
    ]);
    const paths = await this.unitPaths(rows);
    return {
      items: rows.map((row) => this.toListItem(row, paths)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
      counts,
    };
  }

  /**
   * ALLAPOTONKENTI DARABSZAM, EGY LEKERDEZESBOL.
   *
   * A `groupBy` a LAPOZASTOL FUGGETLEN: a csempek a teljes szurt halmazrol
   * szolnak, nem az epp latszo lapról.
   */
  private async countsByStatus(
    where: Prisma.AssetWhereInput,
  ): Promise<Record<AssetStatus, number>> {
    const rows = await prisma.asset.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
    const counts: Record<AssetStatus, number> = { ...ZERO_PER_STATUS };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  }

  /**
   * KI VÁLASZTHATÓ AZ ESZKÖZ TULAJDONOSÁNAK.
   *
   * A lista a SZERVIZ-jelölt partnereké. A `keep` az az egy tulajdonos, aki már
   * rá van írva egy MEGLÉVŐ eszközre: azt akkor is visszaadjuk, ha ma nem lenne
   * választható, mert a szerkesztő képernyő különben üres mezőt mutatna a
   * helyén, és a mentés vagy elakadna, vagy csendben más tulajdonost írna oda.
   * A sor megjelölve jön (`outsideServiceScope`), tehát a felület meg tudja
   * mutatni, hogy ez örökölt érték, nem ajánlat.
   */
  /**
   * A TULAJDONOS-VALASZTO IS SZUKUL A KEROVEL, es KET UTON, nem egyen.
   *
   * A lista maga a nyilvanvalo ut. A masik a `keep` ag, ami SZANDEKOSAN
   * megkeruli a szurest, hogy egy MAR ROGZITETT eszkoz tulajdonosa a
   * szerkesztoben akkor is latszodjon, ha ma nem lenne valaszthato. Ez belsos
   * keronel helyes, partner-oldalinal viszont pont a legszelesebb kaput nyitna:
   * merve 2026-08-31, egy TOROLT, inaktiv, nem is szerviz-jelolt partner neve,
   * kodja es TELJES postai cime jott vissza egy tetszoleges azonositora.
   *
   * Ezert a `keep` ag is a hatokorhoz kotott. Ugyanaz az alak, mint a
   * dokumentum-szabalynal: egy lista-szures semmit nem er, ha mellette egy
   * elem-lekeres ugyanazt kiadja.
   */
  async owners(
    keep: { type: AssetOwnerType; id: string } | null,
    scope: PartnerScope,
  ): Promise<AssetOwnerListResponse> {
    const suppliers = await prisma.supplier.findMany({
      where: {
        AND: [
          scopeOwnWhereForAndBranch(scope, "supplier"),
          SERVICE_OWNER_PICKABLE_WHERE,
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const items: AssetOwnerListResponse["items"] = [
      ...suppliers.map((supplier) => {
        const formatted = [
          [supplier.postalCode, supplier.city].filter(Boolean).join(" "),
          supplier.addressLine1,
          supplier.addressLine2,
        ]
          .filter(Boolean)
          .join(", ");
        const address = formatted
          ? { id: `supplier:${supplier.id}`, formatted }
          : undefined;
        return {
          type: "SUPPLIER" as const,
          id: supplier.id,
          code: supplier.code,
          displayName: supplier.name,
          isActive: supplier.isActive,
          address,
          addresses: [],
        };
      }),
    ];

    const inherited =
      keep &&
      rowIsScopeOwner({ id: keep.id }, scope, "supplier") &&
      !items.some((item) => item.type === keep.type && item.id === keep.id)
        ? await this.ownerOutsideScope(keep)
        : null;

    return {
      items: [...items, ...(inherited ? [inherited] : [])].sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "hu"),
      ),
    };
  }

  /**
   * A NÉV-ÜTKÖZÉS, A MENTÉS ELŐTT -- lásd a vezérlő jegyzetét a döntésről.
   *
   * KIS- ÉS NAGYBETŰTŐL FÜGGETLEN, ÉS KÖRBEVÁGOTT: ugyanaz a párosítási
   * szabály, amit a mérés (2026-09-23, éles adatbázis) a mai nevekre
   * alkalmazott, mielőtt bevezettük volna. Nincs saját egyediségi index a
   * `name` mezőn, és ez SZÁNDÉKOSAN marad így -- ez figyelmeztetés, nem
   * megkötés, tehát az azonos név a mentés után is átmegy.
   *
   * SZÁNDÉKOSAN NEM SZŰKÍTETT VEVŐNKÉNT: a `assetSummaryInclude` és a
   * `unitPaths`/`toListItem` pár ugyanazt az alakot adja vissza, mint a
   * lista végpont, hogy a hívó lássa, KI és HOL a másik.
   */
  async matchesByName(name: string): Promise<AssetListItem[]> {
    const trimmed = name.trim();
    if (!trimmed) return [];
    const rows = await prisma.asset.findMany({
      where: { name: { equals: trimmed, mode: "insensitive" } },
      include: assetSummaryInclude,
      orderBy: { createdAt: "asc" },
    });
    const paths = await this.unitPaths(rows);
    return rows.map((row) => this.toListItem(row, paths));
  }

  /**
   * Egy KONKRÉT tulajdonos, a szűrés megkerülésével, megjelölve.
   *
   * Az aktivitást sem nézi: egy inaktívvá tett partner is maradhat egy régi
   * eszközön, és az sem indok arra, hogy a szerkesztő elvegye.
   */
  private async ownerOutsideScope(keep: {
    type: AssetOwnerType;
    id: string;
  }): Promise<AssetOwnerListResponse["items"][number] | null> {
    if (keep.type === "SUPPLIER") {
      const supplier = await prisma.supplier.findUnique({
        where: { id: keep.id },
      });
      if (!supplier) return null;
      const formatted = [
        [supplier.postalCode, supplier.city].filter(Boolean).join(" "),
        supplier.addressLine1,
        supplier.addressLine2,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        type: "SUPPLIER",
        id: supplier.id,
        code: supplier.code,
        displayName: supplier.name,
        isActive: supplier.isActive,
        address: formatted
          ? { id: `supplier:${supplier.id}`, formatted }
          : undefined,
        addresses: [],
        outsideServiceScope: true,
      };
    }

    const customer = await prisma.customer.findUnique({
      where: { id: keep.id },
      include: {
        addresses: { orderBy: [{ isDefault: "desc" }, { id: "asc" }] },
      },
    });
    if (!customer) return null;
    return {
      type: "CUSTOMER",
      id: customer.id,
      code: customer.customerNumber,
      displayName: customer.displayName,
      isActive: customer.isActive,
      addresses: customer.addresses.map((address) => ({
        id: address.id,
        name: address.name ?? undefined,
        formatted: `${address.postalCode} ${address.city}, ${address.line1}${address.line2 ? `, ${address.line2}` : ""}`,
      })),
      outsideServiceScope: true,
    };
  }

  /**
   * A KOTELEZO `scope` a mechanizmus maga (lasd a partner-scope.util.ts
   * jegyzetet): elem-lekeresnel az elfelejtett ellenorzes NEMA. A nem lathato
   * sor `null` -- tehat 404, nem 403.
   *
   * === 2026-09-21: UGYANAZ A LATHATOSAG, AMIT A LISTA HASZNAL ===
   *
   * Ez a sor `rowBelongsToScope`-ot hivott, ami CSAK a sor sajat gazdajat nezi
   * (`customerId` / `supplierId`). A LISTA viszont az
   * `assetVisibilityForAndBranch`-et, ami vevoi hatokornel a RESZLEGEN keresztul
   * is beenged. A ket szabaly nem ugyanaz, es a kulonbseg nem elmeleti volt:
   *
   *   eles adat, 2026-09-21: 79 eszkozbol 79 SZALLITOI tulajdonu, sajat
   *   `customerId`-je EGYIKNEK SINCS, es mind a 79 a reszlegen at latszik a
   *   listan. Az egyetlen partner felhasznalo vevoi hatokoru -- vagyis a lista
   *   mind a 79-et megmutatta, es ez a sor mind a 79-re nemet mondott.
   *
   * Balazs 2026-09-21 14:34:07 UTC-kor kimondta a szabalyt ("a partner azokat
   * az eszkozoket latja, aminek a helyszine hozza van rendelve"), tehat A LISTA
   * A HELYES, es ez az oldal veszi at.
   *
   * ES A LATHATOSAG A LEKERDEZESBE KERULT, NEM EGY MASODIK PREDIKATUMBA. Egy
   * `assetVisibleToScope(row, scope)` alaku parhuzamos alak ugyanazt a
   * szetcsuszast szulne ujra, csak kesobb: ket kifejezes ugyanarra a kerdesre.
   * Igy EGY forras van, es ez a fuggveny is csak HIVOJA.
   *
   * A `findUnique` ezert lett `findFirst`: egyedi kulcsra is az AND-elt
   * feltetel dont, nem egy utana futo ellenorzes.
   */
  async detail(
    id: string,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ): Promise<AssetDetail | null> {
    const row = await prisma.asset.findFirst({
      where: assetDetailWhere(id, scope, assignedUnitIds),
      include: assetDetailInclude,
    });
    if (!row) return null;
    return this.toDetail(
      row,
      await this.ancestors(row.parentAssetId),
      await this.unitPaths([row]),
      scope,
    );
  }

  /**
   * A TULAJDONOS KERDESE 2026-09-22 OTA ITT IS ELLENORIZVE VAN.
   *
   * === AMI ITT ALLT, ES MIERT NEM ALL TOBBE ===
   *
   * "A TULAJDONOS KERDESE ITT SZANDEKOSAN NINCS ELLENORIZVE (spec 4.1): a
   * `qrToken` 128 bites veletlen uuid, tehat a birtoklasa maga a felhatalmazas
   * az ESZKOZRE."
   *
   * Balazs ezt felulirta 2026-09-22 08:55:25 UTC-kor, szo szerint: "ne lassa"
   * -- arra a kerdesre, hogy a partner embere egy NEM hozza rendelt helyszinen
   * beolvasva lassa-e az eszkozt. A sor-szintu szuro azota a metodus torzseben
   * all, ugyanazzal a fuggvennyel, amit a lista es az adatlap hasznal.
   *
   * A JEGYZET AZERT MARAD ITT ATIRVA, ES NEM TOROLVE: a mondat egy LEIRT
   * spec-pontra (4.1) hivatkozott, tehat aki csak a kodot latja, azt hinne,
   * hogy valaki megkerulte a specet. Igy latszik, hogy felulirtak, es ki.
   *
   * A DOKUMENTUM-TIPUS KERDESE VALTOZATLAN, es fuggetlen a fentitol: a partner
   * a sajat eszkoze tokenjet jogosan ismeri, tehat a tipus-szures nelkul ezen
   * az uton hozzajutna ahhoz a szamlahoz, amit az adatlapon es a letoltesen mar
   * nem kap meg. Egy korlat, ami csak az utak egy reszen all, nem korlat.
   */
  /**
   * A FELHASZNALOHOZ RENDELT HELYSZINEK, A KOZOS LEKERDEZESSEL.
   *
   * Vekony atjaro: a valodi lekerdezes a `service-jobs/assigned-units.query.ts`
   * fajlban all, es UGYANAZ a fuggveny szolgalja ki a hibajegyeket, a
   * munkalapokat es az eszkozoket. Ha ez a harom kulon lekerdezessel menne, a
   * "mit lathat" szabaly harom helyen allna -- es ket kulonbozo bejaras
   * ugyanarra a fara ket kulonbozo valaszt tudna adni.
   *
   * URES HALMAZ ERVENYES VALASZ: akinek nincs hozzarendelese, nem lat eszkozt.
   * Ez Balazs dontese (2026-09-22 07:46:59), nem mellekhatas.
   */
  async assignedUnitIds(userId: string): Promise<string[]> {
    return assignedUnitIdsFor(userId);
  }

  async detailByQrToken(
    qrToken: string,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ): Promise<AssetDetail | null> {
    /*
      A SOR-SZINTU SZURO 2026-09-22 OTA ITT IS ALL, ES EZ EGY LEIRT
      SPEC-DONTEST IR FELUL. A reszletek a vegpont jegyzeteben
      (`service-assets.controller.ts`, a `scan` folott), a gazda idezetevel.

      UGYANAZ A FUGGVENY, amit a lista es az adatlap hasznal: a beolvasott
      eszkoz PONTOSAN annyira lathato, mint amennyire a listan lenne. Egy
      kulon szabaly itt ugyanaz a szetcsuszas lenne, ami a 671f87f0-t okozta.

      A BELSOS HIVO VALTOZATLAN: ott a fuggveny ures szurot ad, tehat a
      szerelonk beolvasasa tovabbra is barmelyik ott allo eszkozt megnyitja.
    */
    const row = await prisma.asset.findFirst({
      where: {
        AND: [{ qrToken }, assetVisibilityForAndBranch(scope, assignedUnitIds)],
      },
      include: assetDetailInclude,
    });
    return row
      ? this.toDetail(
          row,
          await this.ancestors(row.parentAssetId),
          await this.unitPaths([row]),
          scope,
        )
      : null;
  }

  /**
   * A HAROM SZAMLALO, EGY KORBEN. Kulon lekerdezes mindharomra, mert a
   * `assetDeletionRefusal` kulon ertekeket var -- lasd ott, miert nem egy
   * osszevont logikai ertek.
   */
  async deletionBlockers(assetId: string): Promise<AssetDeletionBlockers> {
    const [serviceJobs, worksheetLines, childAssets] = await Promise.all([
      prisma.serviceJobAsset.count({ where: { assetId } }),
      prisma.worksheetLine.count({ where: { assetId } }),
      prisma.asset.count({ where: { parentAssetId: assetId } }),
    ]);
    return { serviceJobs, worksheetLines, childAssets };
  }

  /**
   * A TORLES SAJAT VEGPONTON ALL, NEM EGY LISTA VAGY FRISSITES
   * MELLEKHATASAKENT. Az esemenyek es a dokumentumok kaszkadban mennek vele (a
   * sema igy all); a hibajegy- es munkalap-kapcsolat `Restrict`, tehat az
   * adatbazis maga is megtagadna -- de egy nyers adatbazis-hiba nem mondja meg,
   * MELYIK feltetel miatt, es epp az a kerdes erdekli a felhasznalot.
   */
  async remove(id: string): Promise<void> {
    await prisma.asset.delete({ where: { id } });
  }

  async validationContext(input: {
    ownerType: "CUSTOMER" | "SUPPLIER";
    ownerId: string;
    customerAddressId?: string | null;
    departmentId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const [
      customer,
      supplier,
      address,
      department,
      aquarium,
      parent,
      productVariant,
    ] = await Promise.all([
      input.ownerType === "CUSTOMER"
        ? prisma.customer.findUnique({
            where: { id: input.ownerId },
            select: { id: true, isActive: true },
          })
        : null,
      input.ownerType === "SUPPLIER"
        ? prisma.supplier.findUnique({
            where: { id: input.ownerId },
            // `customerId` a TÜKÖR vevő-sor: az alegységek azon lógnak, nem
            // magán a szállítón.
            select: { id: true, isActive: true, customerId: true },
          })
        : null,
      input.customerAddressId
        ? prisma.customerAddress.findUnique({
            where: { id: input.customerAddressId },
            select: { id: true, customerId: true },
          })
        : null,
      input.departmentId
        ? prisma.worksheetDepartment.findUnique({
            where: { id: input.departmentId },
            select: { id: true, customerId: true, isActive: true },
          })
        : null,
      input.aquariumId
        ? prisma.aquarium.findUnique({
            where: { id: input.aquariumId },
            select: { id: true, customerId: true, isActive: true },
          })
        : null,
      input.parentAssetId
        ? prisma.asset.findUnique({
            where: { id: input.parentAssetId },
            select: {
              id: true,
              customerId: true,
              supplierId: true,
              customerAddressId: true,
              aquariumId: true,
              status: true,
            },
          })
        : null,
      input.productVariantId
        ? prisma.productVariant.findUnique({
            where: { id: input.productVariantId },
            select: { id: true, isActive: true },
          })
        : null,
    ]);
    return {
      customer,
      supplier,
      address,
      department,
      aquarium,
      parent,
      productVariant,
    };
  }

  async basic(id: string) {
    return prisma.asset.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        supplierId: true,
        customerAddressId: true,
        aquariumId: true,
        parentAssetId: true,
        productVariantId: true,
        status: true,
        installedAt: true,
        lastServicedAt: true,
        serviceIntervalDays: true,
        nextServiceAt: true,
        updatedAt: true,
        _count: { select: { childAssets: true } },
      },
    });
  }

  async wouldCreateCycle(assetId: string, parentAssetId: string) {
    let currentId: string | null = parentAssetId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === assetId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      const row: { parentAssetId: string | null } | null =
        await prisma.asset.findUnique({
          where: { id: currentId },
          select: { parentAssetId: true },
        });
      currentId = row?.parentAssetId ?? null;
    }
    return false;
  }

  async create(
    input: CreateAssetDto,
    actorUserId: string,
    /**
     * A `generatePartnerInternalCode` KAPUJA A HÍVÓ OLDALÁN DŐL EL
     * (`service-assets.service.ts`, `shouldGeneratePartnerInternalCode`),
     * A GENERÁLÁS MAGA VISZONT ITT TÖRTÉNIK, A TRANZAKCIÓN BELÜL.
     *
     * Ez szándékos eltérés a kérés szó szerinti helyétől ("service.ts
     * create(), a repository.create() előtt"): a versenyhelyzet elleni zár
     * (`pg_advisory_xact_lock`) csak akkor véd, ha UGYANABBAN a tranzakcióban
     * áll, mint a beszúrás -- egy service-oldali előzetes generálás és egy
     * külön repository-tranzakció között két párhuzamos felvitel ugyanazt a
     * szabad sorszámot olvashatná ki.
     */
    options: { generatePartnerInternalCode?: boolean } = {},
  ): Promise<AssetDetail> {
    /**
     * AZ ESZKOZSZAM UTKOZESE UJRAPROBALKOZAST KAP. Ket eszkoz akkor kap azonos
     * szamot, ha ugyanabban a masodpercben keszul es a generator ugyanazt a
     * negyjegyu veget huzza. A burkolat CSAK a tranzakciot ismetli meg, UJ
     * kodddal; a tranzakcion BELUL nem lehet ujraprobalni, mert Postgres az
     * elso elbukott utasitas utan megszakitja.
     */
    /**
     * A KOD ALAKJA MAR ITT ELDOL, A TRANZAKCION KIVUL.
     *
     * Az alak-ellenorzes nem ir, tehat semmi keresnivaloja az ujraprobalt
     * lezaron belul: egy ritka eszkozszam-utkozes nem futtathatja le megegyszer
     * azt, aminek az eredmenye ugyanaz lenne.
     */
    const labelCode =
      input.labelCode === undefined
        ? null
        : normalizeAssetLabelCode(input.labelCode);
    if (input.labelCode !== undefined && labelCode === null)
      throw new AssetLabelUnavailableError(input.labelCode);

    /**
     * A TELJESITMENY PARJA, UGYANITT ES UGYANEZERT: nem ir, tehat nincs
     * keresnivaloja a tranzakcion belul.
     *
     * A TABLAN ALLO CHECK a vegso vedelem, ez a sor NEM helyettesiti -- azert
     * all elotte, hogy a kezelo MONDATOT kapjon, ne egy megkotes nevet.
     */
    const teljesitmeny = teljesitmenyEredmenye(
      { performance: null, unitId: null },
      input,
    );
    if (!teljesitmeny.rendben)
      throw new AssetPerformancePairError(teljesitmeny.hiany);

    /**
     * A TERFOGAT ALAKJA, UGYANITT ES UGYANEZERT -- de par nelkul, lasd a
     * `volumeValue` fejleceit.
     */
    const volume = volumeValue(input.volume);
    /** A FOGYASZTAS ALAKJA, UGYANITT -- lasd a `powerConsumptionValue` fejleceit. */
    const powerConsumption = powerConsumptionValue(input.powerConsumption);

    /**
     * A HELYSZINI ROGZITES IDEMPOTENCIA-KULCSA, A LETREHOZAS ELOTT.
     *
     * A telefon terero nelkul sorba teszi a felvitelt, es a sor a halozati
     * hibat SZANDEKOSAN ujraprobalja -- offline az a normalis allapot. Pontosan
     * ott lehet viszont, hogy ez a kod MAR lefutott, es csak a valasz veszett
     * el. Kulcs nelkul az ujrakuldes MASODIK eszkozt hozna letre.
     *
     * A KERESES NEM ONMAGABAN A VEDELEM: ket parhuzamos keres a kereses es a
     * beszuras kozott elcsuszhat. Azt az esetet az EGYEDI INDEX vagja el, es a
     * lenti `catch` forditja vissza ugyanarra a valaszra -- nem hibara. Egy
     * felvitel, ami ketszer erkezik, EGY eszkozt kell hogy adjon, ketszer.
     */
    if (input.clientOperationId) {
      const meglevo = await prisma.asset.findUnique({
        where: { clientOperationId: input.clientOperationId },
        select: { id: true },
      });
      if (meglevo) return this.readBack(meglevo.id);
    }

    let id: string;
    try {
      id = await withUniqueCode(
        /**
         * AZ EGYETLEN HELY, AHOL A BELYEG HELYI IDO SZERINT ALL.
         *
         * Az eszkozszam kerul CIMKERE, es ott egy ember olvassa le. A tobbi
         * csalad belyege UTC marad -- a beszerzesi bizonylatszam es a POS
         * rendelesszam kulso rendszerbe is kimegy, es azok alakjat ez a kor
         * szandekosan nem valtoztatja.
         *
         * A `h` a valtas jelolese: a mar kiadott szamok visszamenoleg nem
         * valtoznak, tehat jeloles nelkul ugyanaz a mezo ket dolgot jelentene,
         * kivulrol megkulonboztethetetlenul.
         */
        /**
         * A `field` CSAK az `assetNumber`, ES EZ SZANDEKOS.
         *
         * A burkolat azert er valamit, mert a kodot ujra HUZZA: egy masodik
         * kiserlet uj eszkozszamot kap. A MATRICAKOD viszont a felhasznalotol
         * jon, es valtozatlan marad -- egy ujraprobalas ugyanazt a foglalt kodot
         * kuldene be otszor, elkoltene a probalkozasokat, es a hivo ugyanazt a
         * hibat kapna, csak kesobb.
         *
         * AMIT EZ SZANDEKOSAN ATENGED: az `AssetLabel.assetId` es az
         * `AssetLabel.code` egyedi indexenek serulese. Az nem szerencsetlen
         * huzas, hanem valodi utkozes, es HANGOSAN kell elbuknia.
         */
        { prefix: "ESZK", field: "assetNumber", stamp: "local-marked" },
        (assetNumber) =>
          /**
           * A TELJES TRANZAKCIÓ ÚJRAPRÓBÁLKOZIK EGY VALÓDI POSTGRES
           * SERIALIZABLE-ÜTKÖZÉSEN (Prisma P2034) -- lásd
           * `transaction-retry.util.ts` saját fejlécét, miért ez a várt,
           * szabványos viselkedés Serializable izolációnál, nem a
           * `pg_advisory_xact_lock` hibája. A zár helyesen szerializálja a
           * kódgenerálás kritikus szakaszát, de az SSI (serializable
           * snapshot isolation) a tranzakció MÁS, a zár által nem védett
           * részein (pl. két egyidejű `tx.asset.create()` ugyanabba a
           * táblába) is jelezhet ütközést -- ugyanaz a minta, mint a
           * `unas-order-sync.repository.ts` `apply()`/`refreshOrder()`-je.
           */
          retryOnSerializationConflict(() =>
            prisma.$transaction(
              async (tx) => {
                /**
                 * A PARTNER BELSŐ KÓDJÁNAK AUTOMATIKUS KÉPZÉSE, ÚJ ESZKÖZNÉL.
                 *
                 * A KAPU (`shouldGeneratePartnerInternalCode`) a hívó oldalán
                 * (`service-assets.service.ts`) dőlt el: szerviz partner
                 * tulajdonos, üres mező, van kategória. Amit a kapu NEM tud
                 * eldönteni, mert adatbázis kell hozzá -- van-e a kategóriának
                 * kódja, van-e a szülőnek/helyszínnek kódja --, azt ITT, a
                 * beszúrással EGY tranzakcióban nézzük meg.
                 *
                 * A ZÁR (`pg_advisory_xact_lock`) A PARTNERRE SZŰKÍTETT, NEM
                 * GLOBÁLIS: két különböző partner egyidejű felvitele nem várja
                 * meg egymást, csak ugyanaz a partner szerializálódik --
                 * ugyanaz a minta, mint a fenti eszköz-hierarchia zárja, csak
                 * a kulcs a `ownerId`-vel egyedi. Enélkül két párhuzamos
                 * felvitel ugyanarra az előtagra ugyanazt a "legkisebb szabad"
                 * sorszámot olvashatná ki, és mindkettő ugyanazt a kódot írná.
                 */
                let generatedPartnerInternalCode: string | null = null;
                if (options.generatePartnerInternalCode && input.categoryId) {
                  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acropora:partner-internal-code:' || ${input.ownerId}))`;
                  const category = await tx.assetCategory.findUnique({
                    where: { id: input.categoryId },
                    select: { code: true },
                  });
                  if (category?.code) {
                    let prefix: string | null;
                    if (input.parentAssetId) {
                      const parent = await tx.asset.findUnique({
                        where: { id: input.parentAssetId },
                        select: { partnerInternalCode: true },
                      });
                      prefix = partnerInternalCodePrefix({
                        isBuiltIn: true,
                        parentPartnerInternalCode:
                          parent?.partnerInternalCode ?? null,
                        rootLocationCode: null,
                        ownLocationCode: null,
                        ownIsRootLocation: false,
                        categoryCode: category.code,
                      });
                    } else {
                      /**
                       * A HELYSZÍN-FA GYÖKERÉIG VALÓ FELFELÉ SÉTA.
                       *
                       * Balázs jóváhagyása (2026-09-24 11:33): a gyökér eszköz
                       * kódjának ELSŐ tagja a LEGFELSŐ helyszín kódja, nem a
                       * saját (esetleg mélyebb szintű) helyszíné -- és a
                       * KÖZBÜLSŐ szintek kimaradnak (FAN-A11, nem
                       * FAN-AKV-A11). A séma mai mélysége legfeljebb négy
                       * szint (acrobot mérése), a ciklus ennél tovább is
                       * helyesen működik, csak nem gyorsabb egy extra
                       * DB-körnél szintenként -- ez a generálás ritka, és a
                       * zár amúgy is szerializálja.
                       */
                      let ownLocationCode: string | null = null;
                      let rootLocationCode: string | null = null;
                      let ownIsRootLocation = false;
                      if (input.departmentId) {
                        const own = await tx.worksheetDepartment.findUnique({
                          where: { id: input.departmentId },
                          select: { code: true, parentId: true },
                        });
                        if (own) {
                          ownLocationCode = own.code;
                          if (own.parentId === null) {
                            rootLocationCode = own.code;
                            ownIsRootLocation = true;
                          } else {
                            let currentParentId: string | null = own.parentId;
                            while (currentParentId) {
                              const node: {
                                code: string;
                                parentId: string | null;
                              } | null =
                                await tx.worksheetDepartment.findUnique({
                                  where: { id: currentParentId },
                                  select: { code: true, parentId: true },
                                });
                              if (!node) break;
                              if (node.parentId === null) {
                                rootLocationCode = node.code;
                                break;
                              }
                              currentParentId = node.parentId;
                            }
                          }
                        }
                      }
                      prefix = partnerInternalCodePrefix({
                        isBuiltIn: false,
                        parentPartnerInternalCode: null,
                        rootLocationCode,
                        ownLocationCode,
                        ownIsRootLocation,
                        categoryCode: category.code,
                      });
                    }
                    if (prefix) {
                      const existing = await tx.asset.findMany({
                        where: {
                          supplierId: input.ownerId,
                          partnerInternalCode: { startsWith: `${prefix}-` },
                        },
                        select: { partnerInternalCode: true },
                      });
                      generatedPartnerInternalCode =
                        nextFreePartnerInternalCodeSerial(
                          prefix,
                          existing.flatMap((existingRow) =>
                            existingRow.partnerInternalCode
                              ? [existingRow.partnerInternalCode]
                              : [],
                          ),
                          input.name,
                        );
                    }
                  }
                }
                const row = await tx.asset.create({
                  data: {
                    assetNumber,
                    customerId:
                      input.ownerType === "CUSTOMER" ? input.ownerId : null,
                    supplierId:
                      input.ownerType === "SUPPLIER" ? input.ownerId : null,
                    customerAddressId:
                      input.ownerType === "CUSTOMER"
                        ? input.customerAddressId
                        : null,
                    aquariumId:
                      input.ownerType === "CUSTOMER" ? input.aquariumId : null,
                    /**
                     * Az alegyseg a masik iranyban all: SZERVIZ PARTNER
                     * eszkozehez tartozik, vevoehez nem. A ket mezo nem
                     * ugyanaz a fogalom.
                     *
                     * A `!` NEM VAKMEROSEG, HANEM A HIVO OLDAL GARANCIAJA.
                     * Ez a `create` metodus KIZAROLAG a
                     * `service-assets.service.ts` `create()`-jebol hivodik
                     * (egyetlen hivohely), es AZ MAR ELUTASITOTTA MIELOTT
                     * idaig eljutna: CUSTOMER eseten a `CUSTOMER_OWNER` ag
                     * (asset-department.ts, `requested`-tol fuggetlenul fut),
                     * SUPPLIER eseten pedig az `assetDepartmentPresenceRefusal`
                     * (letrehozaskor kotelezo). A `departmentId` MEZO tehat
                     * SOHA nem lehet `null`/`undefined` ezen a ponton -- ha
                     * ez a garancia megszunik (uj hivo, a validacio
                     * eltavolitasa), ez a sor a helyes hiba helye, nem a
                     * csendes elnyeles.
                     */
                    departmentId:
                      input.ownerType === "SUPPLIER"
                        ? input.departmentId!
                        : (undefined as unknown as string),
                    parentAssetId: input.parentAssetId,
                    productVariantId: input.productVariantId,
                    kind: input.kind,
                    status: input.status,
                    criticality: input.criticality,
                    name: input.name.trim(),
                    categoryId: input.categoryId || null,
                    functionId: input.functionId || null,
                    manufacturer: optionalText(input.manufacturer),
                    model: optionalText(input.model),
                    serialNumber: optionalText(input.serialNumber),
                    /**
                     * A GENERÁLT KÓD CSAK AKKOR ÍRÓDIK, HA A MEZŐ ÜRES VOLT --
                     * a kézzel beírt érték soha nem íródik felül, mert a
                     * `shouldGeneratePartnerInternalCode` kapuja ezt már a
                     * bemenetnél kizárta (`generatedPartnerInternalCode` ilyenkor
                     * `null` marad, a jobb oldal pedig a beírt értéket adja).
                     */
                    partnerInternalCode:
                      generatedPartnerInternalCode ??
                      optionalText(input.partnerInternalCode),
                    inventoryNumber: optionalText(input.inventoryNumber),
                    electricalCode: optionalText(input.electricalCode),
                    description: optionalText(input.description),
                    installedAt: optionalDate(input.installedAt),
                    purchasedAt: optionalDate(input.purchasedAt),
                    warrantyExpiresAt: optionalDate(input.warrantyExpiresAt),
                    serviceIntervalDays: input.serviceIntervalDays,
                    lastServicedAt: optionalDate(input.lastServicedAt),
                    nextServiceAt:
                      optionalDate(input.nextServiceAt) ??
                      (input.serviceIntervalDays
                        ? addDays(
                            optionalDate(input.lastServicedAt) ??
                              optionalDate(input.installedAt) ??
                              new Date(),
                            input.serviceIntervalDays,
                          )
                        : undefined),
                    notes: optionalText(input.notes),
                    performance: teljesitmeny.performance,
                    performanceUnitId: teljesitmeny.unitId,
                    volume,
                    powerConsumption,
                    powerConsumptionRaw: optionalText(
                      input.powerConsumptionRaw,
                    ),
                    clientOperationId: input.clientOperationId ?? null,
                    archivedAt:
                      input.status === "RETIRED" ? new Date() : undefined,
                    createdById: actorUserId,
                    updatedById: actorUserId,
                  },
                  include: assetDetailInclude,
                });
                await tx.assetEvent.create({
                  data: {
                    id: randomUUID(),
                    assetId: row.id,
                    type: "CREATED",
                    actorUserId,
                    payload: jsonPayload({
                      assetNumber: row.assetNumber,
                      customerId: row.customerId,
                      supplierId: row.supplierId,
                      parentAssetId: row.parentAssetId,
                      status: row.status,
                    }),
                  },
                });
                /**
                 * A MATRICA HOZZAKOTESE UGYANEBBEN A TRANZAKCIOBAN.
                 *
                 * MIERT ITT, ES NEM UTANA: ha kulon menne, keletkezhetne egy
                 * eszkoz matrica nelkul, es a szerelo azt latna, hogy a felvitel
                 * sikerult. A `42056ab0` kartya pont ezt az alakot zarja ki.
                 *
                 * A FELTETELES `updateMany` A VEDELEM, NEM AZ ELOZETES OLVASAS.
                 * Csak azt a sort irja at, ami LETEZIK es MEG SZABAD
                 * (`assetId: null`). Ket parhuzamos felvitel ugyanarra a kodra
                 * igy nem tud mindketto atmenni: a masodik nulla sort erint, es
                 * itt hasal el. Egy elozetes "szabad-e" lekerdezes ugyanezt csak
                 * HINNI tudna, a ket lepes kozott ugyanis eltelik ido.
                 */
                if (labelCode) {
                  const claimed = await tx.assetLabel.updateMany({
                    where: { code: labelCode, assetId: null },
                    data: { assetId: row.id, assignedAt: new Date() },
                  });
                  if (claimed.count !== 1)
                    throw new AssetLabelUnavailableError(labelCode);
                  await tx.assetEvent.create({
                    data: {
                      id: randomUUID(),
                      assetId: row.id,
                      type: "LABEL_ASSIGNED",
                      actorUserId,
                      payload: jsonPayload({ code: labelCode }),
                    },
                  });
                }
                return row.id;
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            ),
          ),
      );
    } catch (error) {
      /**
       * A KET PARHUZAMOS KERES ESETE, ES EZ NEM HIBA.
       *
       * A fenti kereses es ez a beszuras kozott eltelik ido: ha ugyanaz a
       * muvelet-azonosito ketszer erkezik egyszerre, a masodik itt hasal el az
       * EGYEDI INDEXEN. Ilyenkor a hivo ugyanazt a valaszt kapja, mint az elso
       * -- a felvitel EGY eszkozt jelent, akkor is, ha ketszer kertek.
       *
       * A SZURES SZUK: kizarolag a `clientOperationId` utkozese. Egy
       * eszkozszam- vagy matricakod-utkozes VALODI hiba, es hangosan kell
       * elbuknia.
       */
      if (
        input.clientOperationId &&
        isPrismaUniqueConstraintViolation(error, "clientOperationId")
      ) {
        const meglevo = await prisma.asset.findUnique({
          where: { clientOperationId: input.clientOperationId },
          select: { id: true },
        });
        if (meglevo) return this.readBack(meglevo.id);
      }
      throw error;
    }
    return this.readBack(id);
  }

  /**
   * A SAJAT, EPP IRT SOR VISSZAOLVASASA.
   *
   * BELSOS UT: irasi muvelet vegen a hivo vegpont SERVICE_MANAGE jog alatt all.
   * A hatokort a kotelezo parameter miatt ki KELL mondani, es ez helyes: itt
   * nem szukitunk. Kulon fuggveny, mert a kulcs-talalat aga UGYANEZT adja
   * vissza -- ket kulon visszaolvasas ket kulon hatokorre csuszhatna szet.
   */
  private async readBack(id: string): Promise<AssetDetail> {
    // A HOZZARENDELT EGYSEGEK LISTAJA SZANDEKOSAN URES: `internal` hatokornel
    // az `assetVisibilityForAndBranch` ures szurot ad, tehat ez az argumentum
    // ezen az agon nem sul el. Ha valaki egyszer atallitja a hatokort partnerire,
    // az ures lista MINDENT elzar -- vagyis a tevedes HANGOS lesz, nem nema.
    const detail = await this.detail(id, { kind: "internal" }, []);
    if (!detail) throw new Error("ASSET_CREATE_READBACK_FAILED");
    return detail;
  }

  /**
   * ESZKOZ KERESESE A MATRICAKODROL -- ES ITT A TULAJDON ELLENORIZVE VAN.
   *
   * === EZ 2026-09-22-IG A KET BEOLVASO UT LENYEGES KULONBSEGE VOLT. MA MAR NEM. ===
   *
   * Itt az allt, hogy a `detailByQrToken`-ben a tulajdon SZANDEKOSAN nincs
   * nezve (a token birtoklasa a felhatalmazas), tehat a ket ut MAST lat. Balazs
   * azt a kivetelt aznap felulirta, es azota MINDKET ut ugyanazt a lathatosagi
   * fuggvenyt hasznalja. A mondat tehat nem pontatlan lett, hanem HAMIS --
   * ezert all itt atirva.
   *
   * AMI A REGI INDOKBOL VALTOZATLANUL ALL, es ezert visel EZ az ut
   * helyszin-tengelyt: a matricakod egy betu es negy szam, vagyis 260 ezer
   * lehetoseg -- egy hitelesitett SERVICE_VIEW jogu PARTNER-felhasznalo vegig
   * tudna probalni. A qrToken 128 bites veletlen, azt nem.
   *
   * A HATOKOR `AND` AGKENT ALL, nem kulcskent -- lasd a
   * `partner-scope-and-branch.spec.ts` orzot, ami ezt a fajlt is nezi. (A
   * korabbi hivatkozas a `scopeWhereForAndBranch` jegyzetere szinten elavult:
   * ez az ut 2026-09-22 ota nem azt a fuggvenyt hasznalja.)
   *
   * A NEM LATHATO ESZKOZ ES A NEM LETEZO KOD UGYANAZT ADJA (`null`), es ez sem
   * kenyelem: ha a ketto kulonbozne, a valaszokbol felterkepezheto lenne, mely
   * kodok vannak kiadva es kihez tartoznak. A hivonak amugy is ugyanaz a
   * teendoje mindket esetben.
   */
  /**
   * LETEZIK-E KIADOTT, DE ESZKOZHOZ NEM RENDELT MATRICA EZZEL A KODDAL.
   *
   * HATOKOR NELKUL, SZANDEKOSAN: a szabad matrica senkihez nem tartozik, tehat
   * nincs mihez kepest szukiteni. A hatokori DONTES eggyel feljebb all
   * (`scanLabelOutcome`), es ott latszik a KET feltetel egyutt -- itt egy
   * rejtett szures csak elfedne.
   *
   * CSAK IGEN/NEM-ET ad vissza, nem a sort: a kiadas idopontja, a tetel es az
   * azonosito a keszlet adata, es a hivonak egyik sem kell ahhoz, hogy egy
   * matricat eszkozhoz rendeljen.
   */
  async freeLabelExists(code: string): Promise<boolean> {
    const row = await prisma.assetLabel.findFirst({
      where: { code, assetId: null },
      select: { id: true },
    });
    return row !== null;
  }

  async detailByLabelCode(
    code: string,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ): Promise<AssetDetail | null> {
    /*
      UGYANAZ A LATHATOSAGI FUGGVENY, MINT A LISTAN ES AZ ADATLAPON -- ES EZ
      2026-09-22-EN VALTOZOTT MEG, MERESRE.

      AMI ITT ALLT: a KOZOS `scopeWhereForAndBranch`, ami vevo-hatokornel
      PONTOSAN `{ customerId }`. Az csak vevo-tulajdonu sorra illeszkedik --
      elesben viszont 83 eszkozbol 0 ilyen van (acrobot merese, 2026-09-22
      12:07, acropora-prod-01), mert a `create` es az `update` is nullara
      kenyszeriti a `departmentId` mezot vevo-tulajdonu soron.

      VAGYIS EZ AZ UT PARTNERNEK MAR A VALTOZAS ELOTT IS HALOTT VOLT: nem a
      szukites olte meg, soha nem is elt. A felhasznaloi hatas ma nulla mindket
      iranyban -- a partner-felulet ezt a vegpontot nem is hivja (nulla talalat
      az `apps/partner` faban; a mobil es a web BELSOS hatokorrel hasznalja).

      EZERT NEM TAGITAS: ma nullat ad, ezutan annyit fog, amennyit a lista. Egy
      eszkoz, amit a partner a listan lat, legyen megtalalhato a matricajarol is
      -- barmi mas ket kepernyo kozott ellentmondas, amit semmilyen teszt nem
      fogna meg.

      A DONTES acroboté, 2026-09-22 12:11.

      A VEGIGPROBALHATOSAG ERVE VALTOZATLANUL ALL: a matricakod egy betu es
      negy szam, tehat 260 ezer lehetoseg. A helyszin-tengely EPP ezert kell
      bele -- kulonben a vegigprobalas a sajat ugyfel MASIK helyszinet adna.
    */
    const row = await prisma.asset.findFirst({
      where: {
        AND: [
          { label: { code } },
          assetVisibilityForAndBranch(scope, assignedUnitIds),
        ],
      },
      include: assetDetailInclude,
    });
    return row
      ? this.toDetail(
          row,
          await this.ancestors(row.parentAssetId),
          await this.unitPaths([row]),
          scope,
        )
      : null;
  }

  /**
   * EGY GENERALASI TETEL: `count` darab UJ, meg nem letezo kod.
   *
   * A KODOKAT ITT GENERALJUK, nem a hivo adja -- ez a kulonbseg az
   * `importBatch`-hez kepest, ami egy MAR KINYOMTATOTT iv kodjait veszi at.
   *
   * AZ UTKOZES KEZELESE NEM UJRAPROBALKOZAS A TRANZAKCIOBAN. Eloszor
   * osszegyujtjuk a jelolteket a MAR LETEZO kodok ellenében, es csak a kesz
   * halmazt irjuk be. Egy tranzakcion BELULI ujrahuzas azert nem menne, mert a
   * Postgres az elso elbukott utasitas utan az egesz tranzakciot
   * hasznalhatatlanna teszi (lasd a `withUniqueCode` jegyzetet).
   *
   * A KISERLETEK SZAMA KORLATOS, ES EZ NEM ELMELETI. A kod-ter 26-szor 10000,
   * vagyis 260 ezer. Ha egyszer a keszlet nagy resze elfogy, egy korlatlan
   * ciklus NEM hibat adna, hanem VEGTELENUL futna -- a felhasznalo pedig egy
   * poergo gombot latna. Inkabb hasaljon el, megnevezve az okot.
   */
  async issueBatch(count: number): Promise<{
    batchId: string;
    codes: string[];
  }> {
    const letezo = new Set(
      (await prisma.assetLabel.findMany({ select: { code: true } })).map(
        (row) => row.code,
      ),
    );
    const ujak = new Set<string>();
    const maxKiserlet = count * 50 + 1000;
    let kiserlet = 0;
    while (ujak.size < count) {
      kiserlet += 1;
      if (kiserlet > maxKiserlet)
        throw new AssetLabelPoolExhaustedError(count, ujak.size);
      const jelolt = randomAssetLabelCode();
      if (letezo.has(jelolt) || ujak.has(jelolt)) continue;
      ujak.add(jelolt);
    }

    const codes = [...ujak].sort();
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.assetLabelBatch.create({
        data: { requestedCount: count },
        select: { id: true },
      });
      await tx.assetLabel.createMany({
        data: codes.map((code) => ({ code, batchId: created.id })),
      });
      return created;
    });
    return { batchId: batch.id, codes };
  }

  /**
   * MAR KINYOMTATOTT KODOK BETOLTESE UJ TETELKENT.
   *
   * MIERT KULON A `issueBatch`-TOL: az UJ kodokat GENERAL, ez pedig MAR
   * LETEZOKET vesz at -- olyanokat, amik fizikailag mar ki vannak nyomtatva. Az
   * elso tetel eppen ilyen: a 2026-09-02-i tiz kod, amit Balazs mar kinyomtatott
   * es hasznalni kezdett.
   *
   * MEGISMETELHETO, DUPLIKATUM NELKUL. Ha valaki ketszer futtatja, a masodik
   * korben MAR LETEZO kodok nem jonnek letre ujra -- de a valasz KULON
   * megmondja, melyik es hany. A csendes kihagyas itt rosszabb lenne, mint a
   * hiba: a hivo azt hinne, hogy annyi uj matricat toltott be, amennyit kuldott.
   *
   * A TETEL AKKOR IS LETREJON, ha minden kod mar letezett -- es ez SZANDEKOS.
   * A tetel a BETOLTES tenye, nem a kodoke; egy ures tetel a listan pontosan
   * azt mondja, ami tortent: valaki ujra betoltotte ugyanazt.
   */
  async importBatch(rawCodes: readonly string[]): Promise<{
    batchId: string;
    imported: string[];
    alreadyExisted: string[];
  }> {
    const codes: string[] = [];
    for (const raw of rawCodes) {
      const code = normalizeAssetLabelCode(raw);
      if (code === null) throw new AssetLabelUnavailableError(raw);
      if (!codes.includes(code)) codes.push(code);
    }

    const letezo = new Set(
      (
        await prisma.assetLabel.findMany({
          where: { code: { in: codes } },
          select: { code: true },
        })
      ).map((row) => row.code),
    );
    const ujak = codes.filter((code) => !letezo.has(code));

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.assetLabelBatch.create({
        data: { requestedCount: codes.length },
        select: { id: true },
      });
      if (ujak.length > 0)
        await tx.assetLabel.createMany({
          data: ujak.map((code) => ({ code, batchId: created.id })),
        });
      return created;
    });

    return {
      batchId: batch.id,
      imported: ujak,
      alreadyExisted: codes.filter((code) => letezo.has(code)),
    };
  }

  /**
   * A KORABBI GENERALASOK, LEGFRISSEBB ELOL.
   *
   * A SZABAD DARABSZAM SZAMOLVA JON, nem tarolva: azok a sorok, ahol nincs
   * eszkoz. Egy tarolt szamlalo minden eszkoz-felvitelnel karbantartast
   * igenyelne, es az elcsuszasa CSENDES lenne -- a lista tovabbra is szamot
   * mutatna, csak rosszat.
   */
  /**
   * EGY KOTEG KODJAI, A LETOLTESHEZ.
   *
   * KULON VEGPONT, ES NEM A LISTA BOVITESE. Otven koteg otszaz koddal egyetlen
   * valaszban akkor is atmenne a halon, ha senki nem tolt le semmit -- a lista
   * a KOTEGEKROL szol, ez pedig EGY kotegrol.
   *
   * A SORREND A KIADASE (`issuedAt`), nem a kode: a nyomtatott iven a kodok
   * abban a sorrendben allnak, ahogy keletkeztek, es a letoltott fajlnak
   * ugyanazt kell adnia. Egy kod szerinti rendezes UJRARENDEZNE azt, ami a
   * papiron mar rogzitett.
   */
  async labelBatchCodes(batchId: string): Promise<string[] | null> {
    const batch = await prisma.assetLabelBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    // A NEM LETEZO KOTEG ES AZ URES KOTEG KET KULONBOZO VALASZ: az elso
    // elgepelt azonosito (404), a masodik egy koteg, amiben nincs kod. Egy
    // ures tomb mindkettore ugyanazt mondana.
    if (!batch) return null;

    const rows = await prisma.assetLabel.findMany({
      where: { batchId },
      orderBy: { issuedAt: "asc" },
      select: { code: true },
    });
    return rows.map((row) => row.code);
  }

  async listLabelBatches(
    limit: number,
  ): Promise<
    { id: string; createdAt: Date; count: number; freeCount: number }[]
  > {
    const rows = await prisma.assetLabelBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        _count: { select: { labels: true } },
        labels: { where: { assetId: null }, select: { id: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      count: row._count.labels,
      freeCount: row.labels.length,
    }));
  }

  /**
   * A SZABAD KESZLET: azok a sorok, ahol nincs eszkoz.
   *
   * Ez a "kiadott, de hasznalatlan kodok nyilvantartasa" -- nem kulon tabla es
   * nem kulon allapotmezo, hanem maga a hianyzo kapcsolat. Egy `status` oszlop
   * ugyanezt masodszor mondana el, es a ketto elcsuszhatna egymastol.
   */
  async listFreeLabels(
    limit: number,
  ): Promise<{ id: string; code: string; issuedAt: Date }[]> {
    return prisma.assetLabel.findMany({
      where: { assetId: null },
      orderBy: [{ issuedAt: "asc" }, { code: "asc" }],
      take: limit,
      select: { id: true, code: true, issuedAt: true },
    });
  }

  async update(
    id: string,
    input: UpdateAssetDto,
    actorUserId: string,
  ): Promise<AssetDetail> {
    /**
     * A KOD ALAKJA A TRANZAKCION KIVUL DOL EL, ugyanugy, mint a felvitelnel:
     * egy alak-ellenorzes nem ir, tehat nincs keresnivaloja odabent.
     *
     * A HAROM ALLAPOT KULON: `undefined` = a mezot el sem kuldtek, tehat a
     * meglevo matrica MARAD; ervenyes kod = felvitel vagy csere; barmi mas
     * (ures szoveg, rossz alak) = HIBA. Az `AssetLabelUnavailableError` a NYERS
     * koddal megy, mert a szolgaltatas `map` fuggvenye abbol ismeri fel, hogy
     * alak-hibarol van szo, es 400-at ad 409 helyett.
     */
    let labelCode: string | undefined;
    if (input.labelCode !== undefined) {
      const normalizalt = normalizeAssetLabelCode(input.labelCode);
      if (normalizalt === null)
        throw new AssetLabelUnavailableError(input.labelCode);
      labelCode = normalizalt;
    }

    const updatedId = await prisma.$transaction(
      async (tx) => {
        if (input.parentAssetId) {
          // Serialize hierarchy mutations so two concurrent re-parenting
          // requests cannot both pass cycle validation and create A -> B -> A.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acropora:asset-hierarchy'))`;
          let ancestorId: string | null = input.parentAssetId;
          const visited = new Set<string>();
          while (ancestorId) {
            if (ancestorId === id || visited.has(ancestorId))
              throw new Error("ASSET_HIERARCHY_CYCLE");
            visited.add(ancestorId);
            const ancestor: { parentAssetId: string | null } | null =
              await tx.asset.findUnique({
                where: { id: ancestorId },
                select: { parentAssetId: true },
              });
            ancestorId = ancestor?.parentAssetId ?? null;
          }
        }
        const existing = await tx.asset.findUniqueOrThrow({ where: { id } });
        const maintenanceInputsChanged =
          input.serviceIntervalDays !== undefined ||
          input.lastServicedAt !== undefined ||
          input.installedAt !== undefined;
        const interval =
          input.serviceIntervalDays === undefined
            ? existing.serviceIntervalDays
            : input.serviceIntervalDays;
        const lastServicedAt =
          input.lastServicedAt === undefined
            ? existing.lastServicedAt
            : optionalDate(input.lastServicedAt);
        const installedAt =
          input.installedAt === undefined
            ? existing.installedAt
            : optionalDate(input.installedAt);
        const baseDate = lastServicedAt ?? installedAt ?? new Date();
        /**
         * A TELJESITMENY PARJAT AZ EREDMENY DONTI EL, NEM A BEKULDOTT MEZO --
         * ES EZERT ALL EZ ITT BENT, A `labelCode`-dal ELLENTETBEN.
         *
         * A kliens kuldheti kulon a ketto egyiket: egy "csak a szamot irom at"
         * keres TELJESEN ervenyes, ha az egyseg mar all az eszkozon. A
         * felallapotot tehat csak a MEGLEVO sor ismereteben lehet megitelni,
         * az pedig a tranzakcion belul all (`existing`) -- kivul egy masodik
         * olvasas kellene hozza, ami kozben elavulhat.
         */
        const teljesitmeny = teljesitmenyEredmenye(
          {
            performance: existing.performance?.toString() ?? null,
            unitId: existing.performanceUnitId,
          },
          input,
        );
        if (!teljesitmeny.rendben)
          throw new AssetPerformancePairError(teljesitmeny.hiany);
        /**
         * A TERFOGAT ALAKJA, UGYANITT ES UGYANEZERT -- de par nelkul.
         */
        const volume = volumeValue(input.volume);
        /** A FOGYASZTAS ALAKJA, UGYANITT. */
        const powerConsumption = powerConsumptionValue(input.powerConsumption);
        const data: Prisma.AssetUncheckedUpdateManyInput = {
          customerId:
            input.ownerType === undefined
              ? undefined
              : input.ownerType === "CUSTOMER"
                ? input.ownerId
                : null,
          supplierId:
            input.ownerType === undefined
              ? undefined
              : input.ownerType === "SUPPLIER"
                ? input.ownerId
                : null,
          customerAddressId:
            input.ownerType === "SUPPLIER" ? null : input.customerAddressId,
          aquariumId: input.ownerType === "SUPPLIER" ? null : input.aquariumId,
          /**
           * Vevo tulajdonosra valtaskor az alegyseg TORLODIK, ahogy a cim is
           * torlodik szallitora valtaskor: a ket mezo egymast zarja ki.
           *
           * A `!` ITT IS A HIVO OLDAL GARANCIAJA: a
           * `assetDepartmentPresenceRefusal` (update) mar elutasitotta, ha
           * a SZAMITOTT tulajdonos SUPPLIER es a hivo explicit `null`-t
           * kuldott. `undefined` (erintetlen) tovabbra is atmegy, mert az
           * a Prisma szamara "ne modositsd" jelentesu.
           *
           * ISMERT, KIS RES: ez a feltetel a NYERS `input.ownerType`
           * DTO-mezot nezi, nem a service altal SZAMITOTT vegso tulajdonost
           * (`ownerType ?? existing alapjan`). Ha egy MEGLEVO CUSTOMER-
           * eszkozt (ma 0/108 az eles adatbazison, es ujat a
           * CUSTOMER_OWNER szabaly miatt letre sem lehet hozni) explicit
           * ownerType nelkul modositananak, ez az ag `input.departmentId`-t
           * irna, nem `null`-t -- ez a mai adaton nem all elo, de EZ NEM
           * UGYANAZ a garancia, mint a CREATE agon. Kulon figyelmet erdemel,
           * ha valaha ismet lesz CUSTOMER-tulajdonu sor.
           */
          departmentId:
            input.ownerType === "CUSTOMER" ? undefined : input.departmentId!,
          parentAssetId: input.parentAssetId,
          productVariantId: input.productVariantId,
          kind: input.kind,
          status: input.status,
          criticality: input.criticality,
          name: input.name?.trim(),
          /**
           * A MEZO ELHAGYASA ERINTETLENUL HAGYJA, `null` TORLI -- ugyanaz a
           * harom allapot, mint a `parentAssetId`/`productVariantId` par
           * felett, es ugyanaz, amit a DTO fejleceje mindig is igert.
           *
           * ITT KORABBAN `input.categoryId || null` allt, ami az `undefined`-t
           * IS `null`-ra vitte -- vagyis a mezo ELHAGYASA CSENDBEN TOROLTE a
           * kategoriat/funkciot minden olyan PATCH-en, ami mast irt at. Eles
           * hiba, 2026-09-23 (kanban d3facd28): 45 FANK szelepen tunt el
           * ketszer a kategoria, majd a funkcio, ugyanezen a vegponton --
           * mindannyiszor a masik mezo iraskor.
           */
          categoryId: input.categoryId,
          functionId: input.functionId,
          manufacturer: optionalText(input.manufacturer),
          model: optionalText(input.model),
          serialNumber: optionalText(input.serialNumber),
          partnerInternalCode: optionalText(input.partnerInternalCode),
          inventoryNumber: optionalText(input.inventoryNumber),
          electricalCode: optionalText(input.electricalCode),
          description: optionalText(input.description),
          installedAt: optionalDate(input.installedAt),
          purchasedAt: optionalDate(input.purchasedAt),
          warrantyExpiresAt: optionalDate(input.warrantyExpiresAt),
          serviceIntervalDays: input.serviceIntervalDays,
          lastServicedAt: optionalDate(input.lastServicedAt),
          nextServiceAt:
            input.nextServiceAt !== undefined
              ? optionalDate(input.nextServiceAt)
              : maintenanceInputsChanged
                ? interval
                  ? addDays(baseDate, interval)
                  : null
                : undefined,
          notes: optionalText(input.notes),
          performance: teljesitmeny.performance,
          performanceUnitId: teljesitmeny.unitId,
          volume,
          powerConsumption,
          powerConsumptionRaw: optionalText(input.powerConsumptionRaw),
          archivedAt:
            input.status === "RETIRED"
              ? (existing.archivedAt ?? new Date())
              : input.status
                ? null
                : undefined,
          updatedById: actorUserId,
        };
        /**
         * MEZO-SZINTU UTKOZES, NEM SOR-SZINTU (acrobot dontese, 2026-09-04).
         *
         * Eddig a sor idobelyege dontott: ket ember, aki KET KULON mezot ir at,
         * ugyanugy utkozott, mint aki ugyanazt. A webrol ez elviselheto volt --
         * aki elakadt, frissitett es ujra beirta. AZ OFFLINE UTON NEM: a
         * szerelo mar nincs a helyszinen, es az adat annal a pillanatnal es
         * annal a helynel volt, tehat utolag nem all elo.
         *
         * A GYORS UT ELOSZOR: ha a sor idobelyege NEM mozdult, senki nem nyult
         * hozza, es nincs mit lekerdezni. A naplo-olvasas csak akkor fut le,
         * amikor tenylegesen volt kozbeni valtozas.
         */
        const expected = new Date(input.expectedUpdatedAt);
        if (existing.updatedAt.getTime() !== expected.getTime()) {
          const intended = intendedFields(
            existing as unknown as Record<string, unknown>,
            data as unknown as Record<string, unknown>,
          );
          const events = await tx.assetEvent.findMany({
            where: { assetId: id, occurredAt: { gt: expected } },
            select: { type: true, payload: true },
          });
          const conflicts = conflictingFields(intended, events);
          /**
           * A MEZONEVEK A HIBAUZENETBE KERULNEK, es ez nem diszites: egy
           * "valaki modositotta idokozben" mondat nem mondja meg, MIT kell
           * megnezni. A `STALE_UPDATE` nev megmarad, hogy a szolgaltatas
           * lekepezese ne ket helyen alljon.
           */
          if (conflicts.length > 0)
            throw new Error(`FIELD_CONFLICT:${conflicts.join(",")}`);
        }
        /**
         * AZ IRAS AZ AZONOSITORA MEGY, ES EZ A TRANZAKCIO MIATT BIZTONSAGOS: a
         * blokk `Serializable` szinten fut, tehat egy kozbeeso iras a masik
         * tranzakciot megszakitja. Egy `updatedAt` feltetel itt epp azt venne
         * vissza, amit a mezo-szintu ellenorzes megnyert.
         */
        const changed = await tx.asset.updateMany({ where: { id }, data });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");

        const updated = await tx.asset.findUniqueOrThrow({ where: { id } });
        const events: Array<{
          type:
            | "UPDATED"
            | "PLACEMENT_CHANGED"
            | "PARENT_CHANGED"
            | "STATUS_CHANGED"
            | "LABEL_ASSIGNED";
          payload: Prisma.InputJsonObject;
        }> = [];
        if (existing.status !== updated.status)
          events.push({
            type: "STATUS_CHANGED",
            payload: jsonPayload({ from: existing.status, to: updated.status }),
          });
        if (
          existing.customerId !== updated.customerId ||
          existing.supplierId !== updated.supplierId ||
          existing.customerAddressId !== updated.customerAddressId ||
          existing.aquariumId !== updated.aquariumId
        )
          events.push({
            type: "PLACEMENT_CHANGED",
            payload: jsonPayload({
              from: {
                customerId: existing.customerId,
                supplierId: existing.supplierId,
                customerAddressId: existing.customerAddressId,
                aquariumId: existing.aquariumId,
              },
              to: {
                customerId: updated.customerId,
                supplierId: updated.supplierId,
                customerAddressId: updated.customerAddressId,
                aquariumId: updated.aquariumId,
              },
            }),
          });
        if (existing.parentAssetId !== updated.parentAssetId)
          events.push({
            type: "PARENT_CHANGED",
            payload: jsonPayload({
              from: existing.parentAssetId,
              to: updated.parentAssetId,
            }),
          });
        /**
         * A MATRICA UTOLAGOS FELVITELE ES CSEREJE, UGYANEBBEN A TRANZAKCIOBAN.
         *
         * MIERT ITT: ha a felszabaditas es a foglalas kulon menne, egy bukott
         * masodik lepes utan az eszkoz matrica NELKUL maradna ugy, hogy a regi
         * kodja mar szabad -- vagyis ket eszkoz kozott elveszne egy fizikai
         * matrica. A blokk `Serializable` szinten fut, mint a felvitel.
         *
         * A FELTETELES `updateMany` A VEDELEM, NEM AZ ELOZETES OLVASAS. Az
         * alabbi `findFirst` CSAK azt dönti el, kell-e egyaltalan csinalni
         * valamit (es mi volt a regi kod a naplohoz); a FOGLALAS maga tovabbra
         * is `assetId: null` feltetellel megy, tehat ket parhuzamos keres
         * ugyanarra a kodra nem tud mindketto atmenni.
         *
         * A CSERE MEGENGEDETT (acrobot dontese, 2026-09-16): a matrica FIZIKAI,
         * es egy elgepelt kod utan a cserenek mennie kell -- kulonben az eszkoz
         * orokre rossz kodon all, es a kod sem adhato ki masnak.
         *
         * AZ AZONOS KOD NEM ESEMENY: ha ugyanazt a kodot kuldik ujra (a webes
         * urlap a teljes rekordot kuldi), nem szabaditunk fel es nem foglalunk
         * ujra. Enelkul minden mentes irna egy `LABEL_ASSIGNED` sort, es a
         * naplo harom nap alatt olvashatatlanna valna.
         */
        if (labelCode !== undefined) {
          const jelenlegi = await tx.assetLabel.findFirst({
            where: { assetId: id },
            select: { code: true },
          });
          if (jelenlegi?.code !== labelCode) {
            if (jelenlegi)
              await tx.assetLabel.updateMany({
                where: { assetId: id },
                data: { assetId: null, assignedAt: null },
              });
            const claimed = await tx.assetLabel.updateMany({
              where: { code: labelCode, assetId: null },
              data: { assetId: id, assignedAt: new Date() },
            });
            if (claimed.count !== 1)
              throw new AssetLabelUnavailableError(labelCode);
            events.push({
              type: "LABEL_ASSIGNED",
              payload: jsonPayload({
                code: labelCode,
                // A REGI KOD IS A NAPLOBA: egy csere utan enelkul nem lehetne
                // megmondani, melyik matrica kerult vissza a keszletbe.
                previousCode: jelenlegi?.code ?? null,
              }),
            });
          }
        }
        /**
         * A NAPLO A TENYLEGESEN VALTOZOTT MEZOKET ROGZITI, NEM A BEKULDOTTEKET.
         *
         * Eddig `Object.keys(input)` allt itt: a webes urlap a TELJES rekordot
         * kuldi, tehat minden mentes azt naplozta, hogy MINDEN altalanos mezo
         * modosult. Ket baja volt, es a masodik a sulyosabb:
         *
         *   1. HAMIS NYOM. Egy esemeny, ami azt allitja, hogy egy mezo
         *      "modosult", holott nem, a naplo egesz ertelmet rontja.
         *   2. ES A MEZO-SZINTU UTKOZES-ELLENORZES EPP EZT OLVASSA. A regi
         *      alakkal minden parhuzamos mentes utkozott volna -- vagyis a
         *      mezo-szintu vedelem epp olyan durva lett volna, mint a
         *      sor-szintu, csak dragabban.
         *
         * Ezert ez a javitas nem mellekhatas, hanem ELOFELTETEL.
         */
        const generalFields = intendedFields(
          existing as unknown as Record<string, unknown>,
          data as unknown as Record<string, unknown>,
        ).filter(
          (key) =>
            ![
              "status",
              "customerId",
              "supplierId",
              "customerAddressId",
              "aquariumId",
              "parentAssetId",
            ].includes(key),
        );
        if (generalFields.length > 0 || events.length === 0)
          events.push({
            type: "UPDATED",
            payload: jsonPayload({ fields: generalFields }),
          });
        await tx.assetEvent.createMany({
          data: events.map((event) => ({
            id: randomUUID(),
            assetId: id,
            actorUserId,
            type: event.type,
            payload: event.payload,
          })),
        });
        return id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const detail = await this.detail(
      updatedId,
      {
        // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
        // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
        // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
        kind: "internal",
      },
      // Az egyseg-lista ezen az agon nem sul el (`internal` -> ures szuro).
      [],
    );
    if (!detail) throw new Error("ASSET_UPDATE_READBACK_FAILED");
    return detail;
  }

  async rotateQr(id: string, actorUserId: string): Promise<AssetDetail> {
    const updatedId = await prisma.$transaction(
      async (tx) => {
        const row = await tx.asset.update({
          where: { id },
          data: { qrToken: randomUUID(), updatedById: actorUserId },
          include: assetDetailInclude,
        });
        await tx.assetEvent.create({
          data: {
            id: randomUUID(),
            assetId: id,
            type: "QR_ROTATED",
            actorUserId,
            payload: { reason: "manual-rotation" },
          },
        });
        return row.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const detail = await this.detail(
      updatedId,
      {
        // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
        // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
        // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
        kind: "internal",
      },
      // Az egyseg-lista ezen az agon nem sul el (`internal` -> ures szuro).
      [],
    );
    if (!detail) throw new Error("ASSET_QR_READBACK_FAILED");
    return detail;
  }

  /**
   * A FELHASZNALT HELY, A TABLABOL OSSZEGEZVE.
   *
   * MINDEN SOR SZAMIT, nem csak a taroloban allok: a keret a fotok osszes
   * helyet meri, es ma a legtobb sor bajtjai az adatbazisban vannak. Ha csak a
   * `storageKey`-eseket osszegeznenk, a keret ma nullat mutatna, es a jelzes
   * soha nem szolalna meg.
   */
  async documentBytesInUse(): Promise<number> {
    /**
     * A KERET EGY KOTETROL SZOL, TEHAT MINDEN DOKUMENTUMOT SZAMOL.
     *
     * 2026-09-03-ig csak az eszkoz-dokumentumokat osszegezte, mert csak azok
     * voltak. A munkalap-fenykepek UGYANARRA a kotetre kerulnek: ha kimaradnanak
     * az osszegbol, a hatart CSENDBEN lepnenk at -- a szam alatta maradna,
     * mikozben a lemez betelik.
     *
     * VISELKEDES-VALTOZAS AZ ESZKOZ-UTON IS, es ezt kimondom: a keret mostantol
     * hamarabb telik be, mint eddig. Ez a helyes irany (a kevesbe latszo hiba a
     * csendes tullepes lenne), de nem mellekhatas: dontes.
     *
     * MAGA AZ OSSZEG 2026-09-14 OTA KOZOS FUGGVENYBEN ALL. Addig ugyanez a ket
     * tag KET repositoryban allt kulon, es a HARMADIK gazda (a hibajegy)
     * felvetelekor mindkettot boviteni kellett volna -- a lemarado ag csendben
     * a sajat, kisebb osszeget latta volna a hatar alatt.
     */
    return sumDocumentBytesInUse();
  }

  /**
   * A SOR MEGKAPJA A DOKUMENTUM AZONOSITOJAT ELORE, es ez nem stilus: a
   * tarolo-kulcs ebbol az azonositobol all ossze, tehat a hivonak MEG A SOR
   * LETREJOTTE ELOTT tudnia kell, hova irja a bajtokat. Ha az azonosito csak a
   * beszurasnal keletkezne, a bajtokat csak UTANA lehetne kiirni -- es akkor
   * egy tarolo-hiba mar egy LETEZO, tartalom nelkuli sort hagyna maga utan.
   */
  async addDocument(input: {
    id?: string;
    assetId: string;
    type: AssetDocumentTypeValue;
    fileName: string;
    /** A bajtok az adatbazisban. Kizarolagos a `storageKey`-jel. */
    content: Buffer | null;
    /** A tarolo kulcsa. Kizarolagos a `content`-tel. */
    storageKey?: string | null;
    sizeBytes: number;
    sha256: string;
    contentType: string;
    /**
     * A CSEMPE KEPE. KOTELEZO MEZO, NEM ELHAGYHATO: a feltoltes kozos utja
     * (`prepareDocument`) mindig ad erteket, es ha egy jovobeli hivo kihagyna,
     * az forditasi hiba legyen, ne egy csendben belyegkep nelkuli sor.
     */
    thumbnail: Buffer | null;
    caption: string | null;
    actorUserId: string;
  }): Promise<AssetDocumentSummary> {
    const id = input.id ?? randomUUID();
    const sha256 = input.sha256;
    await prisma.$transaction(async (tx) => {
      await tx.assetDocument.create({
        data: {
          id,
          assetId: input.assetId,
          type: input.type,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          sha256,
          content: input.content ? Uint8Array.from(input.content) : null,
          storageKey: input.storageKey ?? null,
          thumbnail: input.thumbnail ? Uint8Array.from(input.thumbnail) : null,
          caption: input.caption,
          uploadedById: input.actorUserId,
        },
      });
      await tx.assetEvent.create({
        data: {
          id: randomUUID(),
          assetId: input.assetId,
          type: "DOCUMENT_UPLOADED",
          actorUserId: input.actorUserId,
          payload: {
            documentId: id,
            documentType: input.type,
            fileName: input.fileName,
          },
        },
      });
    });
    /**
     * A VISSZAOLVASAS NEM HOZZA VISSZA A FRISSEN BEIRT BAJTOKAT.
     *
     * Az `include` minden skalar mezot ad, tehat a legfeljebb 10 MB-os
     * `content` is visszajonne az adatbazisbol egy osszefoglalohoz, ami nem
     * hasznalja. A nevesitett lista ugyanaz, amit az adatlap hasznal.
     */
    const document = await prisma.assetDocument.findUniqueOrThrow({
      where: { id },
      select: assetDocumentSummarySelect,
    });
    return this.toDocumentSummary(document);
  }

  /**
   * A DOKUMENTUMNAL KET ELLENORZES KELL, NEM EGY, es a masodik a tipuson all.
   *
   * 1. AZ ESZKOZ a keroe -- ugyanaz a szabaly, mint a tobbi elem-lekeresnel.
   * 2. A DOKUMENTUM TIPUSA engedett-e partner szamara. A tulajdonos-egyeztetes
   *    ONMAGABAN nem eleg: egy sajat eszkozhoz tartozo SZAMLA sem megy ki.
   *
   * A tipus-tablazat forrasa KULON van jelolve, mert nem mind ugyanonnan jon:
   *    INVOICE   nem     BALAZS DONTESE, szo szerint: "szamlat nem"
   *    WARRANTY  igen    a mi olvasatunk
   *    MANUAL    igen    a mi olvasatunk
   *    OTHER     nem     a mi olvasatunk -- es az indok NEM az, hogy alapertek
   *                      (a semaban nincs alapertelmezese), hanem hogy az OTHER
   *                      DEFINICIO SZERINT az, amit nem soroltak be, tehat a
   *                      tartalmarol nincs allitasunk. Ha kiderul, hogy kell
   *                      belole valami a partnernek, az EGY KERDES lesz, nem egy
   *                      csendes szivargas.
   */
  /**
   * A CSEMPE KEPE -- KULON OLVASAS, ES A HATOKOR UGYANAZ.
   *
   * MIERT NEM A `document()` EGY MEZOJE: az a `content` oszlopot is kiolvassa,
   * es az adatbazisban tarolt fajlnal az a TELJES MERETU kep. Ha a belyegkep
   * ugyanabbol a lekerdezesbol jonne, a szerver tovabbra is kiolvasna a
   * kilenc megabajtot -- csak nem kuldene el.
   *
   * ES A KET HATOKOR-ELLENORZES ITT SEM HAGYHATO EL: az ESZKOZ lathatosaga
   * (`assetVisibilityForAndBranch`, a lekerdezesben) ES a dokumentum-fajta
   * (`scopeMaySeeDocumentType`). Egy belyegkep ugyanannak a kepnek a kicsinyitett
   * masa -- egy INTERNAL csatolmany csempeje ugyanugy szivargas lenne, csak
   * kisebb felbontasban. Ezert all itt masolat helyett ugyanaz a ket feltetel, es
   * ezert all ra kulon allitas.
   *
   * AZ ELSO 2026-09-21-IG `rowBelongsToScope` VOLT, betoltott soron. Az a
   * szabaly szukebb, mint amit a lista hasznal, es ettol a reszlegen at lathato
   * eszkoz csatolmanya 404-et adott -- a lap megmutatta a fajlt, es a csempeje
   * nem jott meg.
   *
   * A VISSZAESES A HIVONAL VAN: ha nincs sor, nincs jogosultsag vagy nincs
   * belyegkep, ez `null`-t ad, es a hivo a rendes uton megy tovabb. Ket
   * lekerdezes tehat CSAK a visszaeses eseteben tortenik.
   */
  async documentThumbnail(
    assetId: string,
    documentId: string,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ) {
    const row = await prisma.assetDocument.findFirst({
      /*
        A HATOKOR A KAPCSOLT ESZKOZON, UGYANAZZAL A FUGGVENNYEL, amit a lista
        es a reszletlap hasznal. Korabban `rowBelongsToScope` allt a betoltott
        soron, ami a RESZLEGEN at lathato eszkoz belyegkepet elutasitotta --
        vagyis a lap megmutatta a csatolmanyt, es a csempeje nem jott meg.
      */
      where: {
        id: documentId,
        assetId,
        /*
          AND TOMBON BELUL, mint minden hatokor-hivas ebben a fajlban. A
          `partner-scope-and-branch.spec.ts` ezt a FORRASBOL oriz, es az indoka
          itt is all: egy kesobb felvett testverkulcs (vagy egy `OR`) ugyanezen
          a szinten hatastalanitana a szurest, hibauzenet nelkul.
        */
        asset: { AND: [assetVisibilityForAndBranch(scope, assignedUnitIds)] },
      },
      select: { fileName: true, thumbnail: true, type: true },
    });
    if (!row) return null;
    if (!scopeMaySeeDocumentType(row.type, scope)) return null;
    if (!row.thumbnail) return null;
    return { fileName: row.fileName, thumbnail: row.thumbnail };
  }

  async document(
    assetId: string,
    documentId: string,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ) {
    const row = await prisma.assetDocument.findFirst({
      /*
        A HATOKOR A KAPCSOLT ESZKOZON -- ugyanaz a fuggveny, mint a listanal es
        a reszletlapnal. A letoltes es a belyegkep EGYUTT mozdul: kulonben a lap
        mutatna a csatolmanyt, es a megnyitasa 404-et adna.
      */
      where: {
        id: documentId,
        assetId,
        /*
          AND TOMBON BELUL, mint minden hatokor-hivas ebben a fajlban. A
          `partner-scope-and-branch.spec.ts` ezt a FORRASBOL oriz, es az indoka
          itt is all: egy kesobb felvett testverkulcs (vagy egy `OR`) ugyanezen
          a szinten hatastalanitana a szurest, hibauzenet nelkul.
        */
        asset: { AND: [assetVisibilityForAndBranch(scope, assignedUnitIds)] },
      },
      select: {
        fileName: true,
        contentType: true,
        content: true,
        storageKey: true,
        type: true,
      },
    });
    if (!row) return null;
    if (!scopeMaySeeDocumentType(row.type, scope)) return null;
    return {
      fileName: row.fileName,
      contentType: row.contentType,
      content: row.content,
      storageKey: row.storageKey,
    };
  }

  /**
   * A TORLES HATOKORE 2026-09-17 OTA PARAMETER, ES EZ JAVITAS VOLT, NEM BOVITES.
   *
   * Addig a metodus egyaltalan nem vett at hatokort, es a mellette allo indok
   * (hogy a vegpont olyan jog alatt all, amit partner-fiok nem kap meg) MAR NEM
   * VOLT IGAZ: a `PARTNER_SERVICE` szerep megkapja a `SERVICE_MANAGE` jogot.
   * Amit tenyleg nem kap meg, az a `SERVICE_ASSET_DELETE` -- az az ESZKOZ
   * torlese, nem a csatolmanye.
   *
   * ES AMIERT SEMMI NEM SZOLT: a `partner-scope-usage.spec.ts` azt meri, hogy
   * amelyik metodus hatokort VESZ AT, az hasznalja is. Ami sosem vett at, az
   * kivul allt a latoteren. Ettol a parametertol lett lathato.
   */
  async deleteDocument(
    assetId: string,
    documentId: string,
    actorUserId: string,
    scope: PartnerScope,
  ) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.assetDocument.findFirst({
        where: { id: documentId, assetId },
        select: {
          id: true,
          type: true,
          fileName: true,
          asset: { select: { customerId: true, supplierId: true } },
        },
      });
      if (!document) return false;
      /*
          === ES 2026-09-22 OTA EZ AZ EGYETLEN AG, AMI NEM ALLT AT ===

          Aznap a felirat-atiras es a matricakod-kereses is a LISTA kapujara
          tert at (`assetVisibilityForAndBranch`), mert harom uton harom
          kulonbozo kapu allt ugyanarra a dologra. A TORLES SZANDEKOSAN KIMARADT
          ebbol, es ezt ki kell mondani -- kulonben ugy nez ki, mintha
          kifelejtettuk volna az osszehangolasbol.

          AZ INDOK: a ket muvelet ara nem egyforma. Egy rossz felirat javithato,
          egy torolt dokumentum nem. Egy visszafordithatatlan tagitasra KULON
          engedely kell, es a gazda erre 2026-09-22-ig nem valaszolt -- tehat
          nincs ra engedely. acrobot szavaval, ahogy neki irta: "a feliratozas
          megnyilik, a torles zarva marad. Igy a partner javithat egy elgepelt
          feliratot, de nem tuntethet el semmit."

          HA EZ VALAHA MEGNYILIK, az kulon dontes, es ide kell irni, kitol es
          mikor.

        KET FELTETEL: az eszkoz a keroe, ES a fajta lathato neki. Aki nem latja,
        ne is torolhesse -- egy torles kulonben a LETEZEST is elarulna arrol,
        amit meg sem lat.

        === ES EZ A SOR 2026-09-21 OTA SZUKEBB, MINT AZ OLVASAS. SZANDEKOSAN. ===

        Korabban itt is ugyanaz a szabaly allt, mint az olvaso agakon. Azok
        aznap atalltak a LISTA lathatosagara (a reszlegen at is beenged), mert
        Balazs igy mondta ki a szabalyt az eszkozok LATASARA.

        A TORLESRE NEM MONDTA KI. A "latja, tehat torolhesse" nem kovetkezik a
        "latja" mondatbol, es a ketto ara nem egyforma: egy elmaradt torles
        panaszt szul, egy kereetlen torles visszafordithatatlan.

        Ezert marad `rowBelongsToScope` -- a szukebb alak --, amig valaki, akinek
        joga van kimondani, nem donti el. A kulonbseg KOVETKEZMENYE ma nulla: a
        partner-fiokok egyike sem tulajdonosa egyetlen eszkoznek sem, tehat ezen
        az agon ma egyetlen torles sem mehet at. Ha a szabaly egyszer kinyilik,
        EZ a sor az, amit at kell irni.
      */
      if (!rowBelongsToScope(document.asset, scope)) return false;
      if (!scopeMaySeeDocumentType(document.type, scope)) return false;
      await tx.assetDocument.delete({ where: { id: document.id } });
      await tx.assetEvent.create({
        data: {
          id: randomUUID(),
          assetId,
          type: "DOCUMENT_DELETED",
          actorUserId,
          payload: {
            documentId: document.id,
            documentType: document.type,
            fileName: document.fileName,
          },
        },
      });
      return true;
    });
  }

  private async ancestors(parentAssetId: string | null) {
    const ancestors: AssetHierarchyItem[] = [];
    const visited = new Set<string>();
    let currentId = parentAssetId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const row = await prisma.asset.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          assetNumber: true,
          name: true,
          kind: true,
          status: true,
          parentAssetId: true,
        },
      });
      if (!row) break;
      ancestors.unshift(hierarchyItem(row));
      currentId = row.parentAssetId;
    }
    return ancestors;
  }

  /**
   * AZ ALEGYSÉGEK TELJES ÚTJA, EGY KÖTEGBEN.
   *
   * Egy lekérdezés, nem soronként egy: az érintett partnerek ÖSSZES egységét
   * behúzzuk, és az utakat abból építjük. Egy partner egységei elférnek egy
   * kötegben (ugyanez az indok áll a partner képernyő lapos lekérdezésénél is),
   * és így egy száz soros lista sem lesz száz lekérdezés.
   *
   * Rekurzív SQL helyett azért ez: a fának NINCS mélység-korlátja, tehát egy
   * rögzített mélységű `include` csendben levágná a mély utakat -- pontosan azt
   * a hibát, ami ellen az egész mező készül.
   */
  private async unitPaths(
    rows: readonly AssetSummaryRow[],
  ): Promise<Map<string, string[]>> {
    const customerIds = [
      ...new Set(
        rows
          .map((row) => row.department?.customerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (customerIds.length === 0) return new Map();
    const units = await prisma.worksheetDepartment.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true, name: true, parentId: true },
    });
    return buildUnitPaths(units);
  }

  private toListItem(
    row: AssetSummaryRow,
    paths: Map<string, string[]>,
  ): AssetListItem {
    const owner = row.customer
      ? {
          type: "CUSTOMER" as const,
          id: row.customer.id,
          code: row.customer.customerNumber,
          displayName: row.customer.displayName,
        }
      : row.supplier
        ? {
            type: "SUPPLIER" as const,
            id: row.supplier.id,
            code: row.supplier.code,
            displayName: row.supplier.name,
          }
        : (() => {
            throw new Error("ASSET_OWNER_MISSING");
          })();
    return {
      ...hierarchyItem(row),
      criticality: row.criticality,
      owner,
      address:
        addressSummary(row.customerAddress) ??
        supplierAddressSummary(row.supplier),
      // AZ ALEGYSEG A PONTOS HELY, a fenti `address` pedig a visszaeses:
      // partner-tulajdonosnal az a partner postai cime. A kettot a felulet
      // egyutt olvassa -- ha `unit` van, az a valasztott hely; ha nincs, az
      // `address` latszik, jelolve, hogy nem valasztas eredmenye.
      unit: row.department
        ? {
            id: row.department.id,
            code: row.department.code,
            name: row.department.name,
            // A `paths` KÖTELEZŐ paraméter, nem opcionális: ha elmaradna, a
            // fordító mutatja meg, hol -- egy néma visszaesés a levél nevére
            // pont az a hiba lenne, amit ez a mező megszüntet.
            path: paths.get(row.department.id) ?? [row.department.name],
          }
        : undefined,
      aquarium: row.aquarium
        ? {
            id: row.aquarium.id,
            aquariumNumber: row.aquarium.aquariumNumber,
            name: row.aquarium.name,
          }
        : undefined,
      parent: row.parentAsset ? hierarchyItem(row.parentAsset) : undefined,
      manufacturer: row.manufacturer ?? undefined,
      model: row.model ?? undefined,
      serialNumber: row.serialNumber ?? undefined,
      nextServiceAt: row.nextServiceAt?.toISOString(),
      // A listában is kimegy, nem csak az adatlapon: a helyszíni katalógus
      // enélkül nem tudja feloldani a beolvasott kódot. Nem jár extra
      // adatbázis-költséggel - a lekérdezés `include`-ot használ, tehát a
      // mező már benne van a betöltött sorban.
      qrToken: row.qrToken,
      /**
       * AZ ÜGYFÉL SAJÁT KÓDJA A LISTASORON is, nem csak az adatlapon: a keresés
       * eddig is nézte, a sor viszont nem mutatta, tehát a találatról nem
       * látszott, MIRE illeszkedett. Nem jár extra adatbázis-költséggel, a mező
       * már benne van a betöltött sorban.
       *
       * A MEZŐ NEVE 2026-09-23-IG "inventoryNumber" VOLT -- lásd a séma
       * jegyzetét: a jelentése nem változott, csak a neve, és mellé került
       * egy VALÓDI "inventoryNumber", ami ma mindig üres.
       */
      partnerInternalCode: row.partnerInternalCode ?? undefined,
      inventoryNumber: row.inventoryNumber ?? undefined,
      /**
       * A MATRICAKOD A LISTASORON is, ugyanabbol az okbol, mint felette az
       * ugyfel sajat kodja: a kereses eddig is nezte, a sor viszont nem
       * mutatta. A relacio hianyzo volta azt jelenti, hogy NINCS matrica --
       * ezert `undefined`, nem ures szoveg.
       */
      labelCode: row.label?.code,
      /*
        A KIADOTT ERTEK A HIVATKOZOTT NEV, nem a regi szoveges mezo. A ketto
        atmenetileg egyutt all a soron: a szoveg a migracio ELLENORIZHETOSEGE
        miatt marad ott, de amit a felulet lat, az mar a torzsadatbol jon.

        A LISTASORON IS ALL, NEM CSAK AZ ADATLAPON: a szures enelkul nem
        mutathatna meg, MIRE szurt.
      */
      category: row.categoryRef?.name ?? undefined,
      categoryId: row.categoryId ?? undefined,
      childCount: row._count.childAssets,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * A `scope` KOTELEZO, es ez a mechanizmus maga. Az adatlap BEHUZZA a
   * dokumentumokat, tehat itt dol el, mit lat beloluk a kero -- egy opcionalis
   * parameter minden elfelejtett hivasi helyen "belsos"-nek latszana, vagyis a
   * felejtes TAGITANA a hozzaferest. Kotelezokent a fordito sorolja fel a
   * hivasi helyeket.
   *
   * A TULAJDONOS-EGYEZTETES ONMAGABAN NEM ELEG, es a hianya nem elmeleti volt:
   * a szamla-szabaly 2026-08-31-ig CSAK a letoltesi uton allt (murena masodik
   * olvasata nevezte meg), tehat a partner a sajat eszkozenek adatlapjan
   * megkapta a szamla letezeset, a fajlnevet, a meretet, a lenyomatot es a
   * feltolto kollega nevet, mikozben a letoltes ugyanarra 404-et adott.
   */
  private toDetail(
    row: AssetDetailRow,
    ancestors: AssetHierarchyItem[],
    paths: Map<string, string[]>,
    scope: PartnerScope,
  ): AssetDetail {
    return {
      ...this.toListItem(row, paths),
      /**
       * A FUNKCIO CSAK ITT, NEM A LISTASOROS `toListItem`-BEN -- a
       * `functionRef` csak a `assetDetailInclude`-ban all, lasd a
       * `service-assets.types.ts` fejleceit: erre ma nincs listaszures.
       */
      function: row.functionRef?.name ?? undefined,
      functionId: row.functionId ?? undefined,
      description: row.description ?? undefined,
      performance: row.performance?.toString(),
      performanceUnit: row.performanceUnit ?? undefined,
      volume: row.volume?.toString(),
      powerConsumption: row.powerConsumption?.toString(),
      powerConsumptionRaw: row.powerConsumptionRaw ?? undefined,
      electricalCode: row.electricalCode ?? undefined,
      installedAt: row.installedAt?.toISOString(),
      purchasedAt: row.purchasedAt?.toISOString(),
      warrantyExpiresAt: row.warrantyExpiresAt?.toISOString(),
      serviceIntervalDays: row.serviceIntervalDays ?? undefined,
      lastServicedAt: row.lastServicedAt?.toISOString(),
      notes: row.notes ?? undefined,
      archivedAt: row.archivedAt?.toISOString(),
      product: row.productVariant
        ? {
            variantId: row.productVariant.id,
            sku: row.productVariant.sku,
            name: row.productVariant.name ?? row.productVariant.product.name,
          }
        : undefined,
      ancestors,
      children: row.childAssets.map(hierarchyItem),
      events: row.events
        .filter((event) => scopeMaySeeAssetEvent(event, scope))
        .map((event): AssetEventSummary => ({
          id: event.id,
          type: event.type,
          actor: event.actorUser
            ? {
                id: event.actorUser.id,
                displayName: event.actorUser.displayName,
              }
            : undefined,
          payload: event.payload as Record<string, unknown>,
          occurredAt: event.occurredAt.toISOString(),
        })),
      documents: row.documents
        .filter((document) => scopeMaySeeDocumentType(document.type, scope))
        .map((document) => this.toDocumentSummary(document)),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * A FELIRAT ATIRASA -- ES AZ ESZKOZ AZONOSITOJA IS FELTETEL.
   *
   * `updateMany` es nem `update`: igy az eszkoz azonositoja a feltetel resze
   * lehet. Egy `update({ where: { id } })` egy MASIK eszkoz csatolmanyat is
   * atirna, ha valaki a sajat eszkoze utjara ir egy idegen
   * dokumentum-azonositot.
   *
   * A VISSZATERES A TALALATOK SZAMA: egy `updateMany`, ami nulla sort erint,
   * NEM hibazik -- es a hiba nema lenne.
   */
  async setDocumentCaption(
    assetId: string,
    documentId: string,
    caption: string | null,
    scope: PartnerScope,
    assignedUnitIds: readonly string[],
  ): Promise<number> {
    /**
     * A HATOKOR A FELTETELBEN ALL, ES KET AGON, ugyanaz a ketto, amit az
     * olvasas is nez (`document`): AZ ESZKOZ a keroe, ES a fajta lathato neki.
     *
     * A MASODIK NEM TULBUZGOSAG: enelkul egy partner ATIRHATNA egy olyan
     * csatolmany feliratat, amit meg sem lat -- es a valaszbol azt is
     * megtudna, hogy az a sor LETEZIK. A felirat a jegy tartalma, nem
     * megjegyzes a margon.
     *
     * A TIPUS-LISTA a kozos fuggvenybol jon, nem kezzel felsorolva: a
     * `scopeMaySeeDocumentType` egy BETOLTOTT sorrol dont, ez a hivas viszont
     * nem tolt be sort, tehat a szabalyt feltetel alakban kell megkapnia.
     */
    const result = await prisma.assetDocument.updateMany({
      where: {
        id: documentId,
        assetId,
        type: { in: scopeVisibleDocumentTypes(scope) },
        /*
          === A KAPU 2026-09-22-EN CSERELT, ES EZ NEM TAGITAS ===

          Itt a KOZOS `scopeWhereForAndBranch` allt, ami vevo-hatokornel
          PONTOSAN `{ customerId }`. Eles adaton (2026-09-22, acrobot merese)
          83 eszkozbol 0 vevo-tulajdonu, tehat a partner EGYETLEN feliratot sem
          tudott atirni -- holott feltolteskor O adja meg a feliratot.

          HAROM UTON HAROM KULONBOZO KAPU ALLT ugyanarra a dologra: az
          `addDocument` a `detail`-t hasznalta, ez a kozos szurot, a torles egy
          harmadikat. Az nem hatar, hanem elteres -- ugyanaz a csalad, mint a
          671f87f0 (a lista mutatta, az adatlap nemet mondott).

          EZERT UGYANAZ A FUGGVENY ALL ITT, amit a lista es az adatlap hasznal:
          nem uj kepesseg, hanem a mai allapot HELYREALLITASA.

          A MASODIK FELTETEL (a fajta lathatosaga) VALTOZATLAN, es a fenti
          jegyzet indoka ra valtozatlanul all.

          A DONTES acroboté, 2026-09-22 12:53, es a TORLESRE KULON NEM SZOL --
          lasd a `deleteDocument` jegyzetet.
        */
        asset: {
          AND: [assetVisibilityForAndBranch(scope, assignedUnitIds)],
        },
      },
      data: { caption },
    });
    return result.count;
  }

  private toDocumentSummary(document: {
    id: string;
    type: AssetDocumentSummary["type"];
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    caption: string | null;
    createdAt: Date;
    uploadedBy: { id: string; displayName: string } | null;
  }): AssetDocumentSummary {
    return {
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      contentType: documentedContentType(document.contentType),
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      caption: document.caption,
      uploadedBy: document.uploadedBy
        ? {
            id: document.uploadedBy.id,
            displayName: document.uploadedBy.displayName,
          }
        : undefined,
      createdAt: document.createdAt.toISOString(),
    };
  }
}

/** A letöltő/DTO csak a feltöltő által ténylegesen támogatott típusokat ismeri. */
export function documentedContentType(
  contentType: string,
): AssetDocumentSummary["contentType"] {
  if (
    contentType === "application/pdf" ||
    contentType === "image/jpeg" ||
    contentType === "image/png"
  )
    return contentType;

  throw new Error(`Nem támogatott tárolt dokumentumtípus: ${contentType}`);
}
