"use client";

import { isNavigationEntryVisible } from "@acropora/types";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { SETTLEMENT_TABS } from "@/components/navigation";

/**
 * AZ ELSZÁMOLÁSOK FÜLSORA (Balázs, 2026-09-30): Foxpost, GLS, SimplePay egy
 * menüpont alatt. Az aktív fül a jelenlegi útvonalból jön, tehát a régi
 * útvonalak (könyvjelző, levélben küldött link) ugyanúgy a helyes fület
 * mutatják. Csak az a fül látszik, amihez a felhasználónak joga van.
 */
export function SettlementTabs() {
  const pathname = usePathname() ?? "";
  const { session } = useAuth();
  const tabs = SETTLEMENT_TABS.filter(
    (tab) => session && isNavigationEntryVisible(tab.entryId, session.user),
  );
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Elszámolások" className="mb-6 border-b border-line">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-brand-500 text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
