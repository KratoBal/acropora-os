import {
  SHIPPING_GATE_SENTENCE_PREFIX,
  SHIPPING_OVERRIDE_REASON_MAX,
  SHIPPING_OVERRIDE_REASON_MIN,
  type WebshopOrderStatus,
} from "@acropora/types";

/**
 * A KISZÁLLÍTÁS KAPUJA A SZERVEREN (kártya 33a0d3c7, murena A1 mérése 2026-11-18, barracuda olvasata, acrobot döntése): a
 * felület sorrendje számla -> csomag -> kiszállítás, de a státusz-végpont ezt eddig nem őrizte: a #72-es teszt rendelés a
 * Kiszállításra számla és csomag nélkül is átment, és a Stripe-levonás ERRE az állapotra fut (commerce
 * `CAPTURE_ON_STATUS = out_for_delivery`), tehát a pénz a számla és a csomag nélkül is bejött volna.
 *
 * A kapu: a Kiszállításra (nem bolti átvételnél) kell kiállított számla ÉS aktív, a szállítótól csomagszámot kapott csomag. A
 * bolti átvétel nem érintett: az `ready_for_pickup` útján megy, és ott nincs csomag. A számla ugyanaz, mint a lépéssoré
 * (`factsOf`): az OS kiállított számlája, vagy előre utalásnál a Számlázz.hu Autokassza kötött számlája.
 *
 * A FELÜLBÍRÁLÁS (`shippingGateDecision`): külön jog (`ORDERS_SHIPPING_OVERRIDE`), kötelező indok, naplósor. AMI ITT MÉG NINCS,
 * SZÁNDÉKOSAN: a jogos KIVÉTELEK (kézzel a szállító portálján feladott csomag, a szállító API kiesése, ismeretlen szállítójú szállítási
 * mód). Hogy ezek valóban előfordulnak-e, Luca válasza dönti el (acrobot kérdése függőben); addig kivétel nincs, csak a naplózott
 * felülbírálás, és a kimondott 409 nevezi meg, mi hiányzik.
 */
export interface ShippingGateFacts {
  storePickup: boolean;
  /** A kiállított (vagy az Autokassza által kötött) számla száma. */
  invoiceNumber: string | null;
  /** Aktív csomag, amelyet a szállító már csomagszámmal nyugtázott. */
  hasParcel: boolean;
}

/** Ami a kapu szerint hiányzik a Kiszállításhoz (üres, ha a lépés mehet vagy nem kapuzott). */
export function shippingGateMissing(
  to: WebshopOrderStatus,
  facts: ShippingGateFacts,
): string[] {
  if (to !== "out_for_delivery" || facts.storePickup) return [];
  return [
    ...(facts.invoiceNumber ? [] : ["kiállított számla"]),
    ...(facts.hasParcel ? [] : ["feladott csomag"]),
  ];
}

/** Null, ha a lépés mehet; különben a mondat, amit a kezelő kap (409). */
export function shippingGateRefusal(
  to: WebshopOrderStatus,
  facts: ShippingGateFacts,
): string | null {
  const missing = shippingGateMissing(to, facts);
  if (missing.length === 0) return null;
  return `${SHIPPING_GATE_SENTENCE_PREFIX} kiállított számla és feladott csomag. Hiányzik: ${missing.join(", ")}. (A sorrend: számla, csomag, kiszállítás; a kártyás levonás a Kiszállításra fut.)`;
}

/**
 * A KAPU DÖNTÉSE A FELÜLBÍRÁLÁSSAL EGYÜTT (kártya 33a0d3c7, acrobot döntése: szerveroldali kapu NAPLÓZOTT felülbírálással). Tiszta
 * függvény, hogy minden ág adatbázis nélkül mérhető legyen, és egy célzott rontás névvel mondja meg, melyik szűnt meg.
 *
 *   go            a kapu nem tart vissza: a lépés megy. Egy megadott indok ilyenkor FIGYELMEN KÍVÜL marad, és nem kerül a naplóba:
 *                 egy "felülbírálás", ami nem volt szükséges, hamis nyom lenne arról, hogy valaki kerülte a kaput
 *   refuse        a kapu tart, és nincs indok: a 409 mondata nevezi meg, mi hiányzik
 *   forbidden     indok van, de a kérőnek nincs felülbírálási joga (403): az indok nem helyettesíti a jogot
 *   bad-reason    jog van, az indok üres vagy a határokon kívül van (400): a napló épp az indokért van
 *   override      jog és indok is van: a lépés megy, és a naplóba kerül a megkerült kapu, az indok és ami hiányzott
 *
 * A JOG ELŐBB, MINT AZ INDOK: aki nem jogosult, ne tudja meg az indok formai szabályait, és ne az indok hibája takarja el, hogy a
 * művelet neki nem jár.
 */
export type ShippingGateDecision =
  | { kind: "go" }
  | { kind: "personal"; missing: string[] }
  | { kind: "refuse"; sentence: string }
  | { kind: "forbidden" }
  | { kind: "bad-reason" }
  | { kind: "override"; reason: string; missing: string[] };

export function shippingGateDecision(input: {
  to: WebshopOrderStatus;
  facts: ShippingGateFacts;
  /** A kérésben kapott indok; `undefined`, ha nem jött (egy üres szöveg viszont "jött, de üres"). */
  overrideReason: string | undefined;
  canOverride: boolean;
  /** A kezelő a "személyes kiszállítás" választást jelölte (Luca, 2026-11-20): csomag nélkül, számlával. */
  personalDelivery?: boolean;
}): ShippingGateDecision {
  /*
    A SZEMÉLYES KISZÁLLÍTÁS (Luca, 2026-11-20): külön, kimondott választás, NEM felülbírálás. Nem kell hozzá jog és indok (a választás az ok), de
    SZÁMLA ilyenkor is kell, és saját naplósora van. Csak ott számít, ahol a kapu egyáltalán áll (a bolti átvétel és a többi lépés nincs kapuzva: ott a
    választás nem hagy nyomot, mert nem kerülte meg semmit). Ha az indok is jön, ez dönt, és az indok figyelmen kívül marad.
      personal   a számla megvan: a lépés megy; a naplóba a csomag hiánya kerül (üres lista, ha volt csomag)
      refuse     a számla hiányzik: a 409 mondata nevezi meg (nem a felülbírálás mondata: a személyes kiszállításhoz is kell számla)
  */
  if (
    input.personalDelivery === true &&
    input.to === "out_for_delivery" &&
    !input.facts.storePickup
  ) {
    if (!input.facts.invoiceNumber)
      return {
        kind: "refuse",
        sentence:
          "A személyes kiszállításhoz is kell kiállított számla. Hiányzik: kiállított számla.",
      };
    return {
      kind: "personal",
      missing: input.facts.hasParcel ? [] : ["feladott csomag"],
    };
  }
  const missing = shippingGateMissing(input.to, input.facts);
  if (missing.length === 0) return { kind: "go" };
  if (input.overrideReason === undefined)
    return {
      kind: "refuse",
      sentence: shippingGateRefusal(input.to, input.facts)!,
    };
  if (!input.canOverride) return { kind: "forbidden" };
  const reason = input.overrideReason.trim();
  if (
    reason.length < SHIPPING_OVERRIDE_REASON_MIN ||
    reason.length > SHIPPING_OVERRIDE_REASON_MAX
  )
    return { kind: "bad-reason" };
  return { kind: "override", reason, missing };
}
