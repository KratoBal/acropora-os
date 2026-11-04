import { createHash } from "node:crypto";

import type {
  PartnerMergeFieldFill,
  PartnerMergeReferenceTable,
} from "@acropora/types";

import {
  euKey,
  huBase,
} from "../partner-duplicates/partner-duplicate-groups.js";

/**
 * EGY PARTNERTÖRZS, 4. LÉPÉS: AZ ÖSSZEVONÁS SZABÁLYAI, TISZTA FÜGGVÉNYEKBEN (nem nyúlnak adatbázishoz, tehát minden szabály
 * külön tesztelhető). A terv 3.3 és 3.4 pontja szerint:
 *
 * - A MEGMARADÓ sor az üres mezőit a megszűnőből tölti; az ütköző mezőt NEM írja felül.
 * - Két DIFFERENT adószám (más magyar alap, vagy más közösségi kulcs) két különböző cég: az összevonás megáll.
 * - A szerviz-kód (`worksheetPartnerCode`) egyedi: ha csak a megszűnőnek van, átkerül; ha mindkettőnek van, megáll.
 * - Ütköző e-mail: a megmaradóé marad, a megszűnőé a számlázási e-mailbe kerül, ha az üres; különben csak jegyzet.
 * - A megmaradó a Supplier-kötéses sor (a munkalapok kényszerítik); két Supplier-kötés vagy fordított irány: megáll.
 */

/** A szabályokhoz elég mezők egy vevő-sorból. */
export interface MergeFacts {
  id: string;
  customerNumber: string;
  displayName: string;
  type: string;
  companyName: string | null;
  worksheetPartnerCode: string | null;
  taxNumber: string | null;
  euTaxNumber: string | null;
  email: string | null;
  billingEmail: string | null;
  phone: string | null;
  paymentDueDays: number | null;
  archivedAt: Date | null;
  mergedIntoId: string | null;
  /** van `Supplier` kötése (a partner vevő-tükre) */
  hasSupplier: boolean;
}

/** Amit a végrehajtás a megmaradó soron módosít, a naplóhoz a mezők nevével. */
export interface MergeFieldPlan {
  /** a megmaradó sor `update` adata */
  keptData: Record<string, string | number | null>;
  /** a megszűnő soron a végrehajtás ELŐTT törlendő mező (a szerviz-kód egyedi: előbb onnan ki, aztán ide be) */
  clearOnMerged: string[];
  fills: PartnerMergeFieldFill[];
  notes: string[];
  blockers: string[];
}

const blank = (value: string | null | undefined): boolean =>
  !value || value.trim() === "";
const same = (a: string | null, b: string | null): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * A KÉT ADÓSZÁM EGYEZÉSE: két MÁS kulcs két más cég, az összevonás megáll. Ha mindkét oldalon áll érték, de az egyik nem
 * adószám alakú, nem tudjuk ellenőrizni, hogy ugyanaz a cég: szintén megáll (nem találgatunk). Hiányzó oldal nem ütközés.
 */
function taxConflicts(kept: MergeFacts, merged: MergeFacts): string[] {
  const blockers: string[] = [];
  const check = (
    label: string,
    keptValue: string | null,
    mergedValue: string | null,
    key: (value: string | null) => string | null,
  ) => {
    if (blank(keptValue) || blank(mergedValue)) return;
    const a = key(keptValue);
    const b = key(mergedValue);
    if (!a || !b)
      blockers.push(
        `A ${label} nem ellenőrizhető (az egyik érték nem adószám alakú): előbb javítani kell.`,
      );
    else if (a !== b)
      blockers.push(
        `A két sor ${label}a különböző (két különböző cég): az összevonás megáll.`,
      );
  };
  check("magyar adószám", kept.taxNumber, merged.taxNumber, huBase);
  check("közösségi adószám", kept.euTaxNumber, merged.euTaxNumber, euKey);
  // KERESZTBE IS: a HU kezdetű közösségi adószám első 8 jegye a magyar alap (barracuda, #2187 review): ha az egyik soron csak magyar,
  // a másikon csak közösségi adószám áll, a két mező nem ütközik egymással, a mögöttes cég viszont más lehet
  const crossCheck = (huValue: string | null, euValue: string | null) => {
    if (blank(huValue) || blank(euValue)) return;
    const base = huBase(huValue);
    const eu = euKey(euValue);
    if (!base || !eu || !eu.startsWith("HU")) return;
    const euBase = eu.slice(2, 10);
    if (/^[0-9]{8}$/.test(euBase) && euBase !== base)
      blockers.push(
        "A magyar adószám és a másik sor HU közösségi adószáma nem ugyanazt a törzsszámot hordozza (két különböző cég): az összevonás megáll.",
      );
  };
  crossCheck(kept.taxNumber, merged.euTaxNumber);
  crossCheck(merged.taxNumber, kept.euTaxNumber);
  return blockers;
}

