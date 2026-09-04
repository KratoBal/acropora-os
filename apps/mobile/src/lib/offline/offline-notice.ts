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

/**
 * A SZERKESZTŐ KÉPERNYŐ FÖLÖTTI SÁV, ha a lap a mentett másolatból áll.
 *
 * === MIÉRT KÜLÖN FÜGGVÉNY, ÉS MIÉRT NEM ELÉG AZ ADATLAPÉ ===
 *
 * Az adatlapnál a régi másolat annyit jelent, hogy „ami azóta változott, azt
 * nem látod". A szerkesztésnél ez KEVÉS: aki ír, azt akarja tudni, hogy amit
 * beír, FELÜLÍR-E valamit.
 *
 * És a válasz 2026-09-04 óta MÁS, mint korábban lett volna. A mentett
 * másolatból indított szerkesztés elavult alapállapotról indul -- ez délelőtt
 * még azt jelentette volna, hogy a mentés sor-szintű ütközésbe fut és a
 * szerelő munkája bent ragad. Ma a lánc kezeli: a szerver MEZŐNKÉNT ütköztet
 * (#541), a sor viszi a szerkesztést (#547), és az elakadt módosításnál a
 * szerelő mezőnként eldönti, melyik érték maradjon (#554).
 *
 * A sáv ezért nem ijeszt, hanem MEGMONDJA A KÖVETKEZMÉNYT: ha közben más is
 * hozzányúlt ugyanahhoz a mezőhöz, azt nem írja felül csendben -- kérdezni fog.
 *
 * === AMIT VISZONT KI KELL MONDANI, MERT NEM LÁTSZIK ===
 *
 * A másolat KORA. Egy elavult érték, amiről a szerelő nem tudja, hogy elavult,
 * rosszabb, mint egy üres képernyő: az üresnél tudja, hogy nincs adata.
 */
export function describeOfflineEditNotice(input: {
  online: boolean;
  syncedAt: string | null;
  now: Date;
}): OfflineNotice | null {
  if (input.online) return null;

  return {
    tone: "offline",
    title: "Nincs kapcsolat: mentett másolatot szerkesztesz",
    message:
      `Ez a lap ${describeCacheAge(input.syncedAt, input.now)} mentett másolat, ` +
      "tehát régebbi értékeket látsz. A javításod a telefonon vár, és ha " +
      "közben más is átírta ugyanazt a mezőt, nem írjuk felül csendben: " +
      "megkérdezzük, melyik érték maradjon.",
  };
}

/**
 * A MUNKALAP FÖLÖTTI SÁV, ha az adatlap a mentett másolatból áll.
 *
 * === MIÉRT KÜLÖN FÜGGVÉNY, ÉS MIÉRT NEM ELÉG AZ ESZKÖZÉ ===
 *
 * Az eszköz adatlapjánál a régi másolat annyit jelent, hogy „ami azóta
 * változott, azt nem látod". A munkalapnál van egy adat, ami ENNÉL TÖBBET
 * ronthat: az ÁLLAPOT. Ha az iroda időközben LEZÁRTA a lapot, a másolatban az
 * még piszkozatnak látszik -- a szerelő tehát azt hiszi, nyitott lapra
 * dolgozik, és amit ráír, később elakad.
 *
 * Egy elavult gyorsítótár itt ROSSZABB a hiányánál, és ezért mondja ki a sáv
 * külön, nem csak a korát.
 *
 * === EGYETLEN ÁLLAPOT VÉGLEGES, ÉS EZ MÉRVE VAN ===
 *
 * Az `ALÁÍRT` lap nem mozdul többé: a szerver `amendRefusal` függvénye a
 * `SIGNED` állapotra elutasítást ad, a munka folytatása pedig ÚJ lap. Minden
 * más állapot MOZOGHAT alatta: a piszkozatot lezárhatják, az aláírásra várót
 * aláírhatják vagy elutasíthatják, az elutasítottat pedig átírhatják.
 *
 * Ezért a sáv KÉT mondatot ad, nem egyet: aláírt lapnál a kor a kérdés, minden
 * másnál az állapot.
 */
export function describeCachedWorksheetNotice(input: {
  online: boolean;
  syncedAt: string | null;
  /** A MENTETT állapot -- épp az, amiről nem tudjuk, igaz-e még. */
  status: string;
  now: Date;
}): OfflineNotice | null {
  if (input.online) return null;

  const age = describeCacheAge(input.syncedAt, input.now);

  if (input.status === "SIGNED")
    return {
      tone: "offline",
      title: "Nincs kapcsolat: mentett munkalap",
      message: `Ez a lap ${age} mentett másolat. Alá van írva, tehát az állapota nem változhatott -- de ami azóta a lapra került, azt itt nem látod.`,
    };

  return {
    tone: "stale",
    title: "Nincs kapcsolat: az állapot elavulhatott",
    message: `Ez a lap ${age} mentett másolat, és azóta az iroda LEZÁRHATTA. Itt még nyitottnak látszik: amit ráírsz, a feltöltéskor elakadhat. A begépelt szöveg olyankor nem vész el, a sorban marad.`,
  };
}

/**
 * A HELYSZÍN-VÁLASZTÓ FÖLÖTTI SÁV, ha a lista a mentett másolatból áll.
 *
 * === MIÉRT KÜLÖN MONDAT, ÉS MIÉRT NEM ELÉG A KÉT MEGLÉVŐ ===
 *
 * A másik két sáv OLVASÁSRÓL szól: azt mondja ki, hogy amit látsz, az régi. Itt
 * a másolatból ÍRÁS lesz -- a szerelő ebből a listából választ, és a választás
 * felkerül egy munkalapra. A kockázat is más: egy időközben TÖRÖLT helyszín a
 * másolatban még ott áll, és a lap küldése a szerveren bukna el, jóval később,
 * a pincéből nézve megmagyarázhatatlanul.
 *
 * `null`, ha van kapcsolat: olyankor a friss lista jön, és egy sáv csak elvenné
 * a helyet.
 */
export function describeCachedDepartmentsNotice(input: {
  online: boolean;
  count: number;
  syncedAt: string | null;
  now: Date;
}): OfflineNotice | null {
  if (input.online) return null;

  if (input.count === 0)
    return {
      tone: "stale",
      title: "Nincs kapcsolat: nincs mentett helyszín",
      message:
        "Ehhez a partnerhez nincs mentett helyszín a telefonon, és a helyszín kötelező. A lapot térerőnél tudod megnyitni, vagy nyisd meg egyszer a partnert, amíg van hálózat.",
    };

  const age = describeCacheAge(input.syncedAt, input.now);
  return {
    tone: "offline",
    title: "Nincs kapcsolat: mentett helyszínek",
    message: `${input.count} helyszín a telefonról, ${age} mentve. Ami azóta változott vagy megszűnt, azt itt nem látod.`,
  };
}
