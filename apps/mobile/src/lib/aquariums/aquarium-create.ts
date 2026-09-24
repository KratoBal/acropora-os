/**
 * Az AKVÁRIUM FELVITEL űrlap logikája, a képernyőtől külön -- ugyanazért az
 * okért, mint az `asset-create.ts` fejlécében: az appban nincs komponens-
 * teszt eszköz, tehát ami a képernyő törzsében marad, azt csak kézzel,
 * telefonon lehet kipróbálni. A döntések (liter-számolás, kötelező mezők)
 * ide kerülnek, spec-cel.
 *
 * A TELEFONOS KÖR SZŰKÍTETT A WEBHEZ KÉPEST: nincs meglévő ügyfél keresése,
 * csak helyben felvitel -- Balázs szó szerinti kérése (msg 22949) "az ugyfel
 * helyben felvetele (nev, cim, telefon, e-mail)"-t nevez meg, nem keresést.
 * A szerver `POST /aquariums` mindkét utat elfogadja (`customerId` VAGY
 * `newCustomer`), tehát ez a szűkítés a telefon oldalán van, nem a szerverén
 * -- egy keresés-képernyő később ide, ebbe a modulba kerülhet.
 *
 * A TÍPUSOK SAJÁT, SZERKEZETI MÁSOLATOK, NEM `../api/aquariums`-ból jönnek.
 * A teszt-fordító nem ismeri a `@/` aliast (lásd `tsconfig.test.json`
 * fejlécét), és egy relatív import is bevonná `client.ts`-t, azon
 * keresztül pedig az Expo futtatókörnyezetet -- ugyanaz a csapda, amit az
 * `asset-create.ts` `AssetKind`/`AssetOwnerType` párja is elkerül. Az API
 * kliens objektumai SZERKEZETILEG illeszkednek ezekre, importálás nélkül.
 */

export type AquariumOwnershipType = "OWN" | "CUSTOMER";
export type WaterBodyType = "AKVARIUM" | "TO";

export type AquariumEquipmentKind =
  | "VILAGITAS"
  | "ARAMOLTATAS"
  | "LEHABZO"
  | "FELNYOMO"
  | "BIO_SZURES"
  | "MEDIA_REAKTOR"
  | "NYOMELEM_ADAGOLO"
  | "FUTES"
  | "HUTES"
  | "EGYEB";

export interface NewAquariumCustomerInput {
  type: "PERSON";
  displayName: string;
  email?: string;
  phone?: string;
  addresses?: {
    type: "OTHER";
    postalCode: string;
    city: string;
    line1: string;
  }[];
}

export interface CreateAquariumEquipmentInput {
  kind: AquariumEquipmentKind;
  manufacturer?: string;
  model?: string;
  quantity?: number;
  channelCount?: number;
  notes?: string;
}

export interface CreateAquariumInput {
  ownershipType: AquariumOwnershipType;
  customerId?: string;
  newCustomer?: NewAquariumCustomerInput;
  name: string;
  waterBodyType?: WaterBodyType;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  systemVolumeLiters?: number;
  systemVolumeIsManual?: boolean;
  equipment?: CreateAquariumEquipmentInput[];
}

export interface AquariumCreateForm {
  ownershipType: AquariumOwnershipType;

  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerPostalCode: string;
  customerCity: string;
  customerAddressLine1: string;

  name: string;
  waterBodyType: WaterBodyType;

  lengthCm: string;
  widthCm: string;
  heightCm: string;
  /** A liter mező szövege -- kézzel írva vagy a méretekből számolva
   * megjelenítve, ugyanaz a mező. */
  volumeLiters: string;
  /** A KÉPERNYŐ jelzi: EBBEN a mentésben a felhasználó írta-e át a liter
   * mezőt kézzel. Lásd `resolveAquariumVolume` a szerveren -- ugyanaz a
   * döntési alak, plain számmal, Decimal nélkül. */
  volumeManuallyEdited: boolean;

  equipment: AquariumEquipmentForm[];
}

export interface AquariumEquipmentForm {
  kind: AquariumEquipmentKind;
  manufacturer: string;
  model: string;
  /** Szövegként, hogy üres is lehessen -- normalizáláskor lesz belőle 1. */
  quantity: string;
  channelCount: string;
  notes: string;
}

export function emptyAquariumEquipmentForm(): AquariumEquipmentForm {
  return {
    kind: "VILAGITAS",
    manufacturer: "",
    model: "",
    quantity: "",
    channelCount: "",
    notes: "",
  };
}

export function emptyAquariumCreateForm(): AquariumCreateForm {
  return {
    ownershipType: "OWN",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerPostalCode: "",
    customerCity: "",
    customerAddressLine1: "",
    name: "",
    waterBodyType: "AKVARIUM",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    volumeLiters: "",
    volumeManuallyEdited: false,
    equipment: [],
  };
}

