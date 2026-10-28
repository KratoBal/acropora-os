"use client";
import { PilotBadge, PilotLinkTabs } from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
} from "@acropora/types";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import {
  KNOWLEDGE_BASE_PATH,
  KNOWLEDGE_CLAIMS_PATH,
  KNOWLEDGE_CONCLUSIONS_PATH,
  KNOWLEDGE_GOLD_SET_PATH,
  KNOWLEDGE_RESEARCH_PATH,
  KNOWLEDGE_SOURCES_PATH,
  KNOWLEDGE_STORE_PATH,
  KNOWLEDGE_VOCABULARY_PATH,
} from "@/components/navigation";

/**
 * A TUDÁSBÁZIS FÜLEI (a Figma-terv bal oldali modul-menüje: Áttekintő,
 * Források, Kiolvasás, Állítás-tár, ...). Csak a KÉSZ képernyő kerül ide:
 * egy fül, ami nem visz sehova, rosszabb a hiányánál. Egy fülnél nincs mit
 * váltani, ezért akkor a sor nem rajzolódik (a Beszerzés mintája).
 */
const KNOWLEDGE_TABS: ReadonlyArray<{
  href: string;
  label: string;
  /** A tab whose screen needs more than knowledge.view. */
  permission?: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
}> = [
  { href: KNOWLEDGE_BASE_PATH, label: "Áttekintő" },
  { href: KNOWLEDGE_SOURCES_PATH, label: "Források" },
  { href: KNOWLEDGE_CLAIMS_PATH, label: "Kiolvasás" },
  { href: KNOWLEDGE_STORE_PATH, label: "Állítás-tár" },
  { href: KNOWLEDGE_CONCLUSIONS_PATH, label: "Következtetések" },
  { href: KNOWLEDGE_VOCABULARY_PATH, label: "Szótár" },
  { href: KNOWLEDGE_GOLD_SET_PATH, label: "T3 készlet" },
  // every research-draft endpoint asks knowledge.manage
  {
    href: KNOWLEDGE_RESEARCH_PATH,
    label: "AI próba",
    permission: PERMISSIONS.KNOWLEDGE_MANAGE,
  },
];

export function KnowledgeBaseTabs({ active }: { active: string }) {
  const { session } = useAuth();
  const tabs = KNOWLEDGE_TABS.filter((tab) =>
    Boolean(
      session &&
      isNavigationEntryVisible("knowledge-base", session.user) &&
      (!tab.permission || hasPermission(session.user, tab.permission)),
    ),
  ).map((tab) => ({ ...tab, active: tab.href === active }));
  if (tabs.length < 2) return null;
  return (
    <PilotLinkTabs
      label="Tudásbázis oldalai"
      tabs={tabs}
      renderLink={({ href, className, children, ...rest }) => (
        <Link href={href} className={className} {...rest}>
          {children}
        </Link>
      )}
    />
  );
}

/**
 * A NÉGY TUDÁSRÉTEG, MINDENHOL UGYANAZZAL A JELLEL (a szerkesztői felület
 * leírása: „a négy réteg mindenhol ugyanazzal a színnel és ikonnal”). A
 * Figma-terv lábléce; a későbbi képernyők ugyanezt a listát használják.
 */
export const KNOWLEDGE_LAYERS = [
  { key: "SCIENTIFIC", label: "Tudományos", mark: "●", variant: "blue" },
  {
    key: "HOBBY_EXPERIENCE",
    label: "Tapasztalat",
    mark: "◆",
    variant: "default",
  },
  { key: "MANUFACTURER", label: "Gyártói", mark: "■", variant: "success" },
  {
    key: "OWN_CONCLUSION",
    label: "Saját következtetés",
    mark: "▲",
    variant: "amber",
  },
] as const;

export function KnowledgeLayerLegend() {
  return (
    <footer className="space-y-2 border-t border-pilot-grey-200 pt-4">
      <p className="text-xs text-pilot-grey-500">
        Szerkesztői pilot · Éles publikálás és vevői AI nélkül
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-pilot-grey-500">
          Tudásréteg
        </span>
        {KNOWLEDGE_LAYERS.map((layer) => (
          <PilotBadge key={layer.key} variant={layer.variant}>
            <span aria-hidden="true">{layer.mark}</span> {layer.label}
          </PilotBadge>
        ))}
      </div>
    </footer>
  );
}
