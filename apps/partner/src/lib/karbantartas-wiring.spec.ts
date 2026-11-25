import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KARBANTARTÁS MENÜPONT BEKÖTÉSE A PARTNER PORTÁLON (Luca, 2026-11-18 14:50 UTC; acrobot 55980; Balázs 11:31: a karbantartásnak semmi köze a hibajegyekhez). Ennek az appnak nincs
 * komponens-teszt keretrendszere (`lib/*.spec.ts`, `node:test`), ezért a bekötést a KÓDRA mérjük (komment nélkül, mint a `ticket-fields-edit-wiring.spec.ts`).
 *
 * MI PIROSÍT: ha a Hibajegyek lista újra mindent kér (`kind: "ALL"`), vagy a Karbantartás lista nem `MAINTENANCE`-et; ha nincs menüpont vagy útvonal a karbantartásnak; ha a
 * karbantartási lap adatlapján újra megjelenik a beszélgetés, a szerkesztő vagy a dokumentumcsomag-gomb; ha a másik fajta útvonalán megnyitott lap nem irányít át a sajátjára; ha a
 * partner a karbantartás listán új hibajegyet nyithat. A KAPCSOLÓDÓ MUNKALAPOK (kártya efe02c6f): ha a karbantartási lap nem kéri le vagy nem mutatja őket; ha a hibajegy is
 * kérné; ha a kártya írni tudna (hozzákapcsolás, levétel) vagy kiírná, ki kapcsolta; ha a sor nem a munkalap partneri adatlapjára visz.
 */
const GYOKER = join(process.cwd(), "src");
const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const KLIENS = join(GYOKER, "lib", "api.ts");
const LISTA = join(GYOKER, "components", "ticket-list.tsx");
const ADATLAP = join(GYOKER, "components", "ticket-detail.tsx");
const MENU = join(GYOKER, "components", "portal-shell.tsx");
const KAPCSOLT = join(GYOKER, "components", "linked-worksheets-card.tsx");
const LISTA_OLDAL = join(GYOKER, "app", "(portal)", "karbantartas", "page.tsx");
const ADATLAP_OLDAL = join(
  GYOKER,
  "app",
  "(portal)",
  "karbantartas",
  "[id]",
  "page.tsx",
);
const HIBAJEGY_ADATLAP_OLDAL = join(
  GYOKER,
  "app",
  "(portal)",
  "hibajegyek",
  "[id]",
  "page.tsx",
);

describe("a karbantartás menüpont bekötése a partner portálon", () => {
  it("POZITÍV KONTROLL: a fájlok olvashatók és nem üresek", () => {
    for (const ut of [
      KLIENS,
      LISTA,
      ADATLAP,
      MENU,
      LISTA_OLDAL,
      ADATLAP_OLDAL,
      KAPCSOLT,
    ])
      assert.ok(kod(ut).length > 100, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("a lista fajta szerint kér, nem mindent (a hibajegyek REPAIR, a karbantartás MAINTENANCE)", () => {
    const api = kod(KLIENS);
    assert.doesNotMatch(api, /kind:\s*"ALL"/);
    assert.match(api, /new URLSearchParams\(\{ scope, kind \}\)/);
    assert.match(kod(LISTA), /partnerApi\.tickets\(scope, kind\)/);
    assert.match(kod(LISTA_OLDAL), /<TicketList kind="MAINTENANCE"/);
  });

  it("van Karbantartás menüpont és útvonal, a hibajegyek menüje megmarad", () => {
    const menu = kod(MENU);
    assert.match(menu, /href: "\/karbantartas", label: "Karbantartás"/);
    assert.match(menu, /href: "\/hibajegyek", label: "Hibajegyek"/);
    assert.match(
      kod(ADATLAP_OLDAL),
      /<TicketDetail id=\{id\} route="karbantartas"/,
    );
    assert.match(
      kod(HIBAJEGY_ADATLAP_OLDAL),
      /<TicketDetail id=\{id\} route="hibajegyek"/,
    );
  });

  /*
    A KARBANTARTÁS LISTÁN NINCS ÁLLAPOTSZŰRŐ (barracuda, #2698 review): a Nyitott / Lezárt fül a jegy STATUS mezőjén szűr, egy karbantartási lap státusza viszont sosem COMPLETED, tehát a "Nyitott"
    fülön a kész lapok is ott állnának, a "Lezárt" fül mindig üres volna. MI PIROSÍT: ha a karbantartás lista "open" szűrővel indul, vagy a fülsor megjelenik rajta.
  */
  it("a karbantartás lista mindent mutat (all), a fülsor csak a hibajegyeké", () => {
    const lista = kod(LISTA);
    assert.match(
      lista,
      /useState<"open" \| "closed" \| "all">\(\s*kind === "MAINTENANCE" \? "all" : "open",?\s*\)/,
    );
    assert.match(
      lista,
      /\{kind === "REPAIR" \? \(\s*<div className="flex items-center gap-1[^"]*">\s*\{SCOPE_TABS\.map/,
    );
  });

  it("a partner a karbantartás listán nem nyithat új hibajegyet", () => {
    assert.match(
      kod(LISTA),
      /kind === "REPAIR" \? \(\s*<Link href="\/hibajegyek\/uj"/,
    );
  });

  it("a karbantartási lap adatlapján nincs beszélgetés, szerkesztő és dokumentumcsomag-gomb; a másik útvonalon megnyitott lap átirányít", () => {
    const lap = kod(ADATLAP);
    assert.match(lap, /maintenance \? null : <TicketConversation/);
    assert.match(lap, /worksheets\.length === 0 && !maintenance/);
    assert.match(
      lap,
      /!maintenance &&\s*ticket\.partnerStatus === "CLOSED" &&\s*!ticket\.partnerClosedReason/,
    );
    assert.match(
      lap,
      /router\.replace\(ticketHref\(ticket\.kind, ticket\.id\)\)/,
    );
  });

  it("a karbantartási lap mutatja a kapcsolódó munkalapokat, csak olvasásra; a hibajegy nem kéri le (kártya efe02c6f)", () => {
    const api = kod(KLIENS);
    assert.match(
      api,
      /linkedWorksheets: \(id: string\) =>\s*request<ServiceJobLinkedWorksheetsResponse>\(\s*`\/service\/jobs\/\$\{encodeURIComponent\(id\)\}\/linked-worksheets`,\s*\),/,
    );
    const lap = kod(ADATLAP);
    assert.match(
      lap,
      /if \(route !== "karbantartas"\) return;\s*setLinkedError\(null\);\s*try \{\s*setLinked\(\(await partnerApi\.linkedWorksheets\(id\)\)\.items\);/,
    );
    assert.match(lap, /\{maintenance \? \(\s*<LinkedWorksheetsCard/);
    const kartya = kod(KAPCSOLT);
    assert.doesNotMatch(kartya, /partnerApi|linkable|unlink|method:/);
    assert.doesNotMatch(kartya, /linkedByName/);
    assert.match(kartya, /href=\{`\/munkalapok\/\$\{item\.worksheetId\}`\}/);
  });
});