/** A bemenet: legfeljebb 6 egész és 2 tizedes jegy, előjel nélkül -- elég egy
 * méret vagy egy liter-érték kézi beírásához, tizedesvesszővel is. */
const DECIMAL_PATTERN = /^\d{1,6}(?:[.,]\d{1,2})?$/;

/** Ugyanaz az alak, mint `normalizePerformanceValue` (lásd
 * `lib/assets/performance-mirror.ts`): vessző pont, felesleges nulla le. Itt
 * KÜLÖN másolat, mert az akvárium méretei nem teljesítmény-értékek, és a két
 * mezőcsoport szándéka külön okból egyezhet meg vagy térhet el egymástól. */
export function normalizeDecimalText(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  return Number(trimmed);
}

export interface AquariumVolumeResult {
  systemVolumeLiters: number | null;
  systemVolumeIsManual: boolean;
}

/**
 * A LITER SZÁMOLÁSA -- VAGY A KÉZI ÉRTÉK MEGŐRZÉSE.
 *
 * Ugyanaz a döntési alak, mint a szerver `resolveAquariumVolume`-ja (lásd
 * `apps/api/src/aquariums/aquarium-volume.ts`), plain `number`-rel: a
 * telefon nem küld Decimal-t, a végső kerekítést a szerver végzi.
 *
 * A DÖNTÉS EGYETLEN JELZŐN MÚLIK (`isManual`), NEM A KORÁBBI ÁLLAPOTON --
 * ez a telefonon KRITIKUSABB, mint a weben: a képernyő nem tartja a szerver
 * korábbi rekordját, csak az űrlap saját state-jét, tehát a jelző az
 * EGYETLEN forrás arra, hogy a liter mezőt a felhasználó írta-e át.
 */
export function resolveAquariumVolume(input: {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  volumeLiters: number | null;
  isManual: boolean;
}): AquariumVolumeResult {
  if (
    !input.isManual &&
    input.lengthCm != null &&
    input.widthCm != null &&
    input.heightCm != null
  ) {
    const raw = (input.lengthCm * input.widthCm * input.heightCm) / 1000;
    /*
      3 TIZEDESRE KEREKÍTVE, a szerver `systemVolumeLiters` oszlopának
      `Decimal(12, 3)` skálájához igazítva (packages/database/prisma/
      schema.prisma). Enélkül a méretekből számolt javaslat lebegőpontos
      zajjal jelenhetne meg a mentés előtt (pl. 10 × 10,5 × 10,5 cm esetén a
      nyers osztás 1.1025-öt ad, ami FELFELÉ kerekítve 1.103 -- egy csonkítás
      vagy kerekítés nélküli kiírás 1.1024999999999998 alakban is
      megjelenhetne a lebegőpontos ábrázolás miatt). A MENTETT érték emiatt
      nem lenne hibás (a Decimal oszlop úgyis levágná), csak a képernyőn
      látott javaslat volna zajos.
    */
    const liters = Math.round(raw * 1000) / 1000;
    return { systemVolumeLiters: liters, systemVolumeIsManual: false };
  }
  return {
    systemVolumeLiters: input.volumeLiters,
    systemVolumeIsManual: input.isManual,
  };
}

/**
 * A NYOMELEM-ADAGOLÓ CSATORNASZÁMA KÖTELEZŐ, MINDEN MÁS FAJTÁNÁL ÉRTELMETLEN.
 *
 * Betű szerint ugyanaz a szabály, mint a szerver `aquariumEquipmentProblem`-je
 * (lásd `apps/api/src/aquariums/aquarium-validation.ts`) -- másolva, mert a
 * telefon nem importálhatja az API forrását.
 */
export type AquariumEquipmentProblem =
  "CHANNEL_COUNT_REQUIRED" | "CHANNEL_COUNT_NOT_ALLOWED";

export function aquariumEquipmentProblem(input: {
  kind: AquariumEquipmentKind;
  channelCount: number | null;
}): AquariumEquipmentProblem | null {
  const needsChannelCount = input.kind === "NYOMELEM_ADAGOLO";
  if (needsChannelCount && input.channelCount == null)
    return "CHANNEL_COUNT_REQUIRED";
  if (!needsChannelCount && input.channelCount != null)
    return "CHANNEL_COUNT_NOT_ALLOWED";
  return null;
}

export type AquariumCreateField =
  | "name"
  | "customerName"
  | "customerAddress"
  | "lengthCm"
  | "widthCm"
  | "heightCm"
  | "volumeLiters"
  | `equipment.${number}.channelCount`;

