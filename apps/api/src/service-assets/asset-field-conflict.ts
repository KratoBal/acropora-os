/**
 * MEZO-SZINTU UTKOZES AZ ESZKOZ MODOSITASANAL.
 *
 * === MI VOLT EDDIG, ES MIERT NEM ELEG ===
 *
 * A modositas a SOR idobelyegevel vedett (`updateMany where updatedAt`):
 * barmelyik mezo barmilyen valtozasa ervenytelenitett MINDEN parhuzamos
 * modositast. Ket ember, aki KET KULON mezot ir at, ugyanugy utkozott, mint aki
 * ugyanazt.
 *
 * Amig a modositas csak a webrol ment, ez elviselheto volt: aki elakadt,
 * frissitett es ujra beirta. AZ OFFLINE UTON NEM AZ: a szerelo mar nincs a
 * helyszinen, es a pinceben felvitt adat annal a pillanatnal es annal a helynel
 * volt -- utolag nem all elo. Az elveszett munka ott nem "ujra megcsinalhato",
 * hanem visszaallithatatlan (acrobot dontese, 2026-09-04).
 *
 * === MIBOL DOL EL, ES MIERT NEM KELL UJ TAROLAS ===
 *
 * Az `AssetEvent` naplo mar ma rogziti, MELYIK mezok valtoztak es MIKOR. A
 * kerdes tehat feltetheto a meglevo adatra: az `expectedUpdatedAt` ota nyult-e
 * valaki EZEKHEZ a mezokhoz.
 *
 * === ES A NAPLO ELOSZOR HAZUDOTT ERROL ===
 *
 * Merve 2026-09-04: az `UPDATED` esemeny a BEKULDOTT kulcsokat rogzitette
 * (`Object.keys(input)`), nem a TENYLEGESEN valtozottakat. A webes urlap a
 * TELJES rekordot kuldi, tehat minden mentes azt naplozta, hogy MINDEN altalanos
 * mezo valtozott -- vagyis a mezo-szintu ellenorzes epp olyan durva lett volna,
 * mint a sor-szintu, csak dragabban.
 *
 * Ezert a naplo irasa is javult ugyanebben a szeletben: mostantol a ValTOZOTT
 * mezok kerulnek bele. Ez nem mellekhatas, hanem ELOFELTETEL -- es egyben egy
 * regi pontatlansag javitasa: egy esemeny, ami azt allitja, hogy egy mezo
 * "modosult", holott nem, hamis nyom.
 */

/** Amit egy esemenybol ez a modul olvas. */
export interface AssetEventLike {
  type: string;
  payload: unknown;
}

/**
 * MELYIK MEZOKET ERINTI EGY ESEMENY-TIPUS.
 *
 * NEM MINDEN VALTOZAS AD `UPDATED` ESEMENYT, es ez a legkonnyebben atsiklott
 * resz: az allapot-, elhelyezes- es szulo-valtozas SAJAT tipust kap. Ha a
 * detektalas csak az `UPDATED` sorokat nezne, egy allapot-valtozas UTKOZES
 * NELKUL menne at -- csendben, es epp azon a mezon, ami a leglathatobb a lapon.
 *
 * A lista a `service-assets.repository.ts` esemeny-irasabol jon, es ha ott uj
 * tipus keletkezik, ITT is fel kell venni. A `Record` ezt nem tudja
 * kikenyszeriteni (a tipus a Prisma enumja), ezert all itt ez a mondat.
 */
const FIELDS_BY_EVENT: Record<string, readonly string[]> = {
  STATUS_CHANGED: ["status"],
  PLACEMENT_CHANGED: [
    "customerId",
    "supplierId",
    "customerAddressId",
    "aquariumId",
  ],
  PARENT_CHANGED: ["parentAssetId"],
};

/** Az esemeny altal erintett mezok. Az `UPDATED` a sajat payloadjabol. */
export function fieldsTouchedBy(event: AssetEventLike): readonly string[] {
  const rogzitett = FIELDS_BY_EVENT[event.type];
  if (rogzitett) return rogzitett;
  if (event.type !== "UPDATED") return [];
  const payload = event.payload as { fields?: unknown } | null;
  return Array.isArray(payload?.fields)
    ? payload.fields.filter((f): f is string => typeof f === "string")
    : [];
}

