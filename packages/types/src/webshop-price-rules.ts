/**
 * A WEBSHOP HŰSÉGPONT- ÉS ÁRSZABÁLYAI AZ OS-BŐL (acrobot 60467; Balázs, 2026-11-24: „minden szám és kapcsoló adminból állítható”).
 * A webshopban mind `commerce-settings` kulcs (commerce #880 az Omnibus-küszöb, #881 a hűségpont beváltása); ide ezekbe ír az
 * OS. A határok a webshopéval egyeznek: ott a döntő ellenőrzés, itt az űrlapé, hogy a hiba már a mentés előtt látsszon.
 *
 * A BEVÁLTÁS ÉRTÉKEI NEM CSAK A TÁROLT SORBÓL JÖNNEK (barracuda, #2824): a webshop mezőnként a tárolt sort, aztán a környezetet
 * (`LOYALTY_*`, így van bekapcsolva a teszt kirakat), aztán az alapértéket nézi. Ezért az öt beváltási mező a webshop
 * `GET /admin/loyalty-settings` válaszából jön, a forrással együtt (`loyaltyField` a válasz mezője), és a mentés csak azt
 * írja, amit valaki a mutatott értékhez képest megváltoztatott: egy környezetből jövő érték így nem íródik felül egy olyan
 * sorral, amit senki nem kért.
 */

export const WEBSHOP_PRICE_RULE_SECTIONS = [
  {
    id: "redemption",
    title: "Hűségpont beváltása",
    description:
      "A vevő a pénztárban pontjaival fizethet. A mai bolt értékei az alapértékek; a beváltás alapból ki van kapcsolva.",
  },
  {
    id: "omnibus",
    title: "Árcsökkentés közlése (Omnibus)",
    description:
      "Áthúzott árat és „legalacsonyabb ár” sort csak akkor mutat a webshop, ha az árcsökkentés mögött legalább ennyi napos ár-előzmény áll.",
  },
] as const;
export type WebshopPriceRuleSection =
  (typeof WEBSHOP_PRICE_RULE_SECTIONS)[number]["id"];

/** A mezők a webshop kulcsaival és határaival, abban a sorrendben, ahogy a lap mutatja. */
export const WEBSHOP_PRICE_RULES = [
  {
    field: "loyaltyRedemptionEnabled",
    key: "loyalty_redemption_enabled",
    loyaltyField: "enabled",
    section: "redemption",
    kind: "switch",
    min: 0,
    max: 1,
    unit: "",
    label: "Pontbeváltás a pénztárban",
  },
  {
    field: "loyaltyPointValueHuf",
    key: "loyalty_point_value_huf",
    loyaltyField: "value",
    section: "redemption",
    kind: "number",
    min: 1,
    max: 1_000_000,
    unit: "Ft",
    label: "Egy pont értéke",
  },
  {
    field: "loyaltyMinOrderHuf",
    key: "loyalty_min_order_huf",
    loyaltyField: "minOrder",
    section: "redemption",
    kind: "number",
    min: 0,
    max: 1_000_000_000,
    unit: "Ft",
    label:
      "Beváltás ettől a végösszegtől (szállítással, a kedvezmények előtt; 0: nincs alsó határ)",
  },
  {
    field: "loyaltyMinPoints",
    key: "loyalty_min_points",
    loyaltyField: "minPoints",
    section: "redemption",
    kind: "number",
    min: 1,
    max: 1_000_000_000,
    unit: "pont",
    label: "Egyszerre legalább ennyi pont váltható be",
  },
  {
    field: "loyaltyMaxPercent",
    key: "loyalty_max_percent",
    loyaltyField: "maxPercent",
    section: "redemption",
    kind: "number",
    min: 1,
    max: 100,
    unit: "%",
    label: "A végösszeg legfeljebb ennyi százaléka fizethető pontból",
  },
  {
    field: "omnibusMinHistoryDays",
    key: "omnibus_min_history_days",
    loyaltyField: null,
    section: "omnibus",
    kind: "number",
    min: 15,
    max: 30,
    unit: "nap",
    label:
      "Legalább ennyi napos ár-előzmény (15 és 30 között; a 15 a rendelet alsó határa)",
  },
] as const;
export type WebshopPriceRuleField =
  (typeof WEBSHOP_PRICE_RULES)[number]["field"];

/** Egész szám; `null`, ha a webshopban nincs beállítva és alapértéke sincs. */
export type WebshopPriceRuleValues = Record<
  WebshopPriceRuleField,
  number | null
>;

/**
 * HONNAN JÖN A MUTATOTT ÉRTÉK (a webshop szavai, commerce #881): `row` valaki tárolta, `env` a webshop környezete, `default`
 * senki nem állította, `row_invalid` van tárolt sor, de a határokon kívül esik, ezért a webshop a környezetét vagy az
 * alapértékét használja, `read_failed` a beállítások olvasása elbukott (a kapcsoló ilyenkor KI).
 */
export type WebshopPriceRuleSource =
  "row" | "env" | "default" | "row_invalid" | "read_failed";

export type WebshopPriceRules = {
  values: WebshopPriceRuleValues;
  sources: Record<WebshopPriceRuleField, WebshopPriceRuleSource>;
};

export type WebshopPriceRulesParse =
  | { ok: true; value: Record<WebshopPriceRuleField, number> }
  | { ok: false; errors: Record<string, string> };

/** Hármas csoportok sima szóközzel (1 000 000), mint a szállítási díjak hibaüzenete; a `hu-HU` ezt nem adja egyformán. */
const groupDigits = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Ugyanaz a szabály az űrlapon és az API-ban: minden mező megadva, egész szám a mező határain belül, a kapcsoló 0 vagy 1. */
export function parseWebshopPriceRulesInput(
  raw: unknown,
): WebshopPriceRulesParse {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const value = {} as Record<WebshopPriceRuleField, number>;
  for (const rule of WEBSHOP_PRICE_RULES) {
    const amount = input[rule.field];
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < rule.min ||
      amount > rule.max
    )
      errors[rule.field] =
        rule.kind === "switch"
          ? "Be- vagy kikapcsolva (1 vagy 0)."
          : `Egész szám ${groupDigits(rule.min)} és ${groupDigits(rule.max)} között.`;
    else value[rule.field] = amount;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}