export function planFieldMerge(
  kept: MergeFacts,
  merged: MergeFacts,
): MergeFieldPlan {
  const plan: MergeFieldPlan = {
    keptData: {},
    clearOnMerged: [],
    fills: [],
    notes: [],
    blockers: [],
  };
  plan.blockers.push(...taxConflicts(kept, merged));

  const fill = (
    field: "taxNumber" | "euTaxNumber" | "phone" | "companyName",
  ) => {
    const valid =
      field === "taxNumber"
        ? huBase(merged[field]) !== null
        : field === "euTaxNumber"
          ? euKey(merged[field]) !== null
          : true;
    if (blank(kept[field]) && !blank(merged[field]) && !valid) {
      plan.notes.push(
        `A(z) ${field} mező a megszűnő soron nem adószám alakú, ezért nem másolódik.`,
      );
    } else if (blank(kept[field]) && !blank(merged[field])) {
      plan.keptData[field] = merged[field]!.trim();
      plan.fills.push({ field, kind: "fill", into: field });
    } else if (
      !blank(kept[field]) &&
      !blank(merged[field]) &&
      !same(kept[field], merged[field])
    )
      plan.notes.push(
        `A(z) ${field} mező eltér: a megmaradó soré marad, a másik érték a naplóban nem őrződik (csak ez a jegyzet).`,
      );
  };
  fill("taxNumber");
  fill("euTaxNumber");
  fill("phone");
  fill("companyName");

  // e-mail: a megmaradóé marad; az ütköző a számlázási e-mailbe, ha az üres
  if (blank(kept.email) && !blank(merged.email)) {
    plan.keptData.email = merged.email!.trim();
    plan.fills.push({ field: "email", kind: "fill", into: "email" });
  } else if (
    !blank(kept.email) &&
    !blank(merged.email) &&
    !same(kept.email, merged.email)
  ) {
    const billingTaken =
      !blank(kept.billingEmail) || "billingEmail" in plan.keptData;
    if (!billingTaken) {
      plan.keptData.billingEmail = merged.email!.trim();
      plan.fills.push({ field: "email", kind: "fill", into: "billingEmail" });
    } else
      plan.notes.push(
        "Két különböző e-mail-cím van, és a számlázási e-mail is foglalt: a megmaradó sor címe marad, a másik nem másolódik.",
      );
  }
  if (
    blank(kept.billingEmail) &&
    !blank(merged.billingEmail) &&
    !("billingEmail" in plan.keptData)
  ) {
    plan.keptData.billingEmail = merged.billingEmail!.trim();
    plan.fills.push({
      field: "billingEmail",
      kind: "fill",
      into: "billingEmail",
    });
  }

  // fizetési nap: csak ha a megmaradónak nincs
  if (kept.paymentDueDays === null && merged.paymentDueDays !== null) {
    plan.keptData.paymentDueDays = merged.paymentDueDays;
    plan.fills.push({
      field: "paymentDueDays",
      kind: "fill",
      into: "paymentDueDays",
    });
  } else if (
    kept.paymentDueDays !== null &&
    merged.paymentDueDays !== null &&
    kept.paymentDueDays !== merged.paymentDueDays
  )
    plan.notes.push("A fizetési nap eltér: a megmaradó soré marad.");

  // típus: a cég marad
  if (kept.type !== "COMPANY" && merged.type === "COMPANY") {
    plan.keptData.type = "COMPANY";
    plan.fills.push({ field: "type", kind: "type", into: "type" });
  }

  // szerviz-kód: egyedi, tehát előbb a megszűnőről ki, aztán a megmaradóra be
  if (!blank(merged.worksheetPartnerCode)) {
    if (blank(kept.worksheetPartnerCode)) {
      plan.keptData.worksheetPartnerCode = merged.worksheetPartnerCode!.trim();
      plan.clearOnMerged.push("worksheetPartnerCode");
      plan.fills.push({
        field: "worksheetPartnerCode",
        kind: "move",
        into: "worksheetPartnerCode",
      });
    } else
      plan.blockers.push(
        "Mindkét sornak van szerviz-kódja: az egyik nem vihető át, mert a kód egyedi és a munkalapok hivatkoznak rá.",
      );
  }
  return plan;
}

