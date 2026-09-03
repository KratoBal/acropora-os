import {
  rowBelongsToScope,
  rowIsScopeOwner,
  scopeMaySeeDocumentType,
  scopeOwnWhereForAndBranch,
  scopeWhereForAndBranch,
  type PartnerScope,
} from "../auth/partner-scope.util.js";
import { collectUnitSubtreeIds } from "./unit-subtree.js";

import { randomUUID } from "node:crypto";

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
} from "@acropora/types";
import { normalizeAssetLabelCode, randomAssetLabelCode } from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { withUniqueCode } from "../common/unique-code.util.js";
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
const DOCUMENT_TYPES = ["INVOICE", "WARRANTY", "MANUAL", "OTHER"] as const;

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
    const userWhere: Prisma.AssetWhereInput = {
      ...assetOwnerScopeWhere(query.ownerScope),
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.ownerType === "CUSTOMER" && query.ownerId
        ? { customerId: query.ownerId }
        : query.ownerType === "SUPPLIER" && query.ownerId
          ? { supplierId: query.ownerId }
          : {}),
      ...(departmentIds ? { departmentId: { in: departmentIds } } : {}),
      ...(query.aquariumId ? { aquariumId: query.aquariumId } : {}),
      /**
       * MATRICA SZERINTI SZUKITES. A `label: null` alak a Prisma egy-az-egyhez
       * kapcsolatan azt jelenti, hogy NINCS kapcsolt sor -- ez teszi
       * megtalalhatova a matrica nelkul felvitt eszkozoket.
       *
       * A `isNot: null` a masik irany. A ketto NEM ugyanaz, mint a
       * `label: { code: ... }`: az mar egy KONKRET kodra szur.
       */
      ...(query.label === "without"
        ? { label: null }
        : query.label === "with"
          ? { label: { isNot: null } }
          : {}),
      ...(query.parentAssetId ? { parentAssetId: query.parentAssetId } : {}),
      ...(query.dueBefore
        ? { nextServiceAt: { lte: new Date(query.dueBefore) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { assetNumber: { contains: query.search, mode: "insensitive" } },
              { name: { contains: query.search, mode: "insensitive" } },
              { manufacturer: { contains: query.search, mode: "insensitive" } },
              { model: { contains: query.search, mode: "insensitive" } },
              { serialNumber: { contains: query.search, mode: "insensitive" } },
              {
                inventoryNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                supplier: {
                  name: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const where: Prisma.AssetWhereInput = {
      AND: [scopeWhereForAndBranch(scope), userWhere],
    };
    const [rows, totalItems] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: assetSummaryInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.asset.count({ where }),
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
    };
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
   * jegyzetet): elem-lekeresnel az elfelejtett ellenorzes NEMA. Az ellenorzes a
   * BETOLTOTT soron all, es a nem egyezo sor `null` -- tehat 404, nem 403.
   *
   * AZ ESZKOZ KET OLDALON KOTODHET (`customerId` VAGY `supplierId`), es a
   * `rowBelongsToScope` pont ezt kezeli: egy vevo-hatokoru kero nem lat
   * szerviz-partner eszkozt attol, hogy a masik oszlopban all az azonosito.
   */
  async detail(id: string, scope: PartnerScope): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { id },
      include: assetDetailInclude,
    });
    if (!row) return null;
    if (!rowBelongsToScope(row, scope)) return null;
    return this.toDetail(
      row,
      await this.ancestors(row.parentAssetId),
      await this.unitPaths([row]),
      scope,
    );
  }

  /**
   * A TULAJDONOS KERDESE ITT SZANDEKOSAN NINCS ELLENORIZVE (spec 4.1): a
   * `qrToken` 128 bites veletlen uuid, tehat a birtoklasa maga a felhatalmazas
   * az ESZKOZRE. A DOKUMENTUM-TIPUS kerdese viszont ettol fuggetlen, es ezert
   * kell ide is a hatokor: a partner a sajat eszkoze tokenjet jogosan ismeri,
   * tehat enelkul ezen az uton hozzajutna ahhoz a szamlahoz, amit az adatlapon
   * es a letoltesen mar nem kap meg. Egy korlat, ami csak az utak egy reszen
   * all, nem korlat.
   */
  async detailByQrToken(
    qrToken: string,
    scope: PartnerScope,
  ): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { qrToken },
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
          prisma.$transaction(
            async (tx) => {
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
                  // Az alegyseg a masik iranyban all: SZERVIZ PARTNER eszkozehez
                  // tartozik, vevoehez nem. A ket mezo nem ugyanaz a fogalom.
                  departmentId:
                    input.ownerType === "SUPPLIER" ? input.departmentId : null,
                  parentAssetId: input.parentAssetId,
                  productVariantId: input.productVariantId,
                  kind: input.kind,
                  status: input.status,
                  criticality: input.criticality,
                  name: input.name.trim(),
                  category: optionalText(input.category),
                  manufacturer: optionalText(input.manufacturer),
                  model: optionalText(input.model),
                  serialNumber: optionalText(input.serialNumber),
                  inventoryNumber: optionalText(input.inventoryNumber),
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
    const detail = await this.detail(id, { kind: "internal" });
    if (!detail) throw new Error("ASSET_CREATE_READBACK_FAILED");
    return detail;
  }

  /**
   * ESZKOZ KERESESE A MATRICAKODROL -- ES ITT A TULAJDON ELLENORIZVE VAN.
   *
   * EZ A LENYEGES KULONBSEG A `detailByQrToken`-HEZ KEPEST, es szandekos.
   * Ott a tulajdon SZANDEKOSAN nincs nezve, mert a `qrToken` 128 bites veletlen
   * uuid: a birtoklasa maga a felhatalmazas. A matricakod egy betu es negy
   * szam, vagyis 260 ezer lehetoseg -- egy hitelesitett SERVICE_VIEW jogu
   * PARTNER-felhasznalo vegig tudna probalni. Ha ez az ut orokolne a masik
   * kivetelet, sorra kapna mas partnerek eszkozeit.
   *
   * A HATOKOR `AND` AGKENT ALL, nem kulcskent -- lasd a
   * `scopeWhereForAndBranch` jegyzetet es a `partner-scope-and-branch.spec.ts`
   * orzot, ami ezt a fajlt is nezi.
   *
   * A NEM LATHATO ESZKOZ ES A NEM LETEZO KOD UGYANAZT ADJA (`null`), es ez sem
   * kenyelem: ha a ketto kulonbozne, a valaszokbol felterkepezheto lenne, mely
   * kodok vannak kiadva es kihez tartoznak. A hivonak amugy is ugyanaz a
   * teendoje mindket esetben.
   */
  async detailByLabelCode(
    code: string,
    scope: PartnerScope,
  ): Promise<AssetDetail | null> {
    const row = await prisma.asset.findFirst({
      where: { AND: [{ label: { code } }, scopeWhereForAndBranch(scope)] },
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
          // Vevo tulajdonosra valtaskor az alegyseg TORLODIK, ahogy a cim is
          // torlodik szallitora valtaskor: a ket mezo egymast zarja ki.
          departmentId:
            input.ownerType === "CUSTOMER" ? null : input.departmentId,
          parentAssetId: input.parentAssetId,
          productVariantId: input.productVariantId,
          kind: input.kind,
          status: input.status,
          criticality: input.criticality,
          name: input.name?.trim(),
          category: optionalText(input.category),
          manufacturer: optionalText(input.manufacturer),
          model: optionalText(input.model),
          serialNumber: optionalText(input.serialNumber),
          inventoryNumber: optionalText(input.inventoryNumber),
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
          archivedAt:
            input.status === "RETIRED"
              ? (existing.archivedAt ?? new Date())
              : input.status
                ? null
                : undefined,
          updatedById: actorUserId,
        };
        const changed = await tx.asset.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data,
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");

        const updated = await tx.asset.findUniqueOrThrow({ where: { id } });
        const events: Array<{
          type:
            | "UPDATED"
            | "PLACEMENT_CHANGED"
            | "PARENT_CHANGED"
            | "STATUS_CHANGED";
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
        const generalFields = Object.keys(input).filter(
          (key) =>
            ![
              "expectedUpdatedAt",
              "status",
              "ownerType",
              "ownerId",
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
    const detail = await this.detail(updatedId, {
      // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
      // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
      // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
      kind: "internal",
    });
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
    const detail = await this.detail(updatedId, {
      // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
      // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
      // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
      kind: "internal",
    });
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
     */
    const [eszkoz, munkalap] = await Promise.all([
      prisma.assetDocument.aggregate({ _sum: { sizeBytes: true } }),
      prisma.worksheetDocument.aggregate({ _sum: { sizeBytes: true } }),
    ]);
    return (eszkoz._sum.sizeBytes ?? 0) + (munkalap._sum.sizeBytes ?? 0);
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
    type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER";
    fileName: string;
    /** A bajtok az adatbazisban. Kizarolagos a `storageKey`-jel. */
    content: Buffer | null;
    /** A tarolo kulcsa. Kizarolagos a `content`-tel. */
    storageKey?: string | null;
    sizeBytes: number;
    sha256: string;
    contentType: string;
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
  async document(assetId: string, documentId: string, scope: PartnerScope) {
    const row = await prisma.assetDocument.findFirst({
      where: { id: documentId, assetId },
      select: {
        fileName: true,
        contentType: true,
        content: true,
        storageKey: true,
        type: true,
        asset: { select: { customerId: true, supplierId: true } },
      },
    });
    if (!row) return null;
    if (!rowBelongsToScope(row.asset, scope)) return null;
    if (!scopeMaySeeDocumentType(row.type, scope)) return null;
    return {
      fileName: row.fileName,
      contentType: row.contentType,
      content: row.content,
      storageKey: row.storageKey,
    };
  }

  async deleteDocument(
    assetId: string,
    documentId: string,
    actorUserId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.assetDocument.findFirst({
        where: { id: documentId, assetId },
        select: { id: true, type: true, fileName: true },
      });
      if (!document) return false;
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
       */
      inventoryNumber: row.inventoryNumber ?? undefined,
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
      category: row.category ?? undefined,
      description: row.description ?? undefined,
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

  private toDocumentSummary(document: {
    id: string;
    type: AssetDocumentSummary["type"];
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: Date;
    uploadedBy: { id: string; displayName: string } | null;
  }): AssetDocumentSummary {
    return {
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      contentType: "application/pdf",
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
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
