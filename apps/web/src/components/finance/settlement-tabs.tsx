"use client";

import { isNavigationEntryVisible } from "@acropora/types";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { SETTLEMENT_TABS } from "@/components/navigation";

/** A szolgáltató kártyájának második sora (Figma 618:1641, 618:1788, 618:1935). */
const DESCRIPTION: Record<string, string> = {
  "/penzugy/foxpost": "Heti utánvét + díjszámla egy levélben",
  "/penzugy/gls": "Utánvét, díjszámla és kompenzáció",
  "/penzugy/simplepay": "Kártyás forgalmi kimutatás",
};

/**
 * AZ ELSZÁMOLÁSOK SZOLGÁLTATÓI (Balázs, 2026-09-30): Foxpost, GLS, SimplePay
 * egy menüpont alatt. A terv (Figma 45 · OS / Settlements) kártyákként
 * rajzolja őket a fejléc alatt: pötty, név, egy sor leírás; az aktív kártya
 * aqua kerettel és háttérrel. Az aktív kártya a jelenlegi útvonalból jön,
 * tehát a régi útvonalak (könyvjelző, levélben küldött link) ugyanúgy a
 * helyeset mutatják. Csak az a kártya látszik, amihez a felhasználónak joga
 * van.
 */
export function SettlementTabs() {
  const pathname = usePathname() ?? "";
  const { session } = useAuth();
  const tabs = SETTLEMENT_TABS.filter(
    (tab) => session && isNavigationEntryVisible(tab.entryId, session.user),
  );
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Elszámolások">
      <ul className="grid gap-4 sm:grid-cols-3">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
                className={`block h-full rounded-2xl border px-5 py-4 transition-colors ${
                  active
                    ? "border-pilot-aqua-700 bg-pilot-aqua-50"
                    : "border-pilot-grey-200 bg-white hover:border-pilot-grey-300"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${
                      active ? "bg-pilot-aqua-700" : "bg-pilot-grey-300"
                    }`}
                  />
                  <span
                    className={`text-sm font-semibold ${
                      active ? "text-pilot-aqua-700" : "text-pilot-grey-900"
                    }`}
                  >
                    {tab.label}
                  </span>
                </span>
                <span className="mt-1.5 block text-xs text-pilot-grey-600">
                  {DESCRIPTION[tab.href]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
