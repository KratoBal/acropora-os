import type { AuthenticatedUser } from "@acropora/types";

/**
 * A KERO HATOKORE: KI NEVEBEN ERKEZIK A KERES.
 *
 * Harom eset van, es a harmadik a fontos: aki NEM partner, az BELSOS, es
 * mindent lat. Ez nem kivetel a szabaly alol, hanem a szabaly maga -- a
 * spec (C) csoportja pontosan azert all kulon, mert a belsos valasztok
 * teljes halmazt kell lassanak, es egy csendben szukitett lista rontana el a
 * belsos munkat (partner-valaszto, felelos-valaszto, tulajdonos-valaszto).
 *
 * A ket partner-ag SZANDEKOSAN kulon all, nem egy `partnerId` mezoben: a
 * semaban is ket kulon oszlop all (`User.customerId`, `User.supplierId`), es
 * egy vevo-felhasznalo nem lathat szerviz-partner sort attol, hogy ugyanabba
 * a mezobe kerult volna az azonositoja.
 */
export type PartnerScope =
  | { readonly kind: "internal" }
  | { readonly kind: "customer"; readonly customerId: string }
  | { readonly kind: "supplier"; readonly supplierId: string };

/**
 * A munkamenetbol allitja elo a hatokort.
 *
 * HA MINDKET MEZO KI VAN TOLTVE, a keres ELUTASITASA a helyes valasz, es NEM
 * az, hogy valamelyiket valasztjuk: egy felhasznalo, aki egyszerre vevo es
 * szallito, ma nem ertelmezheto allapot, es a talalgatas itt azt jelentene,
 * hogy a masik fel adatat mutatjuk meg neki. Ezert dob, nem donti el.
 */
export function partnerScopeOf(user: AuthenticatedUser): PartnerScope {
  const customerId = user.customerId ?? null;
  const supplierId = user.supplierId ?? null;

  if (customerId !== null && supplierId !== null) {
    throw new Error(
      `A felhasználó (${user.id}) egyszerre vevőhöz és szállítóhoz is kötve van, ` +
        "ezért a hatóköre nem állapítható meg. Ez adathiba, nem jogosultsági kérdés.",
    );
  }
  if (customerId !== null) return { kind: "customer", customerId };
  if (supplierId !== null) return { kind: "supplier", supplierId };
  return { kind: "internal" };
}

/**
 * IGAZ, HA A BETOLTOTT SOR A KEROE.
 *
 * A NULL TULAJDONOS NEM SZABAD KAPU: egy partnerhez kotott kero szamara az
 * ismeretlen tulajdonosu sor IDEGEN. Enelkul egy hianyzo `customerId` a
 * legszelesebb hozzaferest adna, ami pont forditva van, mint amit egy hianyzo
 * ertektol varnank.
 */
export function rowBelongsToScope(
  row: { customerId?: string | null; supplierId?: string | null },
  scope: PartnerScope,
): boolean {
  switch (scope.kind) {
    case "internal":
      return true;
    case "customer":
      return row.customerId === scope.customerId;
    case "supplier":
      return row.supplierId === scope.supplierId;
  }
}

/**
 * IGAZ, HA A BETOLTOTT SOR MAGA A KERO PARTNERE.
 *
 * Ez MAS, mint a `rowBelongsToScope`: ott a sor HIVATKOZIK egy partnerre
 * (`customerId` / `supplierId`), itt a sor MAGA a partner, tehat a sajat
 * azonositoja a mérce. A ket alakot azert tartom kulon, mert egy kozos
 * fuggveny a hivo helyen nem mutatna meg, melyikrol van szo -- es epp ez a
 * kulonbseg csuszna el csendben.
 *
 * A VEVO-HATOKORU KERO NEM LATJA A SZALLITOT, es forditva sem. Ez DONTES, nem
 * meres: a spec a partner-oldali hozzaferesrol szol, es nem mondja ki, hogy egy
 * vevo-felhasznalo lathat-e szerviz-partner sort. Bizonytalansagnal az
 * alapertelmezes a NEM, mert egy elmaradt hozzaferes panaszt szul, egy
 * kereetlen viszont idegen adatot mutat. Ha ez tul szuk, egy sor itt.
 */
export function rowIsScopeOwner(
  row: { id: string },
  scope: PartnerScope,
  ownerKind: "customer" | "supplier",
): boolean {
  switch (scope.kind) {
    case "internal":
      return true;
    case "customer":
      return ownerKind === "customer" && row.id === scope.customerId;
    case "supplier":
      return ownerKind === "supplier" && row.id === scope.supplierId;
  }
}

