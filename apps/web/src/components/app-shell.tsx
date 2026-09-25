"use client";

import { Badge, Button, Icon, useThemePreference } from "@acropora/ui";
import { isNavigationEntryVisible } from "@acropora/types";
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
import { GlobalSearch } from "./global-search";
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
          "group flex h-10 w-full items-center gap-3 rounded-xl text-sm font-medium transition-colors",
          level === 1 ? "px-2" : "px-3",
          active
            ? "bg-pilot-aqua-50 text-pilot-aqua-800"
            : "text-pilot-grey-600 hover:bg-pilot-grey-100 hover:text-pilot-grey-900",
        ].join(" ")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={active ? "text-pilot-aqua-700" : "text-pilot-grey-500"}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={[
            "text-pilot-grey-500 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open ? children : null}
    </div>
  );
}

function NavigationItem({
  active,
  badge,
  item,
  nested = false,
  onChoose,
}: {
  active: boolean;
  badge?: ReactNode;
  item: AppNavigationItem;
  nested?: boolean;
  onChoose: () => void;
}) {
  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onChoose}
      className={[
        "flex items-center gap-3 rounded-xl font-medium transition-colors",
        nested ? "h-9 px-2 text-[13px]" : "h-10 px-3 text-sm",
        active
          ? "bg-pilot-aqua-50 text-pilot-aqua-800"
          : "text-pilot-grey-600 hover:bg-pilot-grey-100 hover:text-pilot-grey-900",
      ].join(" ")}
    >
      <Icon
        name={item.icon}
        size={nested ? 16 : 18}
        className={active ? "text-pilot-aqua-700" : "text-pilot-grey-500"}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge}
    </a>
  );
}

