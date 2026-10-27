"use client";

import { SutyerakWidget } from "./assistant/sutyerak-widget";
import { AssistantPageProvider } from "./assistant/page-context";
import { Badge, Button, Icon, useThemePreference } from "@acropora/ui";
import {
  isNavigationEntryVisible,
  servedNavigationFeatures,
  isNavigationCounterId,
  navigationCounterLabel,
  type NavigationCounterId,
} from "@acropora/types";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";

import {
  allNavigationPages,
  favoritesGroup,
  isNavigationItemActive,
  mainNavigation,
  type AppNavigationGroup,
  type AppNavigationItem,
} from "./navigation";
import { useAuth } from "./auth/auth-provider";
import {
  useMessagesEnabled,
  useMessagesUnread,
} from "./messages/message-stream";
import { UserMenu } from "./auth/user-menu";
import { GlobalSearch } from "./global-search";
import {
  HeaderMessages,
  SidebarProfile,
  type HeaderMessagesProps,
} from "./shell-profile";
import { dashboardApi } from "@/lib/api/dashboard";
import { useFavorites } from "./use-favorites";
import { useNavigationCounters } from "./use-navigation-counters";

/** What the menu number counts, for a screen reader (card 4a6813db). */
const NAVIGATION_COUNTER_ARIA: Record<NavigationCounterId, string> = {
  "service-jobs": "nekem kiosztott, nyitott hibajegy",
  worksheets: "nekem kiosztott, új vagy folyamatban lévő munkalap",
  "material-requests-pending": "teendő anyagigény",
};

interface NavigationGroupProps {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  label: string;
  level?: 0 | 1;
  /** Open from the start even when no page of it is current. */
  defaultOpen?: boolean;
}

