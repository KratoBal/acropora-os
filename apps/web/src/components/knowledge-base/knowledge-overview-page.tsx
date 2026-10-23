"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  KNOWLEDGE_BASE_PATH,
  KNOWLEDGE_SOURCES_PATH,
} from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type KnowledgeOverview,
  type OverviewStage,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";

/**
 * A TUDÁSBÁZIS ÁTTEKINTŐJE (Research & Knowledge Engine S4; Figma
 * K2d2lES872xzwQHCMVXtam 3:2). A legfontosabb elem a „Rád vár” sáv: innen egy
 * kattintással a következő teendőhöz jut a szerkesztő. Megnyitás-gomb csak
 * oda van, ahol a képernyő már kész (ma a Forrásszűrés); a többi kártya a
 * számot mutatja, link nélkül.
 *
 * Egy kutatási projekt van (a pilot kérdése); kutatási-kérdés modell még
 * nincs, ezért az „Új kutatási kérdés” gomb sincs (mögötte semmi nem állna).
 */
export const STAGE_LABELS: Record<OverviewStage, string> = {
  DISCOVERY: "Felderítés",
  SCREENING: "Szűrés",
  EXTRACTION: "Kiolvasás",
  CHECKING: "Ellenőrzés",
  CONCLUSION: "Következtetés",
  ARTICLE: "Cikk",
};

const STAGE_SENTENCES: Record<OverviewStage, string> = {
  DISCOVERY: "Még nincs forrás: a felderítés indítja a munkát.",
  SCREENING: "A felderített publikációk szűrése folyamatban van.",
  EXTRACTION: "A befogadott publikációk kiolvasása folyamatban van.",
  CHECKING: "A kiolvasott állítások ellenőrzése folyamatban van.",
  CONCLUSION: "Az állítások ellenőrizve: a következtetés következik.",
  ARTICLE: "A cikk következik.",
};

export function KnowledgeOverviewPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setOverview(await knowledgeBaseApi.overview(token, signal));
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError((caught as Error)?.message ?? "Ismeretlen hiba.");
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <Alert
          variant="danger"
          title="Nincs jogosultság"
          description="A Tudásbázishoz knowledge.view jog kell."
        />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title={overview?.question ?? "Tudásbázis"}
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_BASE_PATH} />

      {error ? (
        <Alert
          variant="danger"
          title="Az áttekintő nem tölthető be"
          description={error}
          action={
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => void load()}
            >
              Újra
            </PilotButton>
          }
        />
      ) : overview === null ? (
        <div role="status" aria-label="Betöltés" className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="rad-var">
            <h2
              id="rad-var"
              className="text-xl font-semibold text-pilot-grey-900"
            >
              Rád vár
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <WaitingCard
                label="Forrás szűrésre"
                value={overview.waiting.sourcesToScreen}
                href={KNOWLEDGE_SOURCES_PATH}
              />
              <WaitingCard
                label="Állítás ellenőrzésre"
                value={overview.waiting.claimsToCheck}
              />
              <WaitingCard
                label="Probléma döntésre"
                value={overview.waiting.problems}
                warm
              />
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="projektek">
            <h2
              id="projektek"
              className="text-xl font-semibold text-pilot-grey-900"
            >
              Kutatási projektek
            </h2>
            <PilotCard className="space-y-4 p-5">
              <h3 className="text-lg font-semibold text-pilot-grey-900">
                {overview.question}
              </h3>
              <PilotBadge variant="amber">
                {STAGE_LABELS[overview.project.stage]}
              </PilotBadge>
              <p className="text-[15px] text-pilot-grey-800">
                {STAGE_SENTENCES[overview.project.stage]}
              </p>
              <dl className="grid gap-4 border-t border-pilot-grey-200 pt-4 sm:grid-cols-4">
                <Figure label="Források" value={overview.project.sources} />
                <Figure label="Befogadva" value={overview.project.included} />
                <Figure
                  label="Elfogadott állítás"
                  value={overview.project.acceptedClaims}
                />
                <Figure
                  label="Nyitott ellenőrzés"
                  value={overview.project.openChecks}
                />
              </dl>
            </PilotCard>
          </section>

          <PilotCard className="space-y-4 p-5">
            <h2 className="text-lg font-semibold text-pilot-grey-900">
              Kutatási folyamat
            </h2>
            <ol aria-label="Kutatási folyamat" className="flex flex-wrap gap-3">
              {overview.stages.map((stage) => (
                <li key={stage.key} data-state={stage.state}>
                  <PilotBadge
                    variant={
                      stage.state === "DONE"
                        ? "success"
                        : stage.state === "ACTIVE"
                          ? "amber"
                          : "grey"
                    }
                  >
                    {STAGE_LABELS[stage.key]}
                    <span className="sr-only">
                      {stage.state === "DONE"
                        ? " (kész)"
                        : stage.state === "ACTIVE"
                          ? " (folyamatban)"
                          : " (még nem kezdődött)"}
                    </span>
                  </PilotBadge>
                </li>
              ))}
            </ol>
          </PilotCard>
        </>
      )}

      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function WaitingCard({
  label,
  value,
  href,
  warm = false,
}: {
  label: string;
  value: number;
  href?: string;
  warm?: boolean;
}) {
  return (
    <PilotCard
      className={`flex items-end justify-between gap-4 p-5 ${warm ? "bg-pilot-accent-warm-soft" : ""}`}
    >
      <div>
        <p className="text-sm text-pilot-grey-600">{label}</p>
        <p className="mt-2 text-[32px] font-semibold leading-none text-pilot-grey-900">
          {value.toLocaleString("hu-HU")}
        </p>
      </div>
      {href ? (
        <Link
          href={href}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
        >
          Megnyitás →
        </Link>
      ) : null}
    </PilotCard>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-pilot-grey-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-pilot-grey-900">
        {value.toLocaleString("hu-HU")}
      </dd>
    </div>
  );
}
