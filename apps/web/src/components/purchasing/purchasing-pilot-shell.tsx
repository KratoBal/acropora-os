"use client";
import { Pagination, PilotLinkTabs } from "@acropora/ui";
import { isNavigationEntryVisible } from "@acropora/types";
import Link from "next/link";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { allNavigationPages } from "@/components/navigation";

/**
 * A BESZERZÉS TESTVÉR-OLDALAI FÜLKÉNT (Direction F, Figma 302:63, 611:321,
 * 613:887): a navigáció ugyanazon bejegyzései, ugyanazzal a szerep szerinti
 * láthatósággal, mint a menüben. A fül felirata a terv szerinti.
 */
const PURCHASING_TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/beszerzes", label: "Beszerzések" },
  { href: "/beszerzes/varhato", label: "Várható beérkezések" },
  { href: "/beszerzes/nav-szamlak", label: "NAV számla lekérés" },
];

/** A fülsor; egy látható fülnél nincs mit váltani, ezért nem rajzolódik. */
export function PurchasingTabs({ active }: { active: string }) {
  const { session } = useAuth();
  const tabs = PURCHASING_TABS.filter((tab) => {
    const entry = allNavigationPages.find((page) => page.href === tab.href);
    return Boolean(
      entry && session && isNavigationEntryVisible(entry.entryId, session.user),
    );
  }).map((tab) => ({ ...tab, active: tab.href === active }));
  if (tabs.length < 2) return null;
  return (
    <PilotLinkTabs
      label="Beszerzés oldalai"
      tabs={tabs}
      renderLink={({ href, className, children, ...rest }) => (
        <Link href={href} className={className} {...rest}>
          {children}
        </Link>
      )}
    />
  );
}

/** „1–25 / 312”: a lap tartománya a teljes számból. */
export function pageRange(pagination: {
  page: number;
  pageSize: number;
  totalItems: number;
}): string {
  const total = pagination.totalItems;
  if (total === 0) return "0 / 0";
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, total);
  return `${from.toLocaleString("hu-HU")}–${to.toLocaleString("hu-HU")} / ${total.toLocaleString("hu-HU")}`;
}

/**
 * A SZŰRŐKÁRTYA (a terv szerint a lista fölött, külön kártyán). A sor
 * TÖRIK, NEM CSÚSZIK (a Termékeknél a stage-en mérve): rugalmas elemek alsó
 * határral; a „Szűrők törlése” csak akkor, ha van mit törölni.
 */
export function PilotFilterCard({
  children,
  onClear,
}: {
  children: ReactNode;
  onClear?: () => void;
}) {
  return (
    <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        {children}
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
          >
            Szűrők törlése
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A LISTA KÁRTYÁJA (Figma 302:63, 611:321, 613:887): felül a darabszám
 * meleg szöveggel és a lapozó, alatta a táblázat, alul a tartomány és még
 * egy lapozó. A meleg sín a kártya tetején.
 */
export function PilotListCard({
  count,
  pagination,
  onPageChange,
  children,
}: {
  count: string;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
      <span
        aria-hidden="true"
        className="absolute inset-x-4 top-0 h-0.5 bg-pilot-accent-warm"
      />
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-pilot-accent-warm-text">{count}</p>
        <Pagination
          variant="directionF"
          position="top"
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange}
        />
      </div>
      {children}
      <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-pilot-grey-500">{pageRange(pagination)}</p>
        <Pagination
          variant="directionF"
          position="bottom"
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </section>
  );
}