function NavigationGroup({
  active,
  children,
  icon,
  label,
  level = 0,
  defaultOpen = false,
}: NavigationGroupProps) {
  const [open, setOpen] = useState(active || defaultOpen);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <div>
      <button
        type="button"
        className={[
          "group flex h-10 w-full items-center gap-2.5 text-sm font-semibold transition-colors",
          level === 1 ? "px-2" : "px-3",
          active
            ? "bg-pilot-aqua-50 text-pilot-aqua-700"
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
        "flex items-center gap-2.5 font-semibold transition-colors",
        nested ? "h-9 px-2 text-[13px]" : "h-10 px-3 text-sm",
        active
          ? "bg-pilot-aqua-50 text-pilot-aqua-700"
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

/**
 * A CSILLAG GOMB "Kedvencekbe" FELIRATTAL (Balázs, 2026-10-27). A keret
 * fejlécében áll, így minden menüpont képernyőjén ott van, oldalankénti
 * bekötés nélkül. A felirat nem változik (a megjelölt állapotot a kitöltött
 * csillag és az `aria-pressed` mondja); keskeny képernyőn csak az ikon látszik,
 * a felirat a képernyőolvasónak megmarad.
 */
function FavoriteButton({
  marked,
  ready,
  failed,
  onToggle,
}: {
  marked: boolean;
  ready: boolean;
  failed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {failed ? (
        <span role="alert" className="text-xs text-pilot-red-700">
          Nem sikerült menteni.
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={marked}
        disabled={!ready}
        title={marked ? "Kivétel a kedvencek közül" : "Kedvencekbe"}
        onClick={onToggle}
      >
        <Icon
          name="star"
          size={16}
          fill={marked ? "currentColor" : "none"}
          className={marked ? "text-pilot-aqua-700" : undefined}
        />
        <span className="sr-only sm:not-sr-only">Kedvencekbe</span>
      </Button>
    </>
  );
}

/** All destinations are needed to resolve overlapping active paths. */
const ALL_NAVIGATION_ITEMS = allNavigationPages;

export function AppShell({
  children,
  messages,
}: {
  children: ReactNode;
  /**
   * The Üzenetek icon in the header. OFF unless given: no caller passes it
   * until the module exists (Figma 441:67 keeps its place).
   */
  messages?: HeaderMessagesProps;
}) {
  const pathname = usePathname();
  const { session } = useAuth();
  const messagesEnabled = useMessagesEnabled();
  const messagesUnread = useMessagesUnread(
    session?.token ?? "",
    messagesEnabled,
  );
  // a fejléc ikonja: ha a hívó nem ad sajátot, a modul a sajátját mutatja
  const headerMessages: HeaderMessagesProps | undefined =
    messages ??
    (messagesEnabled
      ? {
          href: "/uzenetek",
          icon: <Icon name="message" size={16} />,
          unreadCount: messagesUnread,
        }
      : undefined);
  const navigationCounters = useNavigationCounters(
    session?.token ?? "",
    Boolean(session),
  );
  const favorites = useFavorites(session?.token ?? "", Boolean(session));
  const { effectiveTheme, preference, setPreference } = useThemePreference();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [myTaskCount, setMyTaskCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session || !isNavigationEntryVisible("dashboard", session.user)) {
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

  // switch-gated entries follow the menu the server served with the session
  const features = servedNavigationFeatures(session?.navigation);
  const canAccess = (item: AppNavigationItem) =>
    Boolean(
      session && isNavigationEntryVisible(item.entryId, session.user, features),
    );
  const isActive = (item: AppNavigationItem) =>
    isNavigationItemActive(pathname, item, ALL_NAVIGATION_ITEMS);
  const closeMobileNavigation = () => setMobileNavigationOpen(false);
  // a csillag arra a menüpontra szól, amelyiken a néző áll (és amit láthat)
  const currentItem = ALL_NAVIGATION_ITEMS.find(
    (item) => canAccess(item) && isActive(item),
  );
  const favoriteMenu = favoritesGroup(favorites.hrefs, canAccess);

  const renderItem = (item: AppNavigationItem, nested = false) => {
    const count = isNavigationCounterId(item.entryId)
      ? navigationCounters?.[item.entryId]
      : null;
    const label = navigationCounterLabel(count);
    return (
      <NavigationItem
        key={item.href}
        item={item}
        active={isActive(item)}
        nested={nested}
        onChoose={closeMobileNavigation}
        badge={
          label && isNavigationCounterId(item.entryId) ? (
            <Badge
              className="px-1.5"
              variant="warning"
              aria-label={`${count} ${NAVIGATION_COUNTER_ARIA[item.entryId]}`}
            >
              {label}
            </Badge>
          ) : item.href === "/feladataim" ? (
            <Badge className="px-1.5" variant="neutral">
              {myTaskCount ?? "–"}
            </Badge>
          ) : item.href === "/uzenetek" && messagesUnread > 0 ? (
            <Badge
              className="px-1.5"
              variant="warning"
              aria-label={`${messagesUnread} olvasatlan üzenet`}
            >
              {messagesUnread}
            </Badge>
          ) : undefined
        }
      />
    );
  };

  const renderGroup = (entry: AppNavigationGroup) => {
    const visibleChildren = entry.children.filter(canAccess);
    if (visibleChildren.length === 0) return null;
    if (entry.flattenWhenAlone && visibleChildren.length === 1)
      return renderItem(visibleChildren[0]!);

    return (
      <div key={entry.label}>
        <NavigationGroup
          label={entry.label}
          icon={<Icon name={entry.icon} size={18} />}
          active={visibleChildren.some((item) => isActive(item))}
          defaultOpen={entry.defaultOpen}
        >
          <div className="ml-5 mt-1 space-y-1 border-l border-pilot-grey-200 pl-2">
            {visibleChildren.map((item, index) => (
              <Fragment key={item.href}>
                {/*
                  Az alcsoport kis címsora (a Beállításoknál): ahol a sorban
                  az előző LÁTHATÓ tétel más alcsoportban áll, mint ez. Csak
                  megjelenés, nem menüpont.
                */}
                {item.subgroup &&
                item.subgroup !== visibleChildren[index - 1]?.subgroup ? (
                  <p className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-pilot-grey-500">
                    {item.subgroup}
                  </p>
                ) : null}
                {renderItem(item, true)}
              </Fragment>
            ))}
          </div>
        </NavigationGroup>
      </div>
    );
  };

  const navigation = (
    <nav
      aria-label="Fő navigáció"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="space-y-1">
        {/*
          A KEDVENCEK AZ ÁTTEKINTÉS FÖLÖTT áll (Balázs, 2026-10-27), és csak
          akkor látszik, ha van benne elem. Az Áttekintés utána a rögzített
          első főmenü, a többi ABC sorrendben (`mainNavigation`).
        */}
        {favoriteMenu ? renderGroup(favoriteMenu) : null}
        {mainNavigation.map(renderGroup)}
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
      {/*
        A DIRECTION F "OS" JELE A LOGÓ MELLETT (Figma 273:33, "OS Mark": Inter
        12, aqua). A terv szöveges "acropora" feliratot rajzol Belleza betűvel;
        az a betű az OS-ben nincs betöltve, ezért a meglévő logó marad
        (ismert eltérés, a PR-ban megnevezve).
      */}
      <a
        href="/"
        className="mb-8 flex items-center gap-2 px-2"
        aria-label="Acropora OS"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
        <img
          src="/acropora-logo.svg"
          alt=""
          width={112}
          height={40}
          className="h-10 w-auto"
        />
        <span
          aria-hidden="true"
          className="text-xs font-normal leading-4 text-pilot-aqua-700"
        >
          OS
        </span>
      </a>
      {navigation}
      {session ? <SidebarProfile user={session.user} /> : null}
    </aside>
  );

  return (
    <AssistantPageProvider>
      <div className="relative min-h-screen bg-pilot-grey-50">
        {/*
        A SIDEBAR HÁTTERE A DOKUMENTUM TELJES MAGASSÁGÁBAN. A sidebar maga
        `fixed`, tehát görgetésnél mindig kitölti a nézetet; egy teljes oldalas
        képernyőképen viszont csak egy nézetnyi magas, és alatta a tartalom
        háttere látszott (stage, 2026-09-30). Ez a sáv mögötte áll, díszként.
      */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 hidden w-56 border-r border-pilot-grey-200 bg-white lg:block"
        />
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

            <div className="mx-3 min-w-0 flex-1 lg:mx-auto lg:max-w-[480px]">
              {/*
              A MUNKAMENETEN MÚLIK, NEM A TOKENEN. Élesben és a stage-en a
              munkamenet httpOnly süti, a `session.token` üres, és a
              `searchApi` (mint minden hívó) a sütire támaszkodik, ha nincs
              Bearer token. A korábbi `session?.token` feltétel miatt a kereső
              #1156 óta csak a fejlesztői belépésnél látszott (stage-en mérve,
              2026-09-30).
            */}
              {session ? <GlobalSearch token={session.token ?? ""} /> : null}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {currentItem ? (
                <FavoriteButton
                  marked={favorites.isFavorite(currentItem.href)}
                  ready={favorites.ready}
                  failed={favorites.failed}
                  onToggle={() => favorites.toggle(currentItem.href)}
                />
              ) : null}
              {headerMessages ? <HeaderMessages {...headerMessages} /> : null}
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
        <SutyerakWidget />
      </div>
    </AssistantPageProvider>
  );
}
