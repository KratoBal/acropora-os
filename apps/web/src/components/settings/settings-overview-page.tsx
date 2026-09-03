"use client";

import {
  Card,
  CardContent,
  CardHeader,
  Icon,
  type IconName,
} from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
  type Permission,
} from "@acropora/types";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";

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
type SettingsLink =
  | { label: string; description: string; href: string; entryId: string }
  | {
      label: string;
      description: string;
      href: string;
      permission: Permission;
    };

interface SettingsArea {
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
    title: "Márkák",
    icon: "package",
    links: [
      {
        label: "Márkák",
        description: "A katalógusban használt márkanevek.",
        href: "/admin/brands",
        entryId: "brands",
      },
    ],
  },
  {
    title: "Integrációk",
    icon: "key",
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
      {
        label: "NAV",
        description: "A számlaadat-szolgáltatás kapcsolata.",
        href: "/admin/integrations/nav",
        entryId: "nav-integration",
      },
      {
        label: "Medusa kapcsolat",
        description: "A webshop-motor admin kulcsa.",
        href: "/admin/integrations/medusa/connection",
        entryId: "medusa-connection",
      },
    ],
  },
  {
    title: "Importok",
    icon: "package",
    links: [
      {
        label: "UNAS katalógus-import",
        description: "Feltöltött munkafüzetek állapota és előzményei.",
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
        label: "QR-kód nyomtatás",
        description: "Eszköz-matricakódok generálása és nyilvántartása.",
        href: "/beallitasok/matricak",
        entryId: "asset-labels",
      },
    ],
  },
];

export function SettingsOverviewPage() {
  const { session } = useAuth();
  const role = session?.user.role;

  /**
   * AMIT A NEZO NEM ER EL, AZT NEM IS MUTATJUK. Ma ez a szures a gyakorlatban
   * keveset szur -- a lapra `SETTINGS_MANAGE` kell, es azt csak az OWNER es az
   * ADMIN kapja, akik amugy is mindent latnak. De ez egy MAI allapot, nem
   * szabaly: ha valaki holnap `SETTINGS_MANAGE`-et kap `USERS_MANAGE` nelkul,
   * szures nelkul egy olyan linket latna, amire 403-at kap.
   */
  const visible = (link: SettingsLink) => {
    if (!role) return false;
    return "entryId" in link
      ? isNavigationEntryVisible(link.entryId, role)
      : hasPermission(role, link.permission);
  };

  const areas = SETTINGS_AREAS.map((area) => ({
    ...area,
    links: area.links.filter(visible),
  })).filter((area) => area.links.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Beállítások</h1>
        <p className="mt-1 text-sm text-slate-600">
          A rendszer beállítható területei. Minden hivatkozás egy meglévő
          oldalra visz.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {areas.map((area) => (
          <Card key={area.title}>
            <CardHeader>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Icon name={area.icon} className="size-4 text-slate-400" />
                {area.title}
              </h2>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {area.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block rounded-md border border-slate-200 px-3 py-2 transition hover:border-teal-500 hover:bg-slate-50"
                    >
                      <span className="block text-sm font-medium text-slate-900">
                        {link.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {link.description}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