/**
 * LATHATJA-E A KERO EZT A DOKUMENTUM-TIPUST.
 *
 * A tulajdonos-egyeztetes ONMAGABAN nem eleg: egy SAJAT eszkozhoz tartozo
 * szamla sem megy ki a partnernek. Ezert all kulon fuggvenyben -- a hivo helyen
 * latszik, hogy KET feltetel van, nem egy.
 *
 * A tablazat forrasa nem egysegese, es ezt jelolni kell:
 *    INVOICE   nem     BALAZS DONTESE, szo szerint: "szamlat nem"
 *    WARRANTY  igen    a mi olvasatunk
 *    MANUAL    igen    a mi olvasatunk
 *    OTHER     nem     a mi olvasatunk. Az indok NEM az, hogy alapertek (a
 *                      semaban nincs alapertelmezese), hanem hogy az OTHER
 *                      DEFINICIO SZERINT az, amit nem soroltak be: a
 *                      tartalmarol nincs allitasunk. Ha kell belole valami a
 *                      partnernek, az EGY KERDES lesz, nem csendes szivargas.
 */
export function scopeMaySeeDocumentType(
  type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER",
  scope: PartnerScope,
): boolean {
  if (scope.kind === "internal") return true;
  return type === "WARRANTY" || type === "MANUAL";
}

/**
 * A HATOKOR MINT LEKERDEZESI FELTETEL -- ES A NEV AZT IS MEGMONDJA, HOVA VALO.
 *
 * `AND` AGKENT KELL BEKOTNI, SOHA NEM KULCSKENT, es ez nem stilus:
 *
 * 1. A meglevo `where` objektumok literal-spreadekbol allnak, es a FELHASZNALOI
 *    szuro (`ownerType` + `ownerId`) UGYANAZT a kulcsot hasznalja
 *    (`customerId` / `supplierId`). Egy objektum-literalban az azonos kulcs
 *    UTOLSO elofordulasa nyer -- vagyis a kesobb spreadelt felhasznaloi szuro
 *    FELULIRNA a jogosultsagit, es a hivo egy idegen `ownerId` parameterrel
 *    kikapcsolhatna a sajat szureset, hibauzenet nelkul.
 * 2. A lista-lekerdezesekben FELSO SZINTU `OR` is all (kereses). Egy `OR`
 *    ugyanazon a szinten a jogosultsagi feltetellel azt jelenti, hogy a talalat
 *    az OR barmelyik agatol atmegy -- tehat a jogosultsag "vagy" agga valik.
 *
 * Beagyazott `AND` csomopontban egyik sem tortenhet meg.
 *
 * Merve 2026-08-29 (nautilus, a 30e27f3d kartyan): 41 repository fajlbol 40
 * epit `where` zaradekot, 13 spread-el felteteles felhasznaloi szurot a FELSO
 * szintu `where`-be (46 ilyen spread), es 15 hasznal felso szintu `OR`-t.
 */
export function scopeWhereForAndBranch(scope: PartnerScope): {
  customerId?: string;
  supplierId?: string;
} {
  switch (scope.kind) {
    case "internal":
      return {};
    case "customer":
      return { customerId: scope.customerId };
    case "supplier":
      return { supplierId: scope.supplierId };
  }
}

/**
 * UGYANEZ, DE A PARTNER SAJAT TABLAJARA, ahol a sor MAGA a partner (`Supplier`,
 * `Customer`), tehat az `id` a merce, nem egy hivatkozo oszlop.
 *
 * A KERESZT-ESET (vevo-hatokor a szallitok tablajan, vagy forditva) EXPLICIT
 * URES HALMAZT ad, nem `{}`-t. Ez szandekos: a `{}` azt jelentene, hogy nincs
 * szures, tehat a vevo a TELJES szallito-listat kapna. Az `id: { in: [] }`
 * ellenben egyertelmuen ures eredmenyt ad, es a kodban is latszik, hogy ez
 * dontes volt, nem elmaradt ag.
 */
export function scopeOwnWhereForAndBranch(
  scope: PartnerScope,
  ownerKind: "customer" | "supplier",
): { id?: string | { in: string[] } } {
  if (scope.kind === "internal") return {};
  if (scope.kind === "customer" && ownerKind === "customer") {
    return { id: scope.customerId };
  }
  if (scope.kind === "supplier" && ownerKind === "supplier") {
    return { id: scope.supplierId };
  }
  return { id: { in: [] } };
}
