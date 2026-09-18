import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { decidePushNavigation, PUSH_TARGET_ROUTES } from "./push-target";

/**
 * AZ ERTESITESRE ADOTT KOPPINTAS MEGNYITJA A MUNKALAPOT VAGY A HIBAJEGYET.
 *
 * A DONTES a `push-target.ts`-ben all, mert ott MERHETO; ez a horog csak a
 * natv modul es a navigacio koze all, ugyanolyan vekonyan, ahogy a
 * `push-device.ts` all az engedelykeres es a dontes koze.
 *
 * === MIERT `useLastNotificationResponse`, ES NEM FIGYELO ===
 *
 * Ha az appot MAGA A KOPPINTAS inditja el (a telefon a zsebben van, a kollega a
 * zarolt kepernyorol koppint -- ez a leggyakoribb valos eset), egy figyelo
 * LEKESI az esemenyt: mire felall, az mar megtortent. Ez a horog a legutolso
 * valaszt is visszaadja, tehat a hideg inditas ugyanugy hat.
 *
 * Amit cserebe hoz, es amire a dontes-modul fel van keszitve: ugyanazt az
 * objektumot adja vissza MINDEN renderelesnel, amig ujabb nem jon.
 */
export function usePushNavigation(status: string): void {
  const handled = useRef<string | null>(null);

  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const decision = decidePushNavigation({
      response,
      status,
      handledKey: handled.current,
    });
    if (!decision.navigate) return;

    /**
     * A FELJEGYZES A NAVIGACIO ELE KERUL, es ez nem izles: a `push` maga is
     * renderelest valt ki, es ha a jeloles utana allna, a kozbeni render meg a
     * regi (ures) jelolest latna, es masodszor is navigalna.
     */
    handled.current = decision.key;
    /**
     * A TIPUS VALASZT UTVONALAT, ES A VALASZTAS A `push-target.ts` TABLAJABAN
     * ALL -- NEM ITT.
     *
     * KORABBAN ITT EGY `switch` ALLT, es a kommentje azt allitotta, hogy a
     * fordito szol, ha egy uj tipus bekerul es ez a hely nem kezeli. Merve
     * 2026-09-18: NEM SZOL. Felvettem a masodik tipust, a `switch`-hez nem
     * nyultam, es a `typecheck` zolden futott le -- egy default ag nelkuli
     * `switch` `void` torzsben nem kimerito-ellenorzes, csak annak latszik.
     *
     * A tabla `satisfies Record<PushTargetType, string>` alakban all, tehat az
     * elmaradt utvonal MOST MAR forditasi hiba. A csere lenyege nem a
     * rovidseg, hanem hogy az igeret es a mechanizmus ugyanaz legyen.
     */
    router.push({
      pathname: PUSH_TARGET_ROUTES[decision.target.type],
      params: { id: decision.target.id },
    });
  }, [response, status]);
}
