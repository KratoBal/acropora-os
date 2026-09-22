import type { Prisma } from "@acropora/database";
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
  type: AssetDocumentTypeValue,
  scope: PartnerScope,
): boolean {
  if (scope.kind === "internal") return true;
  return type === "WARRANTY" || type === "MANUAL";
}

/**
 * A NEGY FAJTA, EGY HELYEN.
 *
 * A lista eddig KETSZER allt (itt es a tarolo fajljaban), ugyanazzal a negy
 * ertekkel. Ket masolat eseten egy otodik fajta felvetelenel az egyik atvezetve
 * marad, a masik nem -- es az elteres NEMA: a lemarado ag egyszeruen kihagyja
 * az uj fajtat a szuresbol.
 */
export const ASSET_DOCUMENT_TYPES = [
  "INVOICE",
  "WARRANTY",
  "MANUAL",
  "OTHER",
] as const;

export type AssetDocumentTypeValue = (typeof ASSET_DOCUMENT_TYPES)[number];

/**
 * UGYANAZ A SZABALY, LISTAKENT -- annak, aki nem EGY sorrol dont, hanem
 * LEKERDEZESI FELTETELT ir.
 *
 * MIERT KELL A PREDIKATUM MELLE: a `scopeMaySeeDocumentType` egy MAR BETOLTOTT
 * sorrol mond igent vagy nemet. Egy `updateMany` viszont nem tolt be sort: a
 * feltetelben kell megmondani, mire szabad rairni. A ketto ugyanabbol a
 * fuggvenybol dolgozik, tehat nem tud szetcsuszni -- egy kulon felsorolas a
 * lekerdezes oldalan pont az a masodik masolat lenne, ami eloszor-utoljara
 * egyezik.
 */
