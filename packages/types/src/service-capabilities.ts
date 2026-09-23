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
  readonly value: "MATERIAL_REQUEST_MARK_RECEIVED";
  /** A jelolonegyzet felirata. */
  readonly label: string;
  /** Mit jelent, ha be van jelolve -- a felirat ala. */
  readonly description: string;
}

export const SERVICE_CAPABILITIES: readonly ServiceCapabilityInfo[] = [
  {
    value: "MATERIAL_REQUEST_MARK_RECEIVED",
    label: "Anyag beérkezésének jelölése",
    description:
      "Láthatja a rá váró anyagigényeket, és megjelölheti, ha egy elküldött igény beérkezett. Ez csak a jelölés joga -- attól függetlenül állítható, hogy kap-e értesítést az új igényekről.",
  },
] as const;

export type ServiceCapabilityValue = ServiceCapabilityInfo["value"];

export const SERVICE_CAPABILITY_VALUES: readonly ServiceCapabilityValue[] =
  SERVICE_CAPABILITIES.map((kepesseg) => kepesseg.value);
