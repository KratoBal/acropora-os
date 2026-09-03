import { useEffect, useState } from "react";

import { describeQueueBacklog, describeRepeatedFailures } from "./queue-drain";
import { queueCounts, repeatedFailures } from "./queue-store";

/**
 * MI VAR MEG A TELEFONON -- A FUTASTOL FUGGETLENUL.
 *
 * === MIERT KELL, HOLOTT MAR VAN EGY UZENET A KIURITESROL ===
 *
 * A `useQueueDrain` egy FUTASROL szol: mi ment fel MOST. Az a mondat eltunik,
 * a hatralek pedig marad -- es epp az a veszelyes allapot, amikor nincs mit
 * futtatni (nincs halozat), tehat NINCS is futas, amirol beszelni lehetne.
 *
 * A dontesek, a szamlalo es az osszerako mind megvoltak (`queueCounts`,
 * `describeQueueState`, `describePhotoBacklog`), es EGYIKET SEM hivta senki:
 * a szamok ott alltak az adatbazisban, es a kollega semmit nem latott beloluk.
 *
 * === MIERT UJRAOLVAS A `frissites` VALTOZASAKOR ===
 *
 * A kiurites utan a szamok MASOK. A hivo a kiurites uzenetet adja at
 * fuggosegkent, tehat a hatralek a futas utan azonnal ujraszamolodik -- egy
 * elavult "3 fenykep var" mondat pontosan azt a bizalmat vinne el, amiert ez
 * a sav keszult.
 */
export function useQueueBacklog(frissites: unknown): string | null {
  const [uzenet, setUzenet] = useState<string | null>(null);

  useEffect(() => {
    let ervenyes = true;
    void (async () => {
      try {
        const counts = await queueCounts();
        /**
         * KET KULON MONDAT, MERT KET KULON DOLOG.
         *
         * A hatralek azt mondja meg, MENNYI var; az ismetlodo hiba azt, hogy
         * valamelyik nem csak var, hanem mar tobbszor elbukott. A masodik
         * eddig SEHOL nem latszott: az `attempt_count` es a `last_error` irott,
         * de olvasatlan adat volt.
         */
        const ismetlodo = await repeatedFailures();
        const mondatok = [
          describeQueueBacklog(counts),
          describeRepeatedFailures(ismetlodo),
        ].filter((m): m is string => m !== null);
        if (ervenyes)
          setUzenet(mondatok.length > 0 ? mondatok.join(" ") : null);
      } catch {
        /**
         * A SZAMLALAS HIBAJAT ELNYELJUK, es ez itt SZANDEKOS: ez a sav egy
         * TAJEKOZTATO a mar meglevo adatrol. Ha az olvasas elhasal, a
         * kepernyo tobbi resze mukodjon tovabb -- a felvitel maga nem ezen a
         * hivason all, es egy piros sav a kezdolapon semmit nem oldana meg.
         */
        if (ervenyes) setUzenet(null);
      }
    })();
    return () => {
      ervenyes = false;
    };
  }, [frissites]);

  return uzenet;
}
