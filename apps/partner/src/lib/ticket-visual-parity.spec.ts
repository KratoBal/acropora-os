import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A HIBAJEGY-LAPOK ARCULATI PARÍTÁSA (Balázs kérése, 2026-09-21, megerősítve
 * 2026-09-24 07:28 UTC) -- NÉV SZERINTI, EGYENKÉNTI ÁLLÍTÁSOK, KALIBRÁCIÓVAL.
 *
 * === A HATÁR, UGYANAZ, MINT A `portal-wiring.spec.ts`-BEN ===
 *
 * Ezek az állítások a FORRÁS SZÖVEGÉT olvassák, nem a képernyőt: ehhez a
 * csomaghoz nincs renderelő, és ez a kör sem vezet be egyet.
 *
 * === A HIÁNY-ÁLLÍTÁSOKNÁL A KOMMENT KIVÉTELEZÉS KÖTELEZŐ ===
 *
 * Ez a fájl saját fejléc-kommentjeiben (a másik két fájlban is) SZÓ SZERINT
 * idézi a kizárt mintákat (`ticket.status`, a belső állapotnevek), hogy
 * elmagyarázza, miért nincsenek ott. A `portal-wiring.spec.ts` már megmérte
 * ugyanezt a csapdát: a jó magyarázat pont azokat a szavakat használja, amiket
 * a szöveg-alapú mérés keres. A `kod()` ezért innen származik, nem újraírva.
 */

const LISTA = "src/components/ticket-list.tsx";
const RESZLET = "src/components/ticket-detail.tsx";

const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("hibajegy-lapok arculati parítása", () => {
  /*
    2026-09-25-TŐL A LISTA A PILOT KERETET HÍVJA, NEM A VIOLET `Service*`-t.
    A Figma 9. kör (Partner Portál) a `portal-shell.tsx`/`login/page.tsx`
    után a tartalom-képernyőket is a pilot-aqua design-rendszerre viszi --
    ez az állítás lecserélve, hogy a MOSTANI keretet mérje, nem a
    korábbit. Az adatlap (`RESZLET`) egy KÉSŐBBI PR-ben kapja ugyanezt a
    váltást, ezért a lenti masik allitas addig valtozatlan marad.
  */
  it("a lista a közös @acropora/ui PILOT-keretét hívja", () => {
    const s = kod(LISTA);
    assert.match(s, /from "@acropora\/ui"/);
    assert.match(s, /PilotThemeRoot/);
    assert.match(s, /PilotBadge/);
    assert.match(s, /partnerStatusBadgeVariant/);
  });

  /*
    2026-09-25-TŐL AZ ADATLAP IS A PILOT KERETET HÍVJA, NEM A VIOLET
    `Service*`-t -- ugyanaz a valtas, mint fent a listanal.
  */
  it("az adatlap a közös @acropora/ui PILOT-keretét hívja", () => {
    const s = kod(RESZLET);
    assert.match(s, /from "@acropora\/ui"/);
    assert.match(s, /PilotThemeRoot/);
    assert.match(s, /PilotCard/);
    assert.match(s, /PilotTimeline/);
    assert.match(s, /PilotDataRow/);
  });

  /*
    KALIBRÁLVA: ennek a fájlnak a KORÁBBI VÁLTOZATA egy fejlesztési körben
    ténylegesen `partnerStatusTone(ticket.status)`-t hívott -- a belső,
    nyolcértékű mezőt adta át egy kliens-oldali függvénynek --, mielőtt a
    `partnerStatusTone` aláírása a négyértékű `ServiceJobPartnerStatus`-ra
    szűkült. Ez az állítás pontosan azt a hibát fogja meg.
  */
  it("a lista SOHA nem hivatkozik a nyers belső állapotra (`ticket.status`)", () => {
    assert.doesNotMatch(kod(LISTA), /\bticket\.status\b/);
  });

  it("az adatlap SOHA nem hivatkozik a nyers belső állapotra (`ticket.status`)", () => {
    assert.doesNotMatch(kod(RESZLET), /\bticket\.status\b/);
  });

  /*
    A `partnerApi`-nak (src/lib/api.ts) MA nincs léptető, delegáló vagy
    áthelyező végpontja -- ezt maga a fordító is kikényszerítené, ha lenne
    ilyen hívás. Ez az állítás mégis névvel, külön áll: ha valaha idekerülne
    egy ilyen hívás (mert a `partnerApi` bővül), ez a teszt mondja meg, hogy a
    lap átlépte a Balázs által kimondott határt ("csak ott megtudja csinalni
    azt amihez jogosultsaga van"), nem csak azt, hogy a típusok stimmelnek.
  */
  it("az adatlap nem hív léptető/delegáló/áthelyező API-t", () => {
    const s = kod(RESZLET);
    assert.doesNotMatch(s, /partnerApi\.setAssignees/);
    assert.doesNotMatch(s, /partnerApi\.setPlacement/);
    assert.doesNotMatch(s, /partnerApi\.move\(/);
  });

  /*
    POZITÍV KONTROLL. Ha a fenti szűkítés hibásan MINDENT elrejtene (nem csak
    a négy belső műveletet), ez a két állítás is pirosra váltana -- tehát a
    fenti négy "hiányzik" állítás nem attól zöld, hogy a mérés vak.
  */
  it("POZITÍV KONTROLL: a hibajegy nyitása és a dokumentum-csatolás megmaradt", () => {
    assert.match(kod(LISTA), /href="\/hibajegyek\/uj"/);
    const reszlet = kod(RESZLET);
    assert.match(reszlet, /<DocumentPanel/);
    assert.match(reszlet, /uploadTicketDocument/);
  });

  /*
    A `Message` ÉS AZ `Empty` EXPORT VÁLTOZATLAN MARADT. Hat másik fájl
    importálja a `Message`-t (köztük `asset-detail.tsx`, nautilus párhuzamos
    munkája) -- egy átnevezés vagy áthelyezés ott törne el, nem itt, és ez a
    teszt egy gyorsabb, közvetlen jelzést ad, mielőtt a teljes typecheck fut.
  */
  it("a `Message` és az `Empty` export a helyén és a nevén maradt", () => {
    const s = kod(LISTA);
    assert.match(s, /export function Message\(/);
    assert.match(s, /export function Empty\(/);
  });
});
