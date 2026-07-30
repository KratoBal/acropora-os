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
import { hasPermission } from "@acropora/types";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  businessNavigation,
  isNavigationItemActive,
  primaryNavigation,
  secondaryNavigation,
  settingsNavigation,
  unasSettingsNavigation,
  type AppNavigationItem,
} from "./navigation";
import { useAuth } from "./auth/auth-provider";
import { UserMenu } from "./auth/user-menu";

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
          active
            ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80"
            : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
        ].join(" ")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={[
            "text-slate-400 transition-colors group-hover:text-slate-600",
            active ? "text-teal-700" : "",
          ].join(" ")}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={[
            "text-slate-400 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {open ? children : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const canAccess = (item: AppNavigationItem) =>
    Boolean(session && hasPermission(session.user, item.permission));
  const visibleUnasNavigation = unasSettingsNavigation.filter(canAccess);
  const visibleSettingsNavigation = settingsNavigation.filter(canAccess);
  const settingsActive = [
    ...visibleUnasNavigation,
    ...visibleSettingsNavigation,
  ].some((item) => isNavigationItemActive(pathname, item));
  const unasActive = visibleUnasNavigation.some((item) =>
    isNavigationItemActive(pathname, item),
  );

  const navigation = (
    <>
      <div className="space-y-1">
        {primaryNavigation.filter(canAccess).map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<Icon name={item.icon} />}
            active={isNavigationItemActive(pathname, item)}
            badge={
              item.href === "/feladataim" ? (
                <Badge className="px-1.5" variant="neutral">
                  5
                </Badge>
              ) : undefined
            }
            onClick={() => setMobileNavigationOpen(false)}
          />
        ))}
      </div>

      <p className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Működés
      </p>
      <div className="space-y-1">
        {businessNavigation.filter(canAccess).map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<Icon name={item.icon} />}
            active={isNavigationItemActive(pathname, item)}
            onClick={() => setMobileNavigationOpen(false)}
          />
        ))}
      </div>

      <div className="mt-6 space-y-1 border-t border-slate-200 pt-4">
        {secondaryNavigation.filter(canAccess).map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<Icon name={item.icon} />}
            active={isNavigationItemActive(pathname, item)}
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
            <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-2">
              {visibleSettingsNavigation
                .filter((item) => item.href === "/beallitasok")
                .map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={<Icon name={item.icon} />}
                    active={isNavigationItemActive(pathname, item)}
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
                  <div className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-2">
                    {visibleUnasNavigation.map((item) => (
                      <NavItem
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={<Icon name={item.icon} />}
                        active={isNavigationItemActive(pathname, item)}
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
                    active={isNavigationItemActive(pathname, item)}
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
      <span className="flex size-8 items-center justify-center rounded-lg bg-teal-700 text-sm font-black text-white shadow-sm">
        A
      </span>
      <span className="text-[15px] font-bold tracking-tight text-slate-950">
        Acropora <span className="text-teal-700">OS</span>
      </span>
    </a>
  );

  const footer = (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">Rendszerállapot</p>
        <Badge variant="success">Online</Badge>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Minden szolgáltatás elérhető
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar brand={brand} footer={footer}>
        {navigation}
      </Sidebar>

      {mobileNavigationOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px] lg:hidden"
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
              <span className="hidden text-sm font-bold text-slate-900 sm:inline">
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
                className="border-transparent bg-slate-100 shadow-none focus:bg-white"
              />
            </div>
          }
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Értesítések"
                className="relative"
              >
                <Icon name="bell" size={19} />
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-rose-500 ring-2 ring-white" />
              </Button>
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
