"use client";

import {
  Badge,
  Button,
  Icon,
  Input,
  NavItem,
  Sidebar,
  Topbar,
} from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
} from "@acropora/types";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  allNavigationPages,
  businessNavigation,
  contentNavigation,
  isNavigationGroup,
  isNavigationItemActive,
  primaryNavigation,
  secondaryNavigation,
  settingsNavigation,
  unasSettingsNavigation,
  type AppNavigationEntry,
  type AppNavigationItem,
} from "./navigation";
import { useAuth } from "./auth/auth-provider";
import { UserMenu } from "./auth/user-menu";
import { dashboardApi } from "@/lib/api/dashboard";

interface NavigationGroupProps {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  label: string;
  level?: 0 | 1;
}

function NavigationGroup({
  active,
  children,
  icon,
  label,
  level = 0,
}: NavigationGroupProps) {
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <div>
      <button
        type="button"
        className={[
          "group flex h-9 w-full items-center gap-3 rounded-lg text-sm font-medium transition-colors",
          level === 1 ? "px-2" : "px-3",
          // UGYANAZ A KEZELES, MINT A `NavItem`-nel: a menu sotet savban all.
          // A KIEMELES MAR NEM MASOLAT: a `nav-active` token koti ossze a
          // kettot, tehat ez a mondat leiras, nem igeret. Korabban ugyanaz a
          // nyers ertek allt itt es a `packages/ui` NavItem-jeben, es csak ez
          // a megjegyzes szolt rola -- egy megjegyzes viszont nem allitja at
          // a masik csomagot, ha valaki a menu szinet hangolja.
          active
            ? "bg-nav-active text-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            : "text-nav-muted hover:bg-white/5 hover:text-white",
        ].join(" ")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={[
            "text-white/55 transition-colors group-hover:text-white/85",
            active ? "text-white" : "",
          ].join(" ")}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={[
            "text-white/55 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open ? children : null}
    </div>
  );
}

/**
 * Every destination in the menu, so that an entry can tell whether a more
 * specific one owns the path being read. Without the whole set,
 * `/beszerzes/nav-szamlak` would light up purchasing as well as the NAV
 * invoices, right next to each other in the same group.
 */
const ALL_NAVIGATION_ITEMS = allNavigationPages;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [myTaskCount, setMyTaskCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session || !hasPermission(session.user, PERMISSIONS.DASHBOARD_VIEW)) {
      setMyTaskCount(null);
      return;
    }
    const controller = new AbortController();
    void dashboardApi
      .summary(session.token ?? "", controller.signal)
      .then((summary) => setMyTaskCount(summary.myTaskCount ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setMyTaskCount(null);
      });
    return () => controller.abort();
  }, [session]);

  const canAccess = (item: AppNavigationItem) =>
    Boolean(
      session && isNavigationEntryVisible(item.entryId, session.user.role),
    );
  const isActive = (item: AppNavigationItem) =>
    isNavigationItemActive(pathname, item, ALL_NAVIGATION_ITEMS);
  const visibleUnasNavigation = unasSettingsNavigation.filter(canAccess);
  const visibleSettingsNavigation = settingsNavigation.filter(canAccess);
  const settingsActive = [
    ...visibleUnasNavigation,
    ...visibleSettingsNavigation,
  ].some((item) => isActive(item));
  const unasActive = visibleUnasNavigation.some((item) => isActive(item));

  const renderItem = (item: AppNavigationItem, nested = false) => (
    <NavItem
      key={item.href}
      href={item.href}
      label={item.label}
      icon={<Icon name={item.icon} />}
      active={isActive(item)}
      className={nested ? "h-8 text-[13px]" : undefined}
      onClick={() => setMobileNavigationOpen(false)}
    />
  );

  /**
   * A heading is only drawn when at least one page under it may be seen, and
   * it counts as active when one of those pages is the one open. Both are
   * asked of the visible children rather than of the whole group: a page the
   * reader cannot open should neither put a heading on screen nor light it up.
   */
  const renderEntry = (entry: AppNavigationEntry) => {
    if (!isNavigationGroup(entry))
      return canAccess(entry) ? renderItem(entry) : null;

    const visibleChildren = entry.children.filter(canAccess);
    if (visibleChildren.length === 0) return null;

    return (
      <NavigationGroup
        key={entry.label}
        label={entry.label}
        icon={<Icon name={entry.icon} />}
        active={visibleChildren.some((item) => isActive(item))}
      >
        <div className="ml-4 mt-1 space-y-1 border-l border-white/12 pl-2">
          {visibleChildren.map((item) => renderItem(item, true))}
        </div>
      </NavigationGroup>
    );
  };

  const navigation = (
    <>
      <div className="space-y-1">
        {primaryNavigation.filter(canAccess).map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<Icon name={item.icon} />}
            active={isActive(item)}
            badge={
              item.href === "/feladataim" ? (
                <Badge className="px-1.5" variant="neutral">
                  {myTaskCount ?? "–"}
                </Badge>
              ) : undefined
            }
            onClick={() => setMobileNavigationOpen(false)}
          />
        ))}
      </div>

      <p className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
        Működés
      </p>
      <div className="space-y-1">{businessNavigation.map(renderEntry)}</div>

      {/*
        A TARTALOM SAJÁT CSOPORT. Az „Működés" alá húzva egy hetedik sor lenne
        a többi közt; a panasz viszont pont az volt, hogy nem látszik, mi vár
        kire. Egy külön fejléc alatt egyetlen sor is megtalálható.
      */}
      {contentNavigation.filter(canAccess).length > 0 ? (
        <>
          <p className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
            Tartalom
          </p>
          <div className="space-y-1">
            {contentNavigation.filter(canAccess).map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={<Icon name={item.icon} />}
                active={isActive(item)}
                onClick={() => setMobileNavigationOpen(false)}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-6 space-y-1 border-t border-white/12 pt-4">
        {secondaryNavigation.filter(canAccess).map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<Icon name={item.icon} />}
            active={isActive(item)}
            onClick={() => setMobileNavigationOpen(false)}
          />
        ))}
        {visibleUnasNavigation.length > 0 ||
        visibleSettingsNavigation.length > 0 ? (
          <NavigationGroup
            label="Beállítások"
            icon={<Icon name="settings" />}
            active={settingsActive}
          >
            <div className="ml-4 mt-1 space-y-1 border-l border-white/12 pl-2">
              {visibleSettingsNavigation
                .filter((item) => item.href === "/beallitasok")
                .map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={<Icon name={item.icon} />}
                    active={isActive(item)}
                    onClick={() => setMobileNavigationOpen(false)}
                  />
                ))}

              {visibleUnasNavigation.length > 0 ? (
                <NavigationGroup
                  label="UNAS"
                  icon={<Icon name="store" />}
                  active={unasActive}
                  level={1}
                >
                  <div className="ml-4 mt-1 space-y-1 border-l border-white/12 pl-2">
                    {visibleUnasNavigation.map((item) => (
                      <NavItem
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={<Icon name={item.icon} />}
                        active={isActive(item)}
                        className="h-8 text-[13px]"
                        onClick={() => setMobileNavigationOpen(false)}
                      />
                    ))}
                  </div>
                </NavigationGroup>
              ) : null}

              {visibleSettingsNavigation
                .filter((item) => item.href !== "/beallitasok")
                .map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={<Icon name={item.icon} />}
                    active={isActive(item)}
                    onClick={() => setMobileNavigationOpen(false)}
                  />
                ))}
            </div>
          </NavigationGroup>
        ) : null}
      </div>
    </>
  );

  const brand = (
    <a href="/" className="flex items-center gap-2.5" aria-label="Acropora OS">
      {/*
        A VALODI JEL, SOTET HATTERRE SZANT VALTOZATBAN. Balazs kuldte
        2026-09-15-en, es o hagyta jova a feher feliratot: a jel eredeti,
        majdnem fekete felirata ezen a savon 1,38 : 1 kontrasztot adott, a
        3 : 1 minimum alatt. A ket szines iv valtozatlan.

        A MERET NEM DISZ: a jel szelesebb, mint magas (kb. 1,81 : 1), es a
        felirat a magassaganak a 36 szazaleka. 40 pixel magasan a felirat
        15 pixel korul van, tehat olvashato, es a 64 pixeles marka-sor
        valtozatlan marad. A `width`/`height` kiirva all, hogy a betoltes
        ne mozdítsa el a sort.

        Az `alt` SZANDEKOSAN URES: a hivatkozas maga hordozza a nevet az
        `aria-label`-jeben, es a ketto egyutt ketszer mondana ki.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- statikus SVG, a next/image nem optimalizalja */}
      <img
        src="/acropora-logo-dark-bg.svg"
        alt=""
        width={72}
        height={40}
        className="h-10 w-auto"
      />
    </a>
  );

  const footer = (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">Rendszerállapot</p>
        <Badge variant="success">Online</Badge>
      </div>
      <p className="mt-1 text-[11px] text-nav-muted">
        Minden szolgáltatás elérhető
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper">
      <Sidebar brand={brand} footer={footer}>
        {navigation}
      </Sidebar>

      {mobileNavigationOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-dusk-950/30 backdrop-blur-[2px] lg:hidden"
            aria-label="Navigáció bezárása"
            onClick={() => setMobileNavigationOpen(false)}
          />
          <Sidebar
            brand={brand}
            footer={footer}
            className="!z-50 !flex shadow-2xl lg:!hidden"
          >
            {navigation}
          </Sidebar>
        </>
      ) : null}

      <div className="lg:pl-64">
        <Topbar
          leading={
            <div className="flex items-center gap-3 lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Navigáció megnyitása"
                onClick={() => setMobileNavigationOpen(true)}
              >
                <Icon name="menu" size={20} />
              </Button>
              <span className="hidden text-sm font-bold text-dusk-900 sm:inline">
                Acropora OS
              </span>
            </div>
          }
          search={
            <div className="mx-auto max-w-xl">
              <Input
                leadingIcon={<Icon name="search" size={17} />}
                placeholder="Keresés az Acropora OS-ben…"
                aria-label="Keresés"
                className="border-transparent bg-dusk-100 shadow-none focus:bg-white"
              />
            </div>
          }
          actions={
            <>
              {/*
                NINCS ÉRTESÍTÉS-HARANG. A szerver ma csak munkalap-kiosztási
                push-t küld a felelős szerelőnek; nincs Notification-modell,
                lista vagy olvasottság, amely a felületnek jelzést írhatna.
                Egy állandó piros pont azt állítaná, hogy van olvasatlan
                értesítés, miközben ilyen fogalomnak nincs gazdája. A lista és
                az olvasottság külön termékdöntés lesz; addig nem mutatunk
                működés nélküli vezérlőt.
              */}
              <UserMenu />
            </>
          }
        />

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
