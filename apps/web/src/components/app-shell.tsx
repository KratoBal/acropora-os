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
import { useState } from "react";

import {
  businessNavigation,
  primaryNavigation,
  settingsNavigation,
} from "./navigation";
import { useAuth } from "./auth/auth-provider";
import { UserMenu } from "./auth/user-menu";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const navigation = (
    <>
      <div className="space-y-1">
        {primaryNavigation
          .filter(
            (item) => session && hasPermission(session.user, item.permission),
          )
          .map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<Icon name={item.icon} />}
              active={pathname === item.href}
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
        {businessNavigation
          .filter(
            (item) => session && hasPermission(session.user, item.permission),
          )
          .map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<Icon name={item.icon} />}
              active={pathname === item.href}
              onClick={() => setMobileNavigationOpen(false)}
            />
          ))}
      </div>

      <div className="mt-6 space-y-1 border-t border-slate-200 pt-4">
        {settingsNavigation
          .filter(
            (item) => session && hasPermission(session.user, item.permission),
          )
          .map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<Icon name={item.icon} />}
              active={pathname === item.href}
              onClick={() => setMobileNavigationOpen(false)}
            />
          ))}
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
