import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { decidePushNavigation } from "./push-target";

/**
 * AZ ERTESITESRE ADOTT KOPPINTAS MEGNYITJA A MUNKALAPOT.
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
     * A TIPUS VALASZT UTVONALAT, ES EZ MA EGY ELAGAZAS EGY AGGAL.
     *
     * Balazs kerese (2026-09-03 20:20): hibajegy-keperno ma nincs a
     * telefonon, tehat oda nem lehet vinni senkit -- de az alak legyen olyan,
     * hogy a masodik tipus ne kivanjon atirast. A `switch` egy aggal
     * ertelmetlennek latszik; a `PushTargetType` viszont zart halmaz, tehat a
     * fordito MEG FOGJA MONDANI, ha egy uj tipus bekerul es ez a hely nem
     * kezeli. Egy `if` ezt a jelzest nem adna meg.
     */
    switch (decision.target.type) {
      case "worksheet":
        router.push({
          pathname: "/worksheets/[id]",
          params: { id: decision.target.id },
        });
        return;
    }
  }, [response, status]);
}
