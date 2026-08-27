/**
 * MIT MONDUNK A SZERELŐNEK, AMIKOR NINCS TÉRERŐ.
 *
 * A helyszíni eszközkatalógus a készüléken tárolt másolatból is működik, és
 * pont ezért veszélyes: egy lista, ami ugyanúgy néz ki, mint online, azt
 * állítja, hogy a szerver mai állapotát mutatja. Ha ezt nem mondjuk ki, a
 * szerelő egy tegnapi adat alapján dönt, és nem tudja, hogy döntött.
 *
 * A SZABÁLY: a mentett másolat SOHA nem néma. Ha a képernyő nem a szerverről
 * jött, azt ki kell írni, az utolsó frissítés idejével együtt -- abból a
 * szerelő maga tudja eldönteni, elég friss-e ahhoz, amit épp csinál.
 *
 * Külön, tiszta modul, mert az appban nincs komponens-teszt eszköz, és mert
 * az IDŐ itt bemenet, nem mellékhatás: a `now` paraméterként érkezik, hogy a
 * korhatárok mérhetők legyenek. Egy `Date.now()` a törzsben ugyanezt a
 * logikát tesztelhetetlenné tenné.
 */

export type OfflineTone = "offline" | "stale" | "empty";

export interface OfflineNotice {
  tone: OfflineTone;
  title: string;
  message: string;
}

export interface OfflineNoticeInput {
  /** Elérhető-e a hálózat a készülék szerint. */
  online: boolean;
  /** Mikor mentettük a másolatot, ISO alakban. `null`, ha soha. */
  syncedAt: string | null;
  /** Hány sor van a mentett másolatban. */
  itemCount: number;
  /** A mérés pillanata. Paraméter, nem `Date.now()`: lásd a fenti indoklást. */
  now: Date;
}

/** Egy nap fölött a másolat kora már nem részlet, hanem figyelmeztetés. */
export const STALE_AFTER_HOURS = 24;

const HOUR_IN_MS = 60 * 60 * 1000;

/**
 * MIÓTA ÁLL A MÁSOLAT, emberi alakban.
 *
 * Nem abszolút időpontot ad, hanem eltelt időt: a helyszínen az számít, hogy
 * „ma reggel" vagy „négy napja", nem az, hogy 09:12. Az abszolút időpont
 * ráadásul időzóna-kérdést nyitna a készüléken, az eltelt idő nem.
 */
export function describeCacheAge(syncedAt: string | null, now: Date): string {
  if (!syncedAt) return "még soha";
  const saved = new Date(syncedAt).getTime();
  if (!Number.isFinite(saved)) return "ismeretlen ideje";

  const elapsedHours = (now.getTime() - saved) / HOUR_IN_MS;
  // A jövőbeli bélyeg (elállított készülékóra) NEM hiba, csak nem tudunk vele
  // mit kezdeni: „az imént" a legkevesebbet állító válasz.
  if (elapsedHours < 1) return "az imént";
  if (elapsedHours < 24) return `${Math.floor(elapsedHours)} órája`;
  return `${Math.floor(elapsedHours / 24)} napja`;
}

export function isCacheStale(
  syncedAt: string | null,
  now: Date,
  staleAfterHours = STALE_AFTER_HOURS,
): boolean {
  if (!syncedAt) return true;
  const saved = new Date(syncedAt).getTime();
  if (!Number.isFinite(saved)) return true;
  return now.getTime() - saved >= staleAfterHours * HOUR_IN_MS;
}

/**
 * A LISTA FÖLÖTTI SÁV. `null`, ha nincs mit mondani: online, friss adat mellett
 * egy sáv csak elvinné a helyet a képernyőről.
 */
export function describeOfflineNotice(
  input: OfflineNoticeInput,
): OfflineNotice | null {
  const { online, syncedAt, itemCount, now } = input;

  if (!online && itemCount === 0)
    return {
      tone: "empty",
      title: "Nincs kapcsolat, és nincs mentett másolat",
      message:
        "Ezen a készüléken még nem volt letöltve az eszközlista. Térerőnél nyisd meg egyszer, és onnantól offline is megvan.",
    };

  if (!online)
    return {
      tone: "offline",
      title: "Nincs kapcsolat: mentett másolatot látsz",
      message: `Az adatok ${describeCacheAge(syncedAt, now)} frissültek. Ami azóta változott a szerveren, azt itt nem látod.`,
    };

  // Online, de a másolat régi: ilyenkor a képernyő a szerverről frissül, tehát
  // a sáv nem az adatról szól, hanem arról, hogy a készülék készen áll-e a
  // következő térerő nélküli munkára.
  if (isCacheStale(syncedAt, now))
    return {
      tone: "stale",
      title: "A készülékre mentett másolat régi",
      message: `A helyszíni másolat ${describeCacheAge(syncedAt, now)} frissült. Amíg van térerő, görgesd végig a listát, hogy offline is naprakész legyen.`,
    };

  return null;
}

/**
 * AZ ADATLAP FÖLÖTTI SÁV, ha a lap a mentett másolatból áll össze.
 *
 * KÉT KÜLÖNBÖZŐ MÁSOLAT VAN, és ez nem részletkérdés. A teljes adatlapot csak
 * arról az eszközről ismerjük, amit valaki már megnyitott térerővel; a
 * többiről annyit tudunk, amennyi a LISTÁN átjött. Egy listából összerakott
 * adatlap tehát HIÁNYOS -- és mivel a hiányzó mezők a repó szabálya szerint
 * nem üres sorként, hanem sehogy nem jelennek meg, a hiányukról semmi nem
 * szólna. Ezt mondja ki ez a sáv.
 */
export function describeOfflineDetailNotice(input: {
  online: boolean;
  hasFullCopy: boolean;
  syncedAt: string | null;
  now: Date;
}): OfflineNotice | null {
  if (input.online) return null;

  const age = describeCacheAge(input.syncedAt, input.now);
  if (input.hasFullCopy)
    return {
      tone: "offline",
      title: "Nincs kapcsolat: mentett adatlap",
      message: `Ez a lap ${age} mentett másolat. Ami azóta változott, azt itt nem látod.`,
    };

  return {
    tone: "stale",
    title: "Nincs kapcsolat: hiányos adatlap",
    message: `Ezt az eszközt csak a listáról ismerjük (${age} mentve). A leírás, a beszerelés dátuma és a garancia csak térerővel látszik -- most nem azért nem szerepel, mert nincs kitöltve.`,
  };
}