export type AquariumCreateResult =
  | { ok: true; payload: CreateAquariumInput }
  | { ok: false; field: AquariumCreateField; message: string };

/**
 * A TELJES ŰRLAP EGY SZERVER-KÉSZ TÖRZZSÉ -- VAGY EGY MEGNEVEZETT HIBA.
 *
 * Nincs olyan ág, ami némán tér vissza: minden elutasítás megnevezi a mezőt
 * és ad egy magyar mondatot, ugyanúgy, ahogy az `asset-create.ts`
 * `buildAssetCreatePayload`-ja teszi.
 */
export function buildAquariumCreatePayload(
  form: AquariumCreateForm,
): AquariumCreateResult {
  const name = form.name.trim();
  if (!name)
    return { ok: false, field: "name", message: "Az akvárium neve kötelező." };

  let newCustomer: NewAquariumCustomerInput | undefined;
  if (form.ownershipType === "CUSTOMER") {
    const customerName = form.customerName.trim();
    if (!customerName)
      return {
        ok: false,
        field: "customerName",
        message: "Ügyfél tulajdonnál az ügyfél neve kötelező.",
      };

    const postalCode = form.customerPostalCode.trim();
    const city = form.customerCity.trim();
    const line1 = form.customerAddressLine1.trim();
    const anyAddressPart = postalCode !== "" || city !== "" || line1 !== "";
    if (anyAddressPart && (!postalCode || !city || !line1))
      return {
        ok: false,
        field: "customerAddress",
        message:
          "Ha a címet elkezdted, az irányítószám, a város és az utca is kötelező.",
      };

    newCustomer = {
      type: "PERSON",
      displayName: customerName,
      email: form.customerEmail.trim() || undefined,
      phone: form.customerPhone.trim() || undefined,
      addresses: anyAddressPart
        ? [{ type: "OTHER", postalCode, city, line1 }]
        : undefined,
    };
  }

  const lengthCm = normalizeDecimalText(form.lengthCm);
  if (form.lengthCm.trim() !== "" && lengthCm === null)
    return {
      ok: false,
      field: "lengthCm",
      message: "A hossz csak szám lehet.",
    };
  const widthCm = normalizeDecimalText(form.widthCm);
  if (form.widthCm.trim() !== "" && widthCm === null)
    return {
      ok: false,
      field: "widthCm",
      message: "A szélesség csak szám lehet.",
    };
  const heightCm = normalizeDecimalText(form.heightCm);
  if (form.heightCm.trim() !== "" && heightCm === null)
    return {
      ok: false,
      field: "heightCm",
      message: "A magasság csak szám lehet.",
    };
  const volumeLiters = normalizeDecimalText(form.volumeLiters);
  if (form.volumeLiters.trim() !== "" && volumeLiters === null)
    return {
      ok: false,
      field: "volumeLiters",
      message: "A liter csak szám lehet.",
    };

  const volume = resolveAquariumVolume({
    lengthCm,
    widthCm,
    heightCm,
    volumeLiters,
    isManual: form.volumeManuallyEdited,
  });

  const equipment: CreateAquariumEquipmentInput[] = [];
  for (const [index, row] of form.equipment.entries()) {
    const channelCount = normalizeDecimalText(row.channelCount);
    if (row.channelCount.trim() !== "" && channelCount === null)
      return {
        ok: false,
        field: `equipment.${index}.channelCount`,
        message: "A csatornaszám csak szám lehet.",
      };
    const problem = aquariumEquipmentProblem({ kind: row.kind, channelCount });
    if (problem === "CHANNEL_COUNT_REQUIRED")
      return {
        ok: false,
        field: `equipment.${index}.channelCount`,
        message: "A nyomelem-adagoló csatornaszáma kötelező.",
      };
    if (problem === "CHANNEL_COUNT_NOT_ALLOWED")
      return {
        ok: false,
        field: `equipment.${index}.channelCount`,
        message: "Csatornaszám csak a nyomelem-adagolónál adható meg.",
      };

    equipment.push({
      kind: row.kind,
      manufacturer: row.manufacturer.trim() || undefined,
      model: row.model.trim() || undefined,
      quantity: normalizeDecimalText(row.quantity) ?? undefined,
      channelCount: channelCount ?? undefined,
      notes: row.notes.trim() || undefined,
    });
  }

  return {
    ok: true,
    payload: {
      ownershipType: form.ownershipType,
      newCustomer,
      name,
      waterBodyType: form.waterBodyType,
      lengthCm: lengthCm ?? undefined,
      widthCm: widthCm ?? undefined,
      heightCm: heightCm ?? undefined,
      systemVolumeLiters: volume.systemVolumeLiters ?? undefined,
      systemVolumeIsManual: volume.systemVolumeIsManual,
      equipment,
    },
  };
}