/** All destinations are needed to resolve overlapping active paths. */
const ALL_NAVIGATION_ITEMS = allNavigationPages;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const { effectiveTheme, preference, setPreference } = useThemePreference();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [myTaskCount, setMyTaskCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session || !isNavigationEntryVisible("dashboard", session.user.role)) {
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
  const closeMobileNavigation = () => setMobileNavigationOpen(false);

  const renderItem = (item: AppNavigationItem, nested = false) => (
    <NavigationItem
      key={item.href}
      item={item}
      active={isActive(item)}
      nested={nested}
      onChoose={closeMobileNavigation}
    />
  );

  const renderEntry = (entry: AppNavigationEntry) => {
    if (!isNavigationGroup(entry)) {
      return canAccess(entry) ? renderItem(entry) : null;
    }

    const visibleChildren = entry.children.filter(canAccess);
    if (visibleChildren.length === 0) return null;

    return (
      <NavigationGroup
        key={entry.label}
        label={entry.label}
        icon={<Icon name={entry.icon} size={18} />}
        active={visibleChildren.some((item) => isActive(item))}
      >
        <div className="ml-5 mt-1 space-y-1 border-l border-pilot-grey-200 pl-2">
          {visibleChildren.map((item) => renderItem(item, true))}
        </div>
      </NavigationGroup>
    );
  };

  const navigation = (
    <nav
      aria-label="Fő navigáció"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="space-y-1">
        {primaryNavigation.filter(canAccess).map((item) => (
          <NavigationItem
            key={item.href}
            item={item}
            active={isActive(item)}
            onChoose={closeMobileNavigation}
            badge={
              item.href === "/feladataim" ? (
                <Badge className="px-1.5" variant="neutral">
                  {myTaskCount ?? "–"}
                </Badge>
              ) : undefined
            }
          />
        ))}
      </div>

      <p className="mb-2 mt-7 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-pilot-grey-500">
        Működés
      </p>
      <div className="space-y-1">{businessNavigation.map(renderEntry)}</div>

      {contentNavigation.filter(canAccess).length > 0 ? (
        <>
          <p className="mb-2 mt-7 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-pilot-grey-500">
            Tartalom
          </p>
          <div className="space-y-1">
            {contentNavigation
              .filter(canAccess)
              .map((item) => renderItem(item))}
          </div>
        </>
      ) : null}

      <div className="mt-7 space-y-1 border-t border-pilot-grey-200 pt-4">
        {secondaryNavigation.filter(canAccess).map((item) => renderItem(item))}
        {visibleUnasNavigation.length > 0 ||
        visibleSettingsNavigation.length > 0 ? (
          <NavigationGroup
            label="Beállítások"
            icon={<Icon name="settings" size={18} />}
            active={settingsActive}
          >
            <div className="ml-5 mt-1 space-y-1 border-l border-pilot-grey-200 pl-2">
              {visibleSettingsNavigation
                .filter((item) => item.href === "/beallitasok")
                .map((item) => renderItem(item, true))}

              {visibleUnasNavigation.length > 0 ? (
                <NavigationGroup
                  label="UNAS"
                  icon={<Icon name="store" size={16} />}
                  active={unasActive}
                  level={1}
                >
                  <div className="ml-4 mt-1 space-y-1 border-l border-pilot-grey-200 pl-2">
                    {visibleUnasNavigation.map((item) =>
                      renderItem(item, true),
                    )}
                  </div>
                </NavigationGroup>
              ) : null}

              {visibleSettingsNavigation
                .filter((item) => item.href !== "/beallitasok")
                .map((item) => renderItem(item, true))}
            </div>
          </NavigationGroup>
        ) : null}
      </div>
    </nav>
  );

  /*
    SZELESSEG 224PX (`w-56`), A TERV SZERINT (`AppShell.tsx:530,575`) --
    korabban `w-72` (288px). A `w-56` Tailwind-lepcso pontosan 224px
    (14 * 16px), nem kell hozza nyers ertek.
  */
  const sidebar = (mobile = false) => (
    <aside
      data-theme={effectiveTheme}
      className={[
        "font-sans flex h-full w-56 flex-col border-r border-pilot-grey-200 bg-white px-4 py-5 text-pilot-grey-900",
        mobile
          ? "fixed inset-y-0 left-0 z-50 shadow-2xl lg:hidden"
          : "fixed inset-y-0 left-0 z-30 hidden lg:flex",
      ].join(" ")}
    >
      <a href="/" className="mb-8 px-2" aria-label="Acropora OS">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
        <img
          src="/acropora-logo.svg"
          alt=""
          width={112}
          height={40}
          className="h-10 w-auto"
        />
      </a>
      {navigation}
    </aside>
  );

  return (
    <div className="min-h-screen bg-paper">
      {sidebar()}

      {mobileNavigationOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-pilot-black/30 backdrop-blur-[2px] lg:hidden"
            aria-label="Navigáció bezárása"
            onClick={closeMobileNavigation}
          />
          {sidebar(true)}
        </>
      ) : null}

      <div className="lg:pl-56">
        {/*
          MAGASSAG 48PX (`h-12`), A TERV SZERINT (`AppShell.tsx:502`) --
          korabban `h-16` (64px).
        */}
        <header
          data-theme={effectiveTheme}
          className="sticky top-0 z-20 flex h-12 items-center border-b border-pilot-grey-200 bg-white/95 px-4 font-sans backdrop-blur sm:px-6 lg:px-8"
        >
          <div className="flex items-center gap-3 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Navigáció megnyitása"
              onClick={() => setMobileNavigationOpen(true)}
            >
              <Icon name="menu" size={20} />
            </Button>
            <span className="text-sm font-bold text-pilot-grey-900">
              Acropora OS
            </span>
          </div>

          <div className="mx-3 min-w-0 flex-1 lg:mx-auto lg:max-w-xl">
            {session?.token ? <GlobalSearch token={session.token} /> : null}
          </div>

          <div className="ml-auto">
            <UserMenu
              preference={preference}
              onPreferenceChange={setPreference}
            />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