/**
 * MELYIK MEZOKON VAN VALODI UTKOZES.
 *
 * A metszet: amit a keres MEGVALTOZTATNA, es amihez KOZBEN valaki mas is
 * hozzanyult. Ures halmaz = nincs utkozes, a modositas mehet, MEG AKKOR IS, ha
 * a sor idobelyege kozben elmozdult.
 *
 * EZ AZ EGESZ SZELET LENYEGE, ES EZERT ALL TISZTA FUGGVENYBEN: a "mehet-e"
 * dontes eddig egyetlen SQL feltetelben lakott, ahol semmi nem merte.
 */
export function conflictingFields(
  intended: readonly string[],
  events: readonly AssetEventLike[],
): string[] {
  const erintett = new Set<string>();
  for (const event of events)
    for (const field of fieldsTouchedBy(event)) erintett.add(field);
  return intended.filter((field) => erintett.has(field));
}

/**
 * MELYIK MEZOKET VALTOZTATNA MEG EZ A KERES.
 *
 * A `data` a Prisma frissitesi objektum: a `undefined` erteku kulcsokat a
 * Prisma FIGYELMEN KIVUL hagyja, tehat azok nem is szandekoltak.
 *
 * === A TELJES REKORDOT KULDO KLIENS ITT NEM ZAVAR ===
 *
 * A webes urlap ma a TELJES rekordot kuldi, nem csak a valtozott mezoket. Ez
 * megis mukodik, mert nem azt kerdezzuk, mit KULDOTT, hanem hogy mi TER EL a
 * mostani sortol. Ha az iroda kozben atirt egy mezot, a szerelo (regi) erteke
 * eltér a mostanitol -- tehat pontosan az kerul a halmazba, ami utkozes.
 *
 * === A HASONLITAS INKABB TOBBET MOND, MINT KEVESEBBET, ES EZ DONTES ===
 *
 * Az osszehasonlitas szoveges alakon megy, mert az ertekek kozott van datum es
 * enum is. Ha ket egyenlo ertek maskepp alakul szoveggé, TOBBET jelentunk
 * szandekoltnak, mint amennyi -- az FALSE UTKOZEST ad, ami HANGOS: a
 * felhasznalo latja es ujra probalja. A forditott hiba (kevesebbet jelenteni)
 * NEMA lenne: kimaradna egy mezo az ellenorzesbol, es a masik ember
 * valtoztatasa nyomtalanul felulirodna.
 */
export function intendedFields(
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  return Object.keys(data).filter((key) => {
    const uj = data[key];
    if (uj === undefined) return false;
    const regi = existing[key];
    if (regi === null || uj === null) return regi !== uj;
    return String(regi) !== String(uj);
  });
}

/** A mezonevek emberi alakja. Ami nincs a listan, a sajat neven marad. */
const FIELD_LABELS: Record<string, string> = {
  status: "állapot",
  name: "megnevezés",
  serialNumber: "gyári szám",
  inventoryNumber: "partner azonosítója",
  notes: "megjegyzés",
  customerId: "tulajdonos",
  supplierId: "tulajdonos",
  customerAddressId: "helyszín",
  aquariumId: "akvárium",
  parentAssetId: "fölérendelt eszköz",
};

/**
 * MIT MONDUNK, HA UTKOZES VAN -- ES A MEZOT MEG IS NEVEZZUK.
 *
 * Egy "valaki modositotta idokozben" mondat nem mondja meg, MIT kell
 * megnezni. A mezonev az egyetlen dolog, amibol a felhasznalo eldontheti, hogy
 * az o valtoztatasa fontosabb-e, mint a masike.
 */
export function describeFieldConflict(fields: readonly string[]): string {
  const nevek = fields.map((f) => FIELD_LABELS[f] ?? f);
  const felsorolas = nevek.join(", ");
  return (
    `Ezt az eszközt időközben más is módosította, és ugyanazon a mezőn: ${felsorolas}. ` +
    "Nyisd meg újra, nézd meg a mostani értéket, és döntsd el, melyik maradjon."
  );
}
