"use client";

import {
  Card,
  CardContent,
  CardHeader,
  Icon,
  PageHeader,
  type IconName,
} from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
  servedNavigationFeatures,
  type Permission,
} from "@acropora/types";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { AppearanceSettingsCard } from "./appearance-settings-card";

/**
 * A BEALLITASOK GYUJTOOLDALA -- EGY SZAKADAST ZAR BE, NEM UJ KEPESSEGET AD.
 *
 * A `/beallitasok` menupont 2026-09-03-ig 404-et adott, holott az ALPONTJA
 * (`/beallitasok/matricak`) mar letezett. Vagyis nem ures menupont volt, hanem
 * olyan, aminek van gyereke, es a SZULOJE hianyzott.
 *
 * MIERT GYUJTOOLDAL, ES NEM ATIRANYITAS AZ ELSO ALPONTRA (picasso dontese,
 * 2026-09-03): ot, valoban kulonbozo admin-terulet kozott nincs egyetlen
 * termeszetes "elsodleges" -- egy automatikus atiranyitas onkenyes valasztas
 * lenne. Ot tetel meg atlathato egy listakent.
 *
 * ES AMIBEN ELTEREK PICASSO LAPJATOL, MERESSEL: az o listaja az `/admin/
 * integrations` es az `/admin/imports` utra mutatott. Mind a ketto KONYVTAR,
 * `page.tsx` NELKUL -- vagyis maga is 404. Az o merese a MENUPONTOKAT vetette
 * ossze a lapokkal, es ez a ketto nem menupont, tehat a mero nem lathatta.
 * Ha a listat szo szerint irom meg, a `/beallitasok` 404-jet ket UJ 404-re
 * cserelnem.
 *
 * EZERT A TERULET MEGMARAD, DE A LINK A LETEZO LAPRA MEGY: ahol egy teruletnek
 * nincs sajat gyujtolapja, ott az aloldalai allnak, nev szerint.
 */

/**
 * A LATHATOSAG A KOZOS FORRASBOL JON, NEM ITTANI MASOLATBOL.
 *
 * Minden tetel VAGY egy nyilvantartott menupont azonositojat viseli (es akkor
 * ugyanaz a szabaly kapuzza, mint a menuben), VAGY egy jogot nevez meg. A
 * masodik alak azert kell, mert az import-oldalnak MA NINCS menupontja: a
 * vegpontja `PRODUCTS_MANAGE`-et ker (`unas-import.controller.ts`), tehat a
 * link is azt kapja. Ha kesobb menupont lesz belole, ez `entryId`-re valt.
 */
export type SettingsLink =
  | { label: string; description: string; href: string; entryId: string }
  | {
      label: string;
      description: string;
      href: string;
      permission: Permission;
    };

export interface SettingsArea {
  title: string;
  icon: IconName;
  links: SettingsLink[];
}

/**
 * EXPORTALVA, MERT A HALO A FORRASBOL DOLGOZIK, NEM EGY MASOLATBOL. Egy kezzel
 * karbantartott lista a tesztben pontosan az uj tetelt hagyna ki -- azt,
 * amiert a halo letezik.
 */
