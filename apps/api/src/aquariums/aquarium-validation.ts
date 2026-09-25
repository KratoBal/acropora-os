/**
 * ÜGYFÉL-TULAJDONNÁL AZ ÜGYFÉL KÖTELEZŐ.
 *
 * Balázs felsorolása (2026-09-24): "Saját, vagy ügyfél akváriuma/tava...
 * ha nem saját akkor az ügyfél neve, címe, telefonszáma email címe." A
 * `CUSTOMER` tulajdon vagy egy MEGLÉVŐ ügyfelet választ (`customerId`),
 * vagy egy ÚJAT visz fel ugyanezen a lapon (`hasNewCustomer`) -- a kettő
 * közül pontosan az egyik kell, `OWN`-nál egyik sem értelmezhető.
 */
export type AquariumCustomerRequirementProblem =
  "CUSTOMER_REQUIRED" | "OWN_CANNOT_HAVE_CUSTOMER";

export function aquariumCustomerRequirementProblem(input: {
  ownershipType: "OWN" | "CUSTOMER";
  customerId?: string | null;
  hasNewCustomer: boolean;
}): AquariumCustomerRequirementProblem | null {
  if (input.ownershipType === "CUSTOMER") {
    if (!input.customerId && !input.hasNewCustomer) return "CUSTOMER_REQUIRED";
    return null;
  }
  // OWN
  if (input.customerId || input.hasNewCustomer)
    return "OWN_CANNOT_HAVE_CUSTOMER";
  return null;
}

export const AQUARIUM_CUSTOMER_REQUIREMENT_MESSAGE: Record<
  AquariumCustomerRequirementProblem,
  string
> = {
  CUSTOMER_REQUIRED:
    "Ügyfél tulajdonú akváriumnál válassz meglévő ügyfelet, vagy vidd fel újként.",
  OWN_CANNOT_HAVE_CUSTOMER: "Saját tulajdonú akváriumhoz nem tartozhat ügyfél.",
};

/**
 * A NYOMELEM-ADAGOLÓ CSATORNASZÁMA KÖTELEZŐ, MINDEN MÁS FAJTÁNÁL ÉRTELMETLEN.
 *
 * Balázs kérése (2026-09-24), szó szerint: "nyomelem adagoló típusa csatorna
 * száma". A `channelCount` a sémában szabadon nullázható mezőként áll (lásd
 * a `AquariumEquipment` fejlécét) -- ez a függvény adja a `kind`-tól függő
 * szabályt, API-rétegben, nem adatbázis-szintű CHECK-ben, mert egy
 * feltételes CHECK ugyanezt duplikálná.
 */
export type AquariumEquipmentProblem =
  "CHANNEL_COUNT_REQUIRED" | "CHANNEL_COUNT_NOT_ALLOWED";

export function aquariumEquipmentProblem(input: {
  kind: string;
  channelCount?: number | null;
}): AquariumEquipmentProblem | null {
  const needsChannelCount = input.kind === "NYOMELEM_ADAGOLO";
  if (needsChannelCount && !input.channelCount) return "CHANNEL_COUNT_REQUIRED";
  if (!needsChannelCount && input.channelCount != null)
    return "CHANNEL_COUNT_NOT_ALLOWED";
  return null;
}

export const AQUARIUM_EQUIPMENT_PROBLEM_MESSAGE: Record<
  AquariumEquipmentProblem,
  string
> = {
  CHANNEL_COUNT_REQUIRED: "A nyomelem-adagoló csatornaszáma kötelező.",
  CHANNEL_COUNT_NOT_ALLOWED:
    "Csatornaszám csak a nyomelem-adagolónál adható meg.",
};

/**
 * A VÍZÉRTÉK-CÉLTARTOMÁNY ALSÓ HATÁRA NEM LEHET NAGYOBB A FELSŐNÉL.
 *
 * Balázs kérése (2026-09-25): "tól-ig, ami alapján számolja az eltérést" --
 * egy fordított tartomány (pl. tól=10, ig=5) sosem lenne kielégíthető, és a
 * hiba a PONTOS paraméterre nevesítve érkezzen, nem "valamelyik sor rossz"
 * alakban -- ezért a hívó (a service) a paraméter LABEL-jét fűzi az
 * üzenethez, ez a függvény csak a döntést adja.
 */
export function aquariumMeasurementTargetRangeInvalid(input: {
  min?: number;
  max?: number;
}): boolean {
  return (
    input.min !== undefined && input.max !== undefined && input.min > input.max
  );
}
