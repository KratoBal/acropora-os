import { render, screen } from "@testing-library/react";

import {
  ServiceOfflineNotice,
  SZOVEG,
  type ServiceOfflineState,
} from "./service-offline-notice";

/**
 * A SZERVIZ-SAV ALLITASAINAK KOZOS ALLVANYA, EGY HELYEN.
 *
 * MIERT KERULT KI KULON FAJLBA: ez a ket fuggveny HAROM tesztfajlban allt,
 * BETURE azonos masolatban (merve 2026-09-15: mind a harom `setOnLine` es mind
 * a harom `savSzovege` torzs egyetlen valtozat). Most tiz lapnak kell, tehat a
 * masolas tiz peldanyt jelentene. Egy masolat nem uj kockazatot hoz, hanem
 * MEGSOKSZOROZZA a meglevot -- es epp attol lathatatlan, hogy minden peldany
 * egyforma.
 *
 * A FAJL NEVE SZANDEKOSAN `.testing.tsx`, NEM `.test.tsx`. A vitest include
 * listaja es a leltar-halo (`src/test/test-inventory.component.test.ts`)
 * egyarant a `.test.` alakra glob-ol; egy `.test.tsx` vegu seged TESZTFAJLNAK
 * szamitana, es a leltar "egyetlen tesztet sem tartalmaz" miatt bukna rajta.
 */

/**
 * A KAPCSOLAT ALLAPOTAT A `navigator.onLine` MONDJA MEG, es a futtato
 * alapertelmezese `true` -- tehat a sav ki sem rajzolodna.
 *
 * A HIVONAK KELL VISSZAALLITANIA (`afterEach(() => setOnLine(true))`), mert ez
 * a modul nem tud `afterEach`-et regisztralni a hivo fajl neveben. Ha egy teszt
 * kapcsolat nelkul hagyja a vilagot, a KOVETKEZO teszt fut ugy, es az eredmenye
 * nem arrol szol, amit merni akart.
 *
 * (A korabbi, harom helyen allo valtozat megjegyzese `jsdom`-ot nevezett meg.
 * A `vitest.config.ts` szerint a kornyezet `happy-dom`; az alapertelmezes
 * ugyanaz, a NEV volt rossz.)
 */
export function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

/**
 * MINDEN ALLAPOT, A FORRASBOL -- nem kezzel felsorolva.
 *
 * Igy egy negyedik `kind`, amit valaki fel ev mulva felvesz a `SZOVEG`
 * terkepbe, automatikusan bekerul minden alabbi allitasba. Egy kezzel irt
 * harmas lista ugyanezt IGERNE, es CSENDBEN nem tartana be.
 */
export const MINDEN_KIND = Object.keys(SZOVEG) as ServiceOfflineState["kind"][];

/**
 * A VART MONDATOT A KOMPONENSTOL KERDEZEM MEG, NEM BEGEPELEM.
 *
 * Egy lap allitasa arrol szol, hogy a lap JOL VALASZT az allapotok kozul --
 * nem arrol, hogy mi a mondat szovege. A szoveg a save, es sajat tesztje van
 * ra, ami azt is allitja, hogy a mondatok KULONBOZNEK. Ha a lap tesztjebe
 * beirnank a mondatot, ket helyen allna ugyanaz az igazsag, es a lap tesztje
 * pirosodna egy PUSZTA ATFOGALMAZASTOL.
 *
 * MERVE, NEM FELTEVES (2026-09-15): a #693 pontosan ezt tette -- az urlap
 * mondatat atirta, a `form` kindhez nem nyult --, es a begepelt valtozat
 * azonnal pirosra valtott a friss fo agon, holott a lapok viselkedese nem
 * valtozott.
 */
export function savSzovege(kind: ServiceOfflineState["kind"]): string {
  /**
   * A KAPCSOLAT ALLAPOTAT VISSZAADJUK, PEDIG A KORABBI VALTOZAT NEM TETTE --
   * ES EZ NEM TAKARITAS, HANEM EGY REJTETT FUGGES MEGSZUNTETESE.
   *
   * A savot csak offline allapotban lehet kirajzolni, tehat ez a fuggveny
   * MELLEKHATASKENT atallitotta a vilagot. A harom eddigi hivo epp ettol lett
   * offline: sehol nem all nalunk `setOnLine(false)`, csak ez a sor -- vagyis
   * a lapok tesztjei egy SZOVEGET LEKERDEZO fuggveny mellekhatasan alltak.
   *
   * Ket okbol rossz. Egy: aki a hivast athelyezi (peldaul a render UTANra),
   * annak a savja NEM jelenik meg, es a piros nem arra mutat, ami elromlott --
   * a `navigator.onLine` atirasa nem kuld esemenyt, tehat a mar felallt
   * komponens nem ertesul rola. Ketto: aki ezt a fuggvenyt csak a mondatert
   * hivja, csendben halozat nelkuli vilagban hagyja a kovetkezo tesztet.
   *
   * Mostantol a hivo mondja meg, mikor van kapcsolat -- ez a fuggveny csak
   * kolcsonveszi az allapotot a sajat rajzolasa idejere.
   */
  const elozo = window.navigator.onLine;
  setOnLine(false);
  const { container, unmount } = render(
    <ServiceOfflineNotice state={{ kind }} />,
  );
  const szoveg = container.textContent ?? "";
  unmount();
  setOnLine(elozo);
  return szoveg;
}

