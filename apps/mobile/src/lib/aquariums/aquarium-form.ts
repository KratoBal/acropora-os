import { equipmentRequiresChannelCount } from "./aquarium-presentation";
import type {
  AquariumEquipmentKind,
  AquariumOwnershipType,
} from "./aquarium-presentation";

/**
 * A FELVITELI ŰRLAP DÖNTÉSEI, a képernyő törzsétől függetlenül -- ugyanaz az
 * elv, mint az `asset-payload-form.ts`-nél: a validáció itt tesztelhető,
 * a képernyőn csak a mezők állnak.
 */

export interface EquipmentDraft {
  kind: AquariumEquipmentKind;
  manufacturer: string;
  model: string;
  /** Szöveges mező, mert a felhasználó gépeli -- a hívó parse-olja számmá. */
  quantity: string;
  /** Csak a `NYOMELEM_ADAGOLO` fajtánál kötelező (brief 5. döntés). */
  channelCount: string;
  notes: string;
}

export function emptyEquipmentDraft(
  kind: AquariumEquipmentKind,
): EquipmentDraft {
  return {
    kind,
    manufacturer: "",
    model: "",
    quantity: "1",
    channelCount: "",
    notes: "",
  };
}

/**
 * NULL, HA RENDBEN VAN -- KÜLÖNBEN A HIBASZÖVEG. A mennyiség pozitív egész
 * legyen (nincs "fél lehabzó"), a csatornaszám csak a nyomelem adagolónál kell.
 */
export function equipmentDraftError(draft: EquipmentDraft): string | null {
  const quantity = Number(draft.quantity);
  if (!draft.quantity.trim() || !Number.isInteger(quantity) || quantity <= 0)
    return "A mennyiség pozitív egész szám legyen.";
  if (equipmentRequiresChannelCount(draft.kind)) {
    const channelCount = Number(draft.channelCount);
    if (
      !draft.channelCount.trim() ||
      !Number.isInteger(channelCount) ||
      channelCount <= 0
    )
      return "A nyomelem adagolónál a csatornaszám kötelező.";
  }
  return null;
}

export interface NewCustomerDraft {
  displayName: string;
  phone: string;
  email: string;
  postalCode: string;
  city: string;
  line1: string;
}

export function emptyNewCustomerDraft(): NewCustomerDraft {
  return {
    displayName: "",
    phone: "",
    email: "",
    postalCode: "",
    city: "",
    line1: "",
  };
}

/**
 * A CÍM VAGY TELJES, VAGY HIÁNYZIK -- rész-cím nem megy tovább, mert a
 * `CreateCustomerAddressInput` mindhárom mezőt kéri (`postalCode`, `city`,
 * `line1`), ha egyáltalán küldünk címet.
 */
export function newCustomerDraftError(draft: NewCustomerDraft): string | null {
  if (!draft.displayName.trim()) return "Az ügyfél neve kötelező.";
  const addressFields = [draft.postalCode, draft.city, draft.line1];
  const filled = addressFields.filter((value) => value.trim()).length;
  if (filled > 0 && filled < addressFields.length)
    return "A címhez irányítószám, település és utca/házszám is kell -- vagy hagyd üresen mindet.";
  return null;
}

export interface AquariumFormState {
  name: string;
  ownershipType: AquariumOwnershipType;
  customerMode: "EXISTING" | "NEW";
  selectedCustomerId: string | null;
  newCustomer: NewCustomerDraft;
}

/**
 * NULL, HA MENTHETŐ -- KÜLÖNBEN A HIBASZÖVEG.
 *
 * AZ EGYSÉG-ELLENŐRZÉST NEM ISMÉTLI MEG: az eszközsorok saját, korábbi
 * lépésben ellenőrzöttek (`equipmentDraftError`), mire idáig eljutnak -- a
 * képernyő nem engedi hozzáadni az érvénytelen sort.
 */
export function aquariumFormError(state: AquariumFormState): string | null {
  if (!state.name.trim()) return "Az akvárium neve kötelező.";
  if (state.ownershipType === "CUSTOMER") {
    if (state.customerMode === "EXISTING" && !state.selectedCustomerId)
      return "Válassz ügyfelet, vagy válts az új ügyfél felvitelére.";
    if (state.customerMode === "NEW")
      return newCustomerDraftError(state.newCustomer);
  }
  return null;
}
