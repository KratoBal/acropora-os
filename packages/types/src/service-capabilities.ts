/**
 * SZOLGALTATAS-KEPESSEGEK -- MEGNEVEZETT KESZLET, EGY HELYEN.
 *
 * UGYANAZ A HAZI MINTA, MINT A `notification-roles.ts`, DE SZANDEKOSAN KULON
 * KESZLET, MERT MAS TENGELY: az ertesites arrol szol, KI ERTESUL; ez arrol,
 * KI VEGEZHETI EL. Balazs a ket jelolot KIFEJEZETTEN fuggetlennek kerte
 * (2026-09-22 20:28:56 UTC, "Nem. Ket kulon jelolo legyen") -- lasd a
 * `UserServiceCapability` sema-jegyzetet.
 *
 * A FELIRAT ITT ALL, NEM A FELULETEN, ugyanabbol az okbol, mint a masik
 * keszletnel: ket masolatbol az egyik elobb-utobb mast mond, es a kulonbseg
 * nema.
 */
export interface ServiceCapabilityInfo {
  /** Az adatbazis enum erteke. */
  readonly value: "MATERIAL_REQUEST_MARK_RECEIVED" | "AQUARIUM_ASSET_ASSIGN";
  /** A jelolonegyzet felirata. */
  readonly label: string;
  /** Mit jelent, ha be van jelolve -- a felirat ala. */
  readonly description: string;
  /**
   * MELYIK FIÓK-FAJTÁN JELENIK MEG A FELHASZNÁLÓ-SZERKESZTŐN.
   *
   * A KÉSZLET EDDIG EGYETLEN, "csak saját kollégánál" ágra épült (lásd
   * `user-editor-page.tsx` fejlécét): a `MATERIAL_REQUEST_MARK_RECEIVED`
   * a MI oldalunk munkája, egy partner-fióknál bejelölve MINDEN vevő
   * anyagigényét mutatná. Az `AQUARIUM_ASSET_ASSIGN` (emlék 1843, 1847)
   * VISZONT KIFEJEZETTEN partner-fiókra való -- egy internal kollégának
   * bejelölve semmit nem jelentene (ő úgyis `SERVICE_MANAGE`-en át
   * mindent elér). Ez a mező ezért NEM dísz: a szerkesztő ez alapján
   * dönti el, melyik fiók-fajtánál mutassa az adott sort, ahelyett hogy
   * a TELJES "Képességek" szakaszt egyetlen `customerId === ""` ág
   * mögé rejtené (az korábban helyes volt, amíg csak egyetlen, belsős
   * kapacitás létezett).
   */
  readonly audience: "internal" | "partner";
}

export const SERVICE_CAPABILITIES: readonly ServiceCapabilityInfo[] = [
  {
    value: "MATERIAL_REQUEST_MARK_RECEIVED",
    label: "Anyag beérkezésének jelölése",
    description:
      "Láthatja a rá váró anyagigényeket, és megjelölheti, ha egy elküldött igény beérkezett. Ez csak a jelölés joga -- attól függetlenül állítható, hogy kap-e értesítést az új igényekről.",
    audience: "internal",
  },
  /**
   * PARTNER-FIÓKOKON JELÖLENDŐ (emlék 1843, 1847) -- de a mezőt maga a
   * jelölőnégyzet nem korlátozza szerepre, ugyanúgy, ahogy a másik
   * kapacitás sem: aki bejelöli valakinél a felhasználó-szerkesztőn, azé
   * a döntés, nem ezé a listáé.
   */
  {
    value: "AQUARIUM_ASSET_ASSIGN",
    label: "Eszköz hozzárendelése akváriumhoz (partner portál)",
    description:
      "A partner portálon hozzárendelheti vagy leveheti a saját helyszínének eszközeit egy akváriumról. Az akvárium többi mezője (név, víztípus, víztérfogat) enélkül is, ezzel is csak olvasható marad a portálon.",
    audience: "partner",
  },
] as const;

export type ServiceCapabilityValue = ServiceCapabilityInfo["value"];

export const SERVICE_CAPABILITY_VALUES: readonly ServiceCapabilityValue[] =
  SERVICE_CAPABILITIES.map((kepesseg) => kepesseg.value);