/** A sorok állapotából fakadó akadályok: önmagával, archivált sorral, két Supplier-kötéssel. */
export function planRowBlockers(
  kept: MergeFacts | null,
  merged: MergeFacts | null,
  ids: { keptId: string; mergedId: string },
): { blockers: string[]; suggestSwap: boolean } {
  const blockers: string[] = [];
  let suggestSwap = false;
  if (ids.keptId === ids.mergedId)
    blockers.push("A két sor ugyanaz: önmagával nem vonható össze.");
  if (!kept) blockers.push("A megmaradó vevő-sor nem található.");
  if (!merged) blockers.push("A megszűnő vevő-sor nem található.");
  if (!kept || !merged || ids.keptId === ids.mergedId)
    return { blockers, suggestSwap };
  if (kept.archivedAt || kept.mergedIntoId)
    blockers.push("A megmaradó sor archivált vagy már egy másikba vonták.");
  if (merged.mergedIntoId === kept.id)
    blockers.push("Ez a két sor már össze van vonva.");
  else if (merged.archivedAt || merged.mergedIntoId)
    blockers.push("A megszűnő sor archivált vagy már egy másikba vonták.");
  if (kept.hasSupplier && merged.hasSupplier)
    blockers.push(
      "Mindkét sor egy partner (szállító vagy szerviz-partner) vevő-tükre: két partner-profil nem vonható egy sorba ezzel a lépéssel.",
    );
  else if (!kept.hasSupplier && merged.hasSupplier) {
    suggestSwap = true;
    blockers.push(
      "A megszűnőnek szánt sor a partner vevő-tükre: az marad meg (a munkalapok és a partner-profil hozzá kötődnek). Cseréld fel a két sort.",
    );
  }
  return { blockers, suggestSwap };
}

/** Egy munkalap-osztály a kulcsához: az (ügyfél, szülő, kód) hármas egyedi az adatbázisban. */
export interface DepartmentKey {
  customerId: string;
  parentId: string | null;
  code: string;
}

/**
 * AZ EGYEDI KULCS-ÜTKÖZÉS: a `WorksheetDepartment` (customerId, parentId, code) egyedi, tehát ha a megszűnő soron és a megmaradón is
 * van azonos szülő alatt azonos kódú osztály, az áthelyezés az adatbázison bukna (nyers 500). Előre akadályként nevezzük meg.
 * Szülő nélküli osztálynál az adatbázis a NULL-t különbözőnek veszi, ott nincs ütközés.
 */
export function departmentConflicts(
  departments: readonly DepartmentKey[],
  ids: { keptId: string; mergedId: string },
): string[] {
  const keptKeys = new Set(
    departments
      .filter((d) => d.customerId === ids.keptId && d.parentId !== null)
      .map((d) => `${d.parentId}|${d.code}`),
  );
  const clashing = departments.filter(
    (d) =>
      d.customerId === ids.mergedId &&
      d.parentId !== null &&
      keptKeys.has(`${d.parentId}|${d.code}`),
  );
  return clashing.length
    ? [
        `Mindkét soron van azonos szülő alatt azonos kódú munkalap-osztály (${[
          ...new Set(clashing.map((d) => d.code)),
        ]
          .sort()
          .join(
            ", ",
          )}): az áthelyezés az adatbázis egyedisége miatt nem menne, előbb rendezni kell.`,
      ]
    : [];
}

/** Azonosítók lenyomata, sorrendtől függetlenül. */
export const idsDigest = (ids: readonly string[]): string =>
  createHash("sha256")
    .update(JSON.stringify([...ids].sort()))
    .digest("hex");

/**
 * AZ ELŐNÉZET LENYOMATA: a két azonosító, a megszűnő sor hivatkozásainak táblánkénti száma ÉS azonosítóik lenyomata (egy sor
 * elmozdulása és egy másik érkezése ugyanazt a számot adja, a lenyomat viszont eltér: barracuda, #2187 review) és a mezők kitöltése. A végrehajtás ezt kéri
 * vissza, és a tranzakcióban újraszámolja: ha közben bármi változott (új számla, új rendelés a megszűnő sorra), a lenyomat
 * eltér, és az összevonás megáll, nem hajt végre mást, mint amit az ember látott.
 */
export function previewFingerprint(input: {
  keptId: string;
  mergedId: string;
  willMove: Partial<Record<PartnerMergeReferenceTable, number>>;
  /** a megszűnő sor hivatkozó sorainak azonosítói táblánként */
  movedIds: Partial<Record<PartnerMergeReferenceTable, readonly string[]>>;
  fieldFills: PartnerMergeFieldFill[];
}): string {
  const ordered = Object.entries(input.willMove).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.keptId,
        input.mergedId,
        ordered,
        Object.entries(input.movedIds)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([table, ids]) => [table, idsDigest(ids ?? [])]),
        input.fieldFills.map((f) => [f.field, f.kind, f.into]),
      ]),
    )
    .digest("hex");
}