export const SETTINGS_AREAS: SettingsArea[] = [
  {
    title: "Felhasználók",
    icon: "shield",
    links: [
      {
        label: "Felhasználók",
        description: "Fiókok és jogosultságok kezelése.",
        href: "/admin/users",
        entryId: "users",
      },
    ],
  },
  {
    /*
      MINDEN WEBSHOP-BEÁLLÍTÁS EGY HELYEN (Balázs, 2026-10-26 13:05 UTC, msg
      1564263673932026020): a UNAS és a Medusa kapcsolat, a szinkron, a
      rendelés-elavulás, a webshop levélsablonok és a kezdőlap a Webshop
      beállítások gyűjtőoldalon állnak; itt csak a hivatkozás, hogy ne
      duplázódjanak. A márkák és a válogatások a Webshop menüben.
    */
    title: "Webshop",
    icon: "store",
    links: [
      {
        label: "Webshop beállítások",
        description:
          "UNAS és Medusa kapcsolat, szinkron, rendelés-elavulás, webshop levélsablonok, kezdőlap.",
        href: "/webshop/beallitasok",
        entryId: "webshop-settings",
      },
    ],
  },
  {
    title: "Integrációk",
    icon: "key",
    links: [
      {
        label: "NAV",
        description: "A számlaadat-szolgáltatás kapcsolata.",
        href: "/admin/integrations/nav",
        entryId: "nav-integration",
      },
      {
        label: "Számlázz.hu kapcsolat",
        description: "A karbantartási piszkozat-számla Agent Key-je.",
        href: "/admin/integrations/szamlazz/connection",
        entryId: "szamlazz-connection",
      },
    ],
  },
  {
    title: "Importok",
    icon: "package",
    links: [
      {
        label: "UNAS katalógus-import",
        description: "Feltöltött UNAS munkafüzetek állapota és előzményei.",
        href: "/admin/imports/unas",
        permission: PERMISSIONS.PRODUCTS_MANAGE,
      },
    ],
  },
  {
    title: "Matricák",
    icon: "settings",
    links: [
      {
        /**
         * A LEIRAS KIMONDJA A MENUBELI NEVET IS. Egy-linkes teruletnel a kartya
         * cime a TERULET neve ("Matricák"), a menuben viszont "QR-kód
         * nyomtatás" all ugyanarra a lapra. Ket kulonbozo nev ugyanarra a
         * celra elbizonytalanit, ezert a leiras osszekoti a kettot.
         */
        label: "QR-kód nyomtatás",
        description:
          "QR-kód nyomtatás: eszköz-matricakódok generálása és nyilvántartása.",
        href: "/beallitasok/matricak",
        entryId: "asset-labels",
      },
    ],
  },
  {
    title: "Levelezés",
    icon: "settings",
    links: [
      {
        /**
         * A JOGOT NEVEZI MEG, NEM MENUPONT-AZONOSITOT -- ugyanaz az alak, mint
         * az import-oldalnal. A lapnak MA nincs menupontja, a vegpontja viszont
         * `SETTINGS_MANAGE`-et ker (`mail-template.controller.ts`), tehat a
         * link is azt kapja. Ha kesobb menupont lesz belole, ez `entryId`-re
         * valt.
         */
        label: "Levélsablon",
        description:
          "Az aláírt munkalapról szóló automatikus levél tárgya és szövege.",
        href: "/beallitasok/levelsablonok",
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
    ],
  },
  {
    title: "Pénzügy",
    icon: "finance",
    links: [
      {
        label: "Lejáró számlák levele",
        description:
          "A heti Utalási jegyzék PDF: kinek megy, mikor (legkorábban, legkésőbb), ki a feladó, és kikapcsolható.",
        href: "/beallitasok/lejaro-szamlak",
        permission: PERMISSIONS.FINANCE_MANAGE,
      },
    ],
  },
  {
    title: "AI csevegés",
    icon: "settings",
    links: [
      {
        /** A JOGOT NEVEZI MEG, nem menüpont-azonosítót (mint a Levélsablon): a lapnak nincs menüpontja, a végpontja AI_SETTINGS_MANAGE-et kér. */
        label: "AI csevegés",
        description:
          "A kollégai felajánlás, a kapcsolat-kérés címzettje és az üzenetek, kérések megőrzési ideje.",
        href: "/beallitasok/ai-cseveges",
        permission: PERMISSIONS.AI_SETTINGS_MANAGE,
      },
    ],
  },
  {
    title: "Mértékegységek",
    icon: "settings",
    links: [
      {
        label: "Mértékegységek",
        description:
          "A karbantartott mértékegység-lista: teljesítmény, mennyiség, mérés.",
        href: "/beallitasok/mertekegysegek",
        entryId: "units-of-measure",
      },
      {
        label: "Eszköz-kategóriák",
        description:
          "Az eszköz-felvitel legördülő listája. Kivezetni lehet, törölni nem: a már felvitt eszközök mellett olvasható marad.",
        href: "/beallitasok/eszkoz-kategoriak",
        entryId: "asset-categories",
      },
      {
        label: "Üzemeltetési napló sablonjai",
        description:
          "A rendszeres üzemeltetési feladatok (napi, heti, alkalmi) sablonja: melyik eszközre vagy kategóriára szól, és mit kell rögzíteni hozzá.",
        href: "/beallitasok/uzemeltetesi-naplo-sablonok",
        entryId: "operations-log-templates",
      },
      {
        label: "Eszköz-funkciók",
        description:
          "Az eszköz-felvitel másik legördülő listája: mire való az eszköz, függetlenül a kategóriától.",
        href: "/beallitasok/eszkoz-funkciok",
        entryId: "asset-functions",
      },
      {
        label: "Bérelhető eszközök",
        description:
          "A kölcsönzött eszközök darabonként: gyári szám, napi díj, kaució, pótlási érték, tartozékok.",
        href: "/beallitasok/berelheto-eszkozok",
        entryId: "rental-equipment",
      },
      {
        label: "Bérleti szerződés",
        description:
          "A bérléskor nyomtatott szerződés szövege, és a késedelmes visszahozás két száma.",
        href: "/beallitasok/berleti-szerzodes",
        entryId: "rental-contract",
      },
      {
        label: "Partner-duplikátumok",
        description:
          "Ugyanaz a cég vevőként, szállítóként vagy webshopos vásárlóként: csak olvasható lista a döntéshez.",
        href: "/beallitasok/partner-duplikatumok",
        entryId: "partner-duplicates",
      },
      {
        label: "Partner-átvezetés",
        description:
          "A partnerek (beszállítók, szerviz-partnerek) terve: melyik vevő-sorra kerül, melyikhez kötődik, melyikből készül új. Csak olvasható.",
        href: "/beallitasok/partner-atvezetes",
        entryId: "partner-migration",
      },
      {
        label: "Szállítási jelzők feltöltése",
        description:
          "Egyszeri feltöltés a UNAS-ból: minden UNAS-os termék megkapja a szállítási jelzőit. Előbb próba, utána írás.",
        href: "/beallitasok/szallitasi-jelzok",
        entryId: "shipping-fill",
      },
    ],
  },
  {
    title: "Fejlesztés",
    icon: "settings",
    links: [
      {
        label: "Komponens-katalógus",
        description:
          "A közös felületi elemek minden állapotukban, egy lapon: a design-körök ellenőrzéséhez.",
        href: "/beallitasok/komponensek",
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
    ],
  },
];

/**
 * A WEBSHOP BEÁLLÍTÁSOK GYŰJTŐOLDALÁNAK KÁRTYÁI (/webshop/beallitasok; Balázs,
 * 2026-10-26 13:05 UTC, acrobot döntése). Ugyanaz a forma és ugyanaz a
 * láthatósági szabály, mint a Beállítások áttekintőjén.
 */
export const WEBSHOP_SETTINGS_AREAS: SettingsArea[] = [
  {
    title: "UNAS",
    icon: "store",
    links: [
      {
        label: "UNAS kapcsolat",
        description: "A webshop hozzáférési adatai.",
        href: "/admin/integrations/unas/connection",
        entryId: "unas-connection",
      },
      {
        label: "UNAS szinkron",
        description: "A termékszinkron állapota és futásai.",
        href: "/admin/integrations/unas",
        entryId: "unas-sync",
      },
    ],
  },
  {
    title: "Medusa",
    icon: "store",
    links: [
      {
        label: "Medusa kapcsolat",
        description: "A webshop-motor admin kulcsa.",
        href: "/admin/integrations/medusa/connection",
        entryId: "medusa-connection",
      },
      {
        // a vetítő ár-felének tárolt megállásai (task t-20261117-arstop-web): menüpont nincs, a végpont INVENTORY_VIEW-t kér
        label: "Ár-megállások",
        description:
          "Azok a termékek, amelyeknek az ára nem megy ki a webshopba, és miért.",
        href: "/admin/integrations/medusa/price-stops",
        permission: PERMISSIONS.INVENTORY_VIEW,
      },
      {
        // a vetítés terve (task t-20261118-vetites-oldal): mit változtatna a következő átirányítás-vetítés a bolt listáján; menüpont nincs, a végpont INVENTORY_VIEW-t kér
        label: "Átirányítások vetítése",
        description:
          "Mit változtatna a következő vetítés a webshop átirányítás-listáján: új, módosuló és eltűnő sorok.",
        href: "/admin/integrations/medusa/redirect-plan",
        permission: PERMISSIONS.INVENTORY_VIEW,
      },
    ],
  },
  {
    title: "Rendelések",
    icon: "cart",
    links: [
      {
        label: "Rendelések elavulása",
        description:
          "Státuszonként: mennyi idő után jelezzen a Rendelések lista. Kikapcsolva az érték megmarad.",
        href: "/beallitasok/rendeles-elavulas",
        permission: PERMISSIONS.ORDERS_VIEW,
      },
    ],
  },
  {
    title: "Webshop levélsablonok",
    icon: "mail",
    links: [
      {
        label: "Webshop levélsablonok",
        description:
          "A vevőknek menő webshop-levelek tárgya és szövege, a Levélsablonok Webshop fülén.",
        href: "/beallitasok/levelsablonok?csoport=webshop",
        permission: PERMISSIONS.SETTINGS_MANAGE,
      },
    ],
  },
  {
    title: "Kuponok",
    icon: "cart",
    links: [
      {
        label: "Kuponok",
        description:
          "Kuponkódok a webshop pénztárához: százalék vagy forint a termékárból, érvényesség, felhasználási korlát, be- és kikapcsolás.",
        href: "/webshop/kuponok",
        entryId: "webshop-coupons",
      },
      {
        label: "Egyedi kedvezmények",
        description:
          "Vevőnként beállítható százalékos kedvezmény a termékárból, minden rendelésére. Be- és kikapcsolás.",
        href: "/webshop/egyedi-kedvezmenyek",
        entryId: "webshop-coupons",
      },
      {
        label: "Ajándékkártyák",
        description:
          "Ajándékkártya kiadása (a kód csak a kiadáskor látszik), a kártyák egyenlege és naplója, kikapcsolás.",
        href: "/webshop/ajandekkartyak",
        entryId: "webshop-gift-cards",
      },
    ],
  },
  {
    title: "Szállítás és fizetés",
    icon: "cart",
    links: [
      {
        label: "Szállítási díjak és fizetési módok",
        description:
          "A szállítási díjak, az ingyenes szállítás küszöbei, az utánvét díja, és szállítási módonként a fizetési módok sorrendje.",
        href: "/webshop/szallitas-fizetes",
        entryId: "webshop-shipping-settings",
      },
    ],
  },
  {
    title: "Hűségpont és árszabályok",
    icon: "star",
    links: [
      {
        label: "Hűségpont-beváltás és Omnibus-küszöb",
        description:
          "A pontbeváltás kapcsolója, a pont értéke és a beváltás határai, és hány napos ár-előzmény kell egy áthúzott árhoz.",
        href: "/webshop/arszabalyok",
        entryId: "webshop-price-rules",
      },
    ],
  },
  {
    title: "Kezdőlap",
    icon: "store",
    links: [
      {
        label: "Webshop kezdőlap",
        description:
          "A kezdőlap blokkjai, sorrendje, szövegei, képei és lábléce, élő előnézettel.",
        href: "/admin/kezdolap",
        entryId: "homepage-content",
      },
    ],
  },
];

/**
 * A KÁRTYARÁCS: a néző által elérhető linkek, területenként. A menüpont-
 * azonosítós link ugyanazzal a szabállyal kapuzott, mint a menüben, a
 * környezeti kapcsolókkal együtt (a kapcsolóhoz kötött tétel enélkül sehol nem
 * jelenne meg).
 */
export function SettingsAreaGrid({
  areas,
}: {
  areas: readonly SettingsArea[];
}) {
  const { session } = useAuth();
  const viewer = session?.user;
  const features = servedNavigationFeatures(session?.navigation);
  const visible = (link: SettingsLink) => {
    if (!viewer) return false;
    return "entryId" in link
      ? isNavigationEntryVisible(link.entryId, viewer, features)
      : hasPermission(viewer, link.permission);
  };
  const shown = areas
    .map((area) => ({ ...area, links: area.links.filter(visible) }))
    .filter((area) => area.links.length > 0);
  return <AreaCards areas={shown} />;
}

export function SettingsOverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Beállítások"
        description="A rendszer beállítható területei. Minden hivatkozás egy meglévő oldalra visz."
      />

      <AppearanceSettingsCard />

      {/*
        EGY LINK -> A KARTYA MAGA A LINK. TOBB -> CIM PLUSZ BELSO LISTA.
        (picasso eszrevetele, 2026-09-03: negy kulon link egy kartyan megbontja
        a tobbi, egy-linkes kartya egyenletesseget.)

        ES EGY MERT OK, AMI EBBOL KOVETKEZIK: az elso valtozatban minden kartya
        cim PLUSZ lista volt, es ettol a "Felhasznalok" es a "Markak" KETSZER
        allt a kepernyon (a kartya cimekent es a sajat linkjekent is) -- merve,
        ket elofordulas mindkettonel. Egy-linkes teruletnel a linknev nem ad
        hozza semmit a cimhez, tehat a LEIRAS viszi az informaciot.

        ES AMIERT A TOBB-LINKES KARTYA NEM KAP SAJAT href-et: negybol egyet
        valasztani onkenyes lenne (miert epp az UNAS kapcsolat?), a masik harom
        pedig lathatatlan maradna.
      */}
      <SettingsAreaGrid areas={SETTINGS_AREAS} />
    </div>
  );
}

function AreaCards({ areas }: { areas: readonly SettingsArea[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {areas.map((area) => {
        const cim = (
          <h2 className="flex items-center gap-2 text-sm font-semibold text-dusk-900">
            <Icon name={area.icon} className="size-4 text-dusk-400" />
            {area.title}
          </h2>
        );
        const egyetlen = area.links.length === 1 ? area.links[0] : null;
        return (
          <Card key={area.title}>
            {egyetlen ? (
              <Link
                href={egyetlen.href}
                className="block rounded-lg transition hover:bg-dusk-50"
              >
                <CardHeader>{cim}</CardHeader>
                <CardContent>
                  <p className="text-xs text-dusk-500">
                    {egyetlen.description}
                  </p>
                </CardContent>
              </Link>
            ) : (
              <>
                <CardHeader>{cim}</CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {area.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="block rounded-md border border-dusk-200 px-3 py-2 transition hover:border-brand-500 hover:bg-dusk-50"
                        >
                          <span className="block text-sm font-medium text-dusk-900">
                            {link.label}
                          </span>
                          <span className="block text-xs text-dusk-500">
                            {link.description}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