export function scopeVisibleDocumentTypes(
  scope: PartnerScope,
): AssetDocumentTypeValue[] {
  return ASSET_DOCUMENT_TYPES.filter((type) =>
    scopeMaySeeDocumentType(type, scope),
  );
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
 * AZ ESZKÖZ-LÁTHATÓSÁG: TULAJDON **VAGY** SAJÁT HELYSZÍN.
 *
 * === MIÉRT KÜLÖN FÜGGVÉNY, ÉS NEM A FENTI BŐVÍTÉSE ===
 *
 * A `scopeWhereForAndBranch` KÖZÖS: a munkalapok, a hibajegyek és a partnerek
 * lekérdezése is azt hívja. Ha ott nyitnánk ki az ágat, a láthatóság MINDEN
 * táblán szélesedne -- és azt egyik mérés sem kérte. Ez a függvény kizárólag az
 * `Asset` táblára szól, ahol a helyszín fogalma értelmezett.
 *
 * === A SZABÁLY, ÉS MIÉRT EZ ===
 *
 * Mérve 2026-09-18 (acrobot, stage): a partner helyszínén álló eszközök
 * SZÁLLÍTÓ-tulajdonúak (2 sorból 2), vevő-tulajdonú NULLA van. A portál viszont
 * vevő-tulajdonút kért, tehát a kérdés szükségszerűen nulla sort adott: a lap
 * pont azt nem kaphatta meg, amit meg akart mutatni.
 *
 * A séma ugyanezt mondja a másik irányból (`Asset.departmentId` fejléce): a
 * helyszín CSAK szállító tulajdonosnál értelmes, a vevő-oldali finomítás a
 * `customerAddressId`.
 *
 * === AMI SZÁNDÉKOSAN NEM VÁLTOZIK ===
 *
 * A SZÁLLÍTÓ-hatókör marad tulajdon-alapú. Egy szállító a saját eszközeit látja;
 * nincs olyan fogalom, hogy "a szállító helyszíne", és egy `OR` ág ott csak
 * tágítana, mérés nélkül.
 *
 * A BELSŐS hatókör üres marad, ahogy eddig.
 */
export function assetVisibilityForAndBranch(
  scope: PartnerScope,
  assignedUnitIds: readonly string[],
): Prisma.AssetWhereInput {
  switch (scope.kind) {
    case "internal":
      return {};
    case "customer":
      /**
       * A VEVO-AG A KIOSZTOTT HELYSZINEKRE SZUKIT, NEM AZ UGYFELERE
       * (2026-09-22, c654a5d4).
       *
       * === A SZABALY MAR KI VOLT MONDVA, KET MONDATBAN, KET NAPON ===
       *
       * Balazs, 2026-09-21 14:34:07 (idezve az `asset-detail-scope.spec.ts`
       * fejlecebol): "a partner azokat az eszkozoket latja, aminek a helyszine
       * hozza van rendelve"
       *
       * Balazs, 2026-09-22 07:46:59 (Discord, a hozzarendeles nelkuli
       * portal-felhasznalorol): "akkor semmit se lasson"
       *
       * A MASODIK DONTI EL AZ ELSOT. Az elso mondat olvashato ugy is, hogy a
       * helyszin az UGYFELHEZ tartozik -- ezt epitette meg a korabbi alak --,
       * es ugy is, hogy a FELHASZNALOHOZ. Ha az ugyfel-szintu olvasat allna, a
       * hozzarendeles nelkuli felhasznalo az ugyfel MINDENET latna, es epp azt
       * mondta, hogy ne.
       *
       * === AMI A KORABBI ALAKBAN FELCSUSZOTT ===
       *
       * A masodik ag felmegy a DEPARTMENT-re, es annak a CUSTOMER-et nezi:
       * "ennek az eszkoznek az egysege az en ugyfelemhez tartozik-e", NEM
       * "az en kiosztott egysegeimben all-e". Ugyanaz a felcsuszas, mint a
       * hibajegy-tengelynel a #966 elott, csak `some` nelkul: nem a SORROL
       * kerdez, hanem a SZULORE megy fel.
       *
       * === AZ URES HALMAZ URES EREDMENYT AD, ES EZ DONTES ===
       *
       * `{ in: [] }` all itt, nem elhagyott ag. Ugyanaz az alak, amit a
       * `scopeOwnWhereForAndBranch` hasznal a kereszt-esetre, ugyanabbol az
       * okbol: egy ures halmaz, amit a kod "nincs szures"-nek fordit, pontosan
       * a javitott hibat adna vissza.
       *
       * === A KULSO `OR` MINDKET AGA ALA ESIK, ES EZ IS DONTES ===
       *
       * Egy eszkoz, ami az UGYFEL NEVEN all, de nem kiosztott helyszinen,
       * SZINTEN kiesik. Ez meresbol ma nem donthetо el, mert olyan sor nincs:
       *
       *   korabbi meres (mas nap, az asset-detail-scope fejlecebol):
       *     79 eszkozbol 79 SZALLITOI tulajdonu, sajat `customerId`-je
       *     egyiknek sincs
       *   mai meres (acrobot, 2026-09-22 09:5x, eles):
       *     83 eszkoz, 0 az ugyfel NEVEN, mind a 83 a helyszinein
       *
       * Ket kulonbozo nap, ket kulonbozo szam, UGYANAZ AZ ALAK. Ezert all ra
       * kulon allitas KITALALT fixturaval: a valos adat ezt az agat nem
       * allitja elo, tehat egy valos fixtura a feltetel mindket allasan
       * ugyanazt adna.
       */
      /*
        A VEVO-TULAJDONU ESZKOZ A HELYSZIN-TENGELYEN NEM TUD ATMENNI, mert a kod
        MINDKET irasi uton nullara kenyszeriti a `departmentId` mezot
        (`create` es `update`: `ownerType === "SUPPLIER" ? input.departmentId : null`).
        A sajat jegyzetuk szerint a vevo-tulajdonu eszkozon `customerAddressId`
        es `aquariumId` all helyette -- a ket mezo nem ugyanaz a fogalom.

        EZ MA NEM VESZ EL SEMMIT, ES A NEVEZO TOBBET MOND, MINT A NULLA:
        2026-09-22-en 83 eszkozbol 0 vevo-tulajdonu (acrobot merese az eles
        adatbazison, acropora-prod-01; `customerAddressId` sem all egyetlen
        soron sem). HA EZ A SZAM VALAHA NEM NULLA, EZ A DONTES UJRANYITANDO.

        A MASIK ALAK, amit emiatt NEM valasztottunk: a helyszin-tengely csak ott
        szurjon, ahol helyszin VAN. Az visszahozna az UGYFEL-SZINTU lathatosagot
        erre a kategoriara -- egy vevo-tulajdonu eszkozt a vevo BARMELYIK embere
        latna, helyszintol fuggetlenul --, vagyis pont azt, amit a gazda
        2026-09-22 07:46:59 UTC-kor elutasitott.
      */
      return {
        AND: [
          {
            OR: [
              { customerId: scope.customerId },
              { department: { customerId: scope.customerId } },
            ],
          },
          { departmentId: { in: [...assignedUnitIds] } },
        ],
      };
    case "supplier":
      /**
       * A SZALLITO-AG SZANDEKOSAN NEM SZUKUL (acrobot dontese, 2026-09-22).
       *
       * Ket kulon indok all mogotte, es a masodik a merheto:
       *
       *   a fejlec erve  "nincs olyan fogalom, hogy a szallito helyszine"
       *   a mert nulla   szallito-hatokoru felhasznalo: 0 (eles, 2026-09-22;
       *                  vevo-hatokoru 2, belsos 6)
       *
       * A nulla ketszeresen szamit: ma senkit nem erintene a szukites, ES nem
       * is lenne mivel kalibralni -- nincs egyetlen sor sem, amin megmutathato
       * lenne, hogy a szukites LAT. Egy valtozas, amihez nem tudunk pozitiv
       * kontrollt allitani, epp az, amit ez a hazban mashol elutasitunk.
       *
       * Ha egyszer lesz szallito-felhasznalo, ez a nulla lejar, es akkor ezt a
       * dontest ujra kell merni -- nem automatikusan atvenni.
       */
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
