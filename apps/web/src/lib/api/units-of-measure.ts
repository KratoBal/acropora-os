import type {
  UnitOfMeasure,
  UnitOfMeasureKind,
  UnitOfMeasureListResponse,
} from "@acropora/types";

import { apiRequest } from "./client";

/**
 * A MÉRTÉKEGYSÉG-TÖRZSADAT KLIENSE.
 *
 * AZ ÚT `units-of-measure`, NEM `units`: ebben a rendszerben a "unit" szó a
 * SZERVEZETI EGYSÉGET (helyszínt) jelenti -- az `Asset.unitId` az, és a felület
 * `UnitPicker`-rel választja.
 *
 * A FAJTA MINDEN HÍVÁSBAN KÖTELEZŐ, és ez nem kényelmetlenség: fajta nélkül a
 * három világ egyvelege jönne vissza, és a HÍVÓ felületén dőlne el, mit mutat
 * belőle. Pontosan az a szétcsúszás, amit a `kind` oszlop megszüntet.
 */
export const unitsOfMeasureApi = {
  /**
   * A VÁLASZTÓ LISTÁJA. Alapból csak az AKTÍV egységek jönnek.
   *
   * Az `includeInactive` a Beállítások szerkesztőjének kell: a kivezetett
   * egység nem tűnik el, csak a választóból esik ki. Ha a karbantartó nem látná,
   * azt hinné, törlődött -- és újra felvinné ugyanazt.
   */
  list(
    token: string,
    kind: UnitOfMeasureKind,
    options: { includeInactive?: boolean; signal?: AbortSignal } = {},
  ) {
    const query = new URLSearchParams({ kind });
    // A `false` KIIRASA IS SZAMIT-E: nem, mert a mezo elhagyasa ugyanazt
    // jelenti. A szerver oldalan viszont a `false` SZOVEG is hamisat jelent --
    // ez egy javitott csapda, nem alapertelmezes (`query-boolean.util.ts`).
    if (options.includeInactive) query.set("includeInactive", "true");
    return apiRequest<UnitOfMeasureListResponse>(
      `/units-of-measure?${query.toString()}`,
      token,
      { signal: options.signal },
    );
  },

  create(
    token: string,
    input: {
      code: string;
      name: string;
      kind: UnitOfMeasureKind;
      sortOrder?: number;
    },
  ) {
    return apiRequest<UnitOfMeasure>("/units-of-measure", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /**
   * A FAJTA NEM SZEREPEL, ÉS EZ SZÁNDÉKOS: a szerver sem engedi átírni. Egy már
   * használt egység fajtájának cseréje CSENDBEN vinne át sorokat egyik világból
   * a másikba -- az eszközön álló `W` hirtelen mennyiség lenne.
   */
  update(
    token: string,
    id: string,
    input: {
      code?: string;
      name?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return apiRequest<UnitOfMeasure>(`/units-of-measure/${id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /**
   * A TÖRLÉS CSAK A SOHA NEM HASZNÁLT EGYSÉGRE MEGY ÁT.
   *
   * Amire eszköz hivatkozik, azt az adatbázis utasítja el (409): a törlés
   * némán ürítené ki az eszközök mezőit. A kivezetés (`isActive = false`) az
   * az út, ami a múltat békén hagyja.
   *
   * A TÍPUS `{ ok: true }`, NEM `void` -- barracuda mérése, 2026-09-25: a
   * szerver (`units.service.ts` `remove()`) ténylegesen `{ ok: true } as
   * const`-ot ad vissza, nem üres törzset. Ez a hívás emiatt SOSEM
   * szenvedett az `apiRequest` üres-törzs hibájától (lásd `client.ts`), de
   * a korábbi `void` típus hazudott -- itt csak a deklaráció pontosítva,
   * a hívó (`units-of-measure-page.tsx`) a visszatérést amúgy sem olvassa.
   */
  remove(token: string, id: string) {
    return apiRequest<{ ok: true }>(`/units-of-measure/${id}`, token, {
      method: "DELETE",
    });
  },
};