/**
 * EGY OSZTALLYAL ELREJTETT SAV OTT VAN A FABAN, ES SENKI NEM LATJA.
 *
 * EZ NEM ELMELETI: megepitettem. A savot `<div className="hidden">`-be csomagolva
 * a szerviz teljes lap-teszt-keszlete ZOLD MARAD, mert a futtato NEM tolt be
 * stiluslapot -- a Tailwind `hidden` osztaly szamara csak egy szo. (A HTML
 * `hidden` ATTRIBUTUM mas eset: azt a `toBeVisible` is elkapja.)
 *
 * AZ ALAK ELERHETO TAVOLSAGBAN VAN, NEM KITALALT -- de a szam, ami itt allt,
 * ROSSZ VOLT, es ezt kimondom, mert magam irtam ide. "30 helyen" allt, laza
 * mintabol: az `apps/web` fajaban a `hidden`-t TARTALMAZO szavak tenyleg
 * negyvenotszor allnak, csakhogy ebbol 18 az `overflow-hidden` (az nem rejt el
 * elemet, csak vag) es 6 az `aria-hidden`.
 *
 * UJRAMERVE 2026-09-15, a KODRA (kommentek kiszedve, barmely string-literal,
 * tehat a konstansba vagy `cn()`-be zart alak is beleszamitva), a sajat ket
 * orzo-fajlom nelkul:
 *
 *     rejto osztaly-token   9   ebbol reszponziv 4, sima 5
 *     erintett termek-fajl  4   (app-shell, user-menu, webshop-orders,
 *                                worksheet-line-editor)
 *
 * Kilenc hely negy lapon, es kozottuk a fo navigacio: a `lg:hidden` epp az a
 * fajta, ami egy sav fole is odakerulhet. A kovetkeztetes tehat all, a
 * nagysagrend viszont HARMADA annak, amit ide irtam.
 *
 * A HATARA, KIMONDVA -- ez PADLO, nem garancia:
 *   - csak az OSZTALYT nezi. Egy `style="display:none"`, egy nulla magassagu
 *     szulo vagy egy `overflow` mogotti elhelyezes atcsuszik rajta;
 *   - a reszponzív alakot (`hidden sm:block`) IS rejtettnek mondja, holott az
 *     szeles kepernyon latszik. Ez SZANDEKOS: a ket tevedes ara nem egyforma.
 *     A folosleges szigor HANGOS (valaki egy perc alatt feloldja), a folosleges
 *     engedekenyseg NEMA -- egy lathatatlan sav ugy nez ki, mint egy lap,
 *     aminek nincs is mondanivaloja.
 */
export function osztallyalRejtve(elem: HTMLElement): string | null {
  for (let csomopont: HTMLElement | null = elem; csomopont;) {
    const rejto = [...csomopont.classList].find(
      (osztaly) => osztaly === "hidden" || osztaly.endsWith(":hidden"),
    );
    if (rejto) return rejto;
    csomopont = csomopont.parentElement;
  }
  return null;
}

/**
 * A LAP AZT A MONDATOT MONDJA, ES A TOBBIT NEM -- HAROM ALLITAS EGYBEN.
 *
 * MIERT NEM ELEG A "MEGJELENT-E" ALLITAS. A komponens tipusa CSAK azt
 * kenyszeriti ki, hogy a lap VALASSZON; azt nem, hogy JOL valasszon. Egy lap,
 * ami allandoan `loaded`-ot ad, atmegy a tipusellenorzesen ES egy olyan
 * allitason is, ami csak a betoltott esetet nezi. A rogzult valasztast egyedul
 * az fogja meg, ha a TOBBI mondat hianyat is allitjuk.
 *
 * A harmadik allitas a lathatosag (lasd `osztallyalRejtve`).
 */
export async function savotMond(kind: ServiceOfflineState["kind"]) {
  /**
   * MINDEN MONDAT ELOSZOR, A LAP LEKERDEZESE ELOTT. A `savSzovege` maga is
   * RENDEREL egy savot a dokumentumba, majd leszedi; ha ezt a lap allitasai
   * KOZOTT tennenk, egy sajat, atmeneti csomopontot merhetnenk a lap helyett.
   */
  const mondat = Object.fromEntries(
    MINDEN_KIND.map((k) => [k, savSzovege(k)]),
  ) as Record<ServiceOfflineState["kind"], string>;

  const elem = await screen.findByText(mondat[kind]);

  const rejto = osztallyalRejtve(elem);
  if (rejto !== null)
    throw new Error(
      `A sav ott van a faban, de egy "${rejto}" osztaly elrejti, tehat a ` +
        `felhasznalo nem latja. A stilusokat a futtato nem tolti be, ezert ` +
        `ezt egyetlen szoveg-allitas sem venne eszre.`,
    );

  for (const masik of MINDEN_KIND)
    if (masik !== kind && screen.queryByText(mondat[masik]) !== null)
      throw new Error(
        `A lap a "${masik}" mondatot is kiirja, pedig "${kind}" allapotban ` +
          `van. Ket egyszerre allo mondat kozul az egyik biztosan hazudik.`,
      );

  return elem;
}
