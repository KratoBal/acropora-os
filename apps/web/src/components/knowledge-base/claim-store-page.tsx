"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_STORE_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type ClaimLayer,
  type ClaimRelation,
  type ClaimStoreDetail,
  type ClaimStoreList,
  type EvidenceLevel,
} from "@/lib/api/knowledge-base";
import { APPLICABILITY_LABELS, FIELD_LABELS } from "./claim-review-page";
import {
  KNOWLEDGE_LAYERS,
  KnowledgeBaseTabs,
  KnowledgeLayerLegend,
} from "./knowledge-base-tabs";
import { STUDY_LABELS } from "./source-screening-page";

/**
 * ÁLLÍTÁS-TÁR (Research & Knowledge Engine S5; Figma K2d2lES872xzwQHCMVXtam
 * 3:229, „Ellenőrzött állítások”). Az ellenőrzött állítások rétegek szerint,
 * mindegyik a címével, a fajával, a forrásával és a bizonyíték-szintjével.
 *
 * Az állításnak NINCS szöveg-oszlopa: a címet a szerver a normalizált
 * mezőkből képzi (hatás, irány, mennyiség), tehát nem térhet el attól, amit a
 * szerkesztő ellenőrzött. A bizonyíték-szint is levezetett (a szabálytábla),
 * nem tárolt. Csak olvasás: a szerkesztés a Kiolvasás fülön történik.
 */
export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  SINGLE_REPORT: "Egyedi beszámoló",
  OBSERVATIONAL: "Megfigyelés",
  SINGLE_EXPERIMENT: "Kontrollált kísérlet",
  CONSISTENT_EXPERIMENTS: "Egybehangzó kísérletek",
};

const STATUS_LABELS: Record<string, string> = {
  CANDIDATE: "Ellenőrzésre vár",
  WITHDRAWN: "Visszavonva",
  DISPUTED: "Vitatott",
  SUPERSEDED: "Felülírva",
};

const STANCE_LABELS: Record<string, string> = {
  SUPPORTS: "Alátámasztja",
  CONTRADICTS: "Ellentmond",
  QUALIFIES: "Árnyalja",
};

/** from: ez az állítás → a másik; to: a másik → ez az állítás. */
const RELATION_LABELS: Record<string, { from: string; to: string }> = {
  CONTRADICTS: { from: "Ellentmond", to: "Ellentmond neki" },
  REFINES: { from: "Pontosítja", to: "Pontosítja ezt" },
  GENERALIZES: { from: "Általánosítja", to: "Általánosítja ezt" },
  DEPENDS_ON: { from: "Erre épül", to: "Ráépül" },
};

const layerOf = (key: string) =>
  KNOWLEDGE_LAYERS.find((l) => l.key === key) ?? KNOWLEDGE_LAYERS[0];

function LayerBadge({ layer }: { layer: string }) {
  const l = layerOf(layer);
  return (
    <PilotBadge variant={l.variant}>
      <span aria-hidden="true">{l.mark}</span> {l.label}
    </PilotBadge>
  );
}

function levelText(level: EvidenceLevel | null) {
  return level ? EVIDENCE_LEVEL_LABELS[level] : "Nem besorolható";
}

function useCanView() {
  const { session } = useAuth();
  return {
    token: session?.token ?? "",
    canView: Boolean(
      session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
    ),
  };
}

function NoPermission() {
  return (
    <PilotThemeRoot className="space-y-6">
      <Alert
        variant="danger"
        title="Nincs jogosultság"
        description="A Tudásbázishoz knowledge.view jog kell."
      />
    </PilotThemeRoot>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title={title}
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_STORE_PATH} />
      {children}
      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function LoadError({
  what,
  error,
  retry,
}: {
  what: string;
  error: string;
  retry: () => void;
}) {
  return (
    <Alert
      variant="danger"
      title={`${what} nem tölthető be`}
      description={error}
      action={
        <PilotButton variant="secondary" size="action" onClick={retry}>
          Újra
        </PilotButton>
      }
    />
  );
}

/** One fetch with abort and retry: the two screens differ only in what they load. */
function useLoad<T>(
  canView: boolean,
  fetcher: (signal?: AbortSignal) => Promise<T>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      setData(null);
      try {
        setData(await fetcher(signal));
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError((caught as Error)?.message ?? "Ismeretlen hiba.");
      }
    },
    [canView, fetcher],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return { data, error, reload: () => void load() };
}

export function ClaimStorePage() {
  const { token, canView } = useCanView();
  const [layer, setLayer] = useState<ClaimLayer | null>(null);
  const fetcher = useCallback(
    (signal?: AbortSignal) => knowledgeBaseApi.claimStore(token, layer, signal),
    [token, layer],
  );
  const { data, error, reload } = useLoad<ClaimStoreList>(canView, fetcher);

  if (!canView) return <NoPermission />;
  return (
    <Shell title="Ellenőrzött állítások">
      <PilotCard className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-pilot-grey-900">
            Állítások · rétegek szerint
          </h2>
          <div
            role="group"
            aria-label="Réteg szűrése"
            className="flex flex-wrap gap-2"
          >
            <FilterButton
              active={layer === null}
              onClick={() => setLayer(null)}
            >
              Mind
            </FilterButton>
            {KNOWLEDGE_LAYERS.map((l) => (
              <FilterButton
                key={l.key}
                active={layer === l.key}
                onClick={() => setLayer(l.key)}
              >
                {l.label}
                {data ? ` (${data.layers[l.key].toLocaleString("hu-HU")})` : ""}
              </FilterButton>
            ))}
          </div>
        </div>

        {error ? (
          <LoadError what="Az állítás-tár" error={error} retry={reload} />
        ) : data === null ? (
          <div role="status" aria-label="Betöltés" className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : data.claims.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-pilot-grey-600">
            {layer === null
              ? "Még nincs ellenőrzött állítás. Az állítás akkor kerül ide, amikor a szerkesztő a Kiolvasás fülön minden mezőjéről döntött."
              : `Ebben a rétegben (${layerOf(layer).label}) még nincs ellenőrzött állítás.`}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-pilot-grey-200">
              {data.claims.map((claim) => (
                <li
                  key={claim.id}
                  className="grid gap-3 py-4 sm:grid-cols-[180px_1fr]"
                >
                  <div>
                    <LayerBadge layer={claim.layer} />
                  </div>
                  <div className="space-y-1">
                    <Link
                      href={`${KNOWLEDGE_STORE_PATH}/${encodeURIComponent(claim.id)}`}
                      className="text-[17px] font-semibold text-pilot-grey-900 hover:underline"
                    >
                      {claim.title}
                    </Link>
                    <p className="text-sm text-pilot-grey-600">
                      {[
                        claim.species.map((s) => s.label).join(", "),
                        ...claim.sources.map((s) =>
                          [s.title, s.year].filter(Boolean).join(", "),
                        ),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="flex flex-wrap gap-2 text-sm text-pilot-grey-600">
                      <PilotBadge variant="grey">
                        {levelText(claim.evidenceLevel.level)}
                      </PilotBadge>
                      {claim.controlled === true ? (
                        <PilotBadge variant="grey">
                          Kontrollcsoporttal
                        </PilotBadge>
                      ) : null}
                      {claim.sampleSize ? (
                        <PilotBadge variant="grey">
                          n = {claim.sampleSize.value}
                          {claim.sampleSize.unit
                            ? ` ${claim.sampleSize.unit}`
                            : ""}
                        </PilotBadge>
                      ) : null}
                      {claim.sources.some((s) => s.retracted) ? (
                        <PilotBadge variant="amber">
                          Visszavont forrás
                        </PilotBadge>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {data.total > data.claims.length ? (
              <p className="text-sm text-pilot-grey-600">
                Az első {data.claims.length.toLocaleString("hu-HU")} látszik a{" "}
                {data.total.toLocaleString("hu-HU")} állításból.
              </p>
            ) : null}
          </>
        )}
      </PilotCard>
    </Shell>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <PilotButton
      variant={active ? "primary" : "secondary"}
      size="action"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </PilotButton>
  );
}

export function ClaimDetailPage({ claimId }: { claimId: string }) {
  const { token, canView } = useCanView();
  const fetcher = useCallback(
    (signal?: AbortSignal) =>
      knowledgeBaseApi.claimDetail(token, claimId, signal),
    [token, claimId],
  );
  const { data, error, reload } = useLoad<ClaimStoreDetail>(canView, fetcher);

  if (!canView) return <NoPermission />;
  return (
    <Shell title={data?.title ?? "Állítás"}>
      <Link
        href={KNOWLEDGE_STORE_PATH}
        className="text-sm font-medium text-pilot-grey-700 hover:underline"
      >
        ← Vissza az állítás-tárba
      </Link>
      {error ? (
        <LoadError what="Az állítás" error={error} retry={reload} />
      ) : data === null ? (
        <div role="status" aria-label="Betöltés" className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <PilotCard className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              <LayerBadge layer={data.layer} />
              {data.status !== "VERIFIED" ? (
                <PilotBadge variant="amber">
                  {STATUS_LABELS[data.status] ?? "Nem ellenőrzött"}
                </PilotBadge>
              ) : null}
              <PilotBadge variant="grey">{data.revision}. változat</PilotBadge>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Hatás" value={data.effect?.label ?? "Nincs"} />
              <Fact label="Mennyiség" value={data.quantity ?? "Nem közölt"} />
              <Fact
                label="Faj"
                value={data.species.map((s) => s.label).join(", ") || "Nincs"}
              />
              <Fact
                label="Bizonyíték-szint"
                value={levelText(data.evidenceLevel.level)}
              />
            </dl>
            <p className="text-xs text-pilot-grey-500">
              A cím a normalizált mezőkből képzett, a bizonyíték-szint a
              szabálytáblából levezetett ({data.evidenceLevel.rulesVersion}).
            </p>
          </PilotCard>

          {data.status === "VERIFIED" ? (
            <WithdrawPanel claimId={data.id} onDone={reload} />
          ) : null}

          <section className="space-y-3" aria-labelledby="bizonyitekok">
            <h2
              id="bizonyitekok"
              className="text-xl font-semibold text-pilot-grey-900"
            >
              Bizonyítékok ({data.evidence.length})
            </h2>
            {data.evidence.map((e) => (
              <PilotCard key={e.id} className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <PilotBadge
                    variant={e.stance === "CONTRADICTS" ? "amber" : "grey"}
                  >
                    {STANCE_LABELS[e.stance] ?? e.stance}
                  </PilotBadge>
                  <span className="font-semibold text-pilot-grey-900">
                    {[e.source.title, e.source.year].filter(Boolean).join(", ")}
                  </span>
                  {e.source.retracted ? (
                    <PilotBadge variant="amber">Visszavont forrás</PilotBadge>
                  ) : null}
                </div>
                <p className="text-sm text-pilot-grey-600">
                  {[
                    e.source.studyType
                      ? (STUDY_LABELS[e.source.studyType] ?? e.source.studyType)
                      : "Vizsgálattípus nélkül",
                    e.source.controlled === true
                      ? "kontrollcsoporttal"
                      : e.source.controlled === false
                        ? "kontrollcsoport nélkül"
                        : null,
                    e.sampleSize
                      ? `n = ${e.sampleSize.value}${e.sampleSize.unit ? ` ${e.sampleSize.unit}` : ""}`
                      : null,
                    e.environment?.label,
                    e.source.doi ? `DOI ${e.source.doi}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <blockquote className="border-l-4 border-pilot-grey-200 pl-3 text-[15px] text-pilot-grey-800">
                  {e.passage.text}
                  <footer className="mt-1 text-xs text-pilot-grey-500">
                    {e.passage.locator}
                    {e.passage.verifiedVerbatim
                      ? " · szó szerint igazolva"
                      : " · szó szerinti egyezés nincs igazolva"}
                  </footer>
                </blockquote>
                {e.uncertainty || e.conditions || e.applicability ? (
                  <dl className="grid gap-3 sm:grid-cols-3">
                    {e.uncertainty ? (
                      <Fact label="Bizonytalanság" value={e.uncertainty} />
                    ) : null}
                    {e.conditions ? (
                      <Fact label="Feltételek" value={e.conditions} />
                    ) : null}
                    {e.applicability ? (
                      <Fact
                        label="Otthoni zátonyra"
                        value={`${APPLICABILITY_LABELS[e.applicability.value]}${e.applicability.reason ? `: ${e.applicability.reason}` : ""}`}
                      />
                    ) : null}
                  </dl>
                ) : null}
                {e.anchors.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-pilot-grey-700">
                      Mezők horgonyai ({e.anchors.length})
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {e.anchors.map((a, i) => (
                        <li key={`${a.field}-${i}`} className="text-sm">
                          <span className="font-medium text-pilot-grey-900">
                            {FIELD_LABELS[a.field] ?? a.field}
                          </span>
                          {a.decision === "CORRECTED" ? " (javítva)" : ""}:{" "}
                          <span className="text-pilot-grey-600">
                            „{a.passage.text}” ({a.passage.locator})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </PilotCard>
            ))}
          </section>

          <section className="space-y-3" aria-labelledby="kapcsolatok">
            <h2
              id="kapcsolatok"
              className="text-xl font-semibold text-pilot-grey-900"
            >
              Kapcsolatok
            </h2>
            {data.relationsFrom.length + data.relationsTo.length === 0 ? (
              <p className="text-[15px] text-pilot-grey-600">
                Más állítással nincs rögzített kapcsolata.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.relationsFrom.map((r, i) => (
                  <RelationRow key={`f-${i}`} relation={r} side="from" />
                ))}
                {data.relationsTo.map((r, i) => (
                  <RelationRow key={`t-${i}`} relation={r} side="to" />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

/**
 * ÁLLÍTÁS VISSZAVONÁSA (acrobot 35960): egy tévedésből elfogadott, ellenőrzött
 * állítás visszavonható, kötelező indokkal. Az állítás a tárból és minden
 * ellenőrzött állításra épülő következtetésből kiesik; a mezők döntései
 * megmaradnak, mint a tévedés története. Csak knowledge.manage joggal.
 */
function WithdrawPanel({
  claimId,
  onDone,
}: {
  claimId: string;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!canManage || !session) return null;

  const withdraw = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await knowledgeBaseApi.withdrawClaim(
        session.token,
        claimId,
        reason.trim(),
      );
      onDone();
    } catch (caught) {
      setFailure((caught as Error)?.message ?? "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotCard className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pilot-grey-600">
          Tévedésből elfogadott állítás? A visszavont állítás kikerül a tárból
          és a következtetésekből.
        </p>
        <PilotButton
          variant="ghost"
          size="action"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
        >
          Állítás visszavonása
        </PilotButton>
      </div>
      {open ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md bg-pilot-grey-50 p-3">
          <label className="min-w-64 flex-1 space-y-1 text-sm text-pilot-grey-700">
            <span>Miért hibás az állítás? (kötelező)</span>
            <PilotInput
              aria-label="Visszavonás oka"
              value={reason}
              onChange={setReason}
            />
          </label>
          <PilotButton
            variant="danger"
            size="action"
            disabled={busy || !reason.trim()}
            onClick={() => void withdraw()}
          >
            Visszavonás mentése
          </PilotButton>
        </div>
      ) : null}
      {failure ? (
        <Alert
          variant="danger"
          title="A visszavonás nem sikerült"
          description={failure}
        />
      ) : null}
    </PilotCard>
  );
}

function RelationRow({
  relation,
  side,
}: {
  relation: ClaimRelation;
  side: "from" | "to";
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-[15px]">
      <PilotBadge variant={relation.kind === "CONTRADICTS" ? "amber" : "grey"}>
        {RELATION_LABELS[relation.kind]?.[side] ?? relation.kind}
      </PilotBadge>
      <Link
        href={`${KNOWLEDGE_STORE_PATH}/${encodeURIComponent(relation.claim.id)}`}
        className="font-medium text-pilot-grey-900 hover:underline"
      >
        {relation.claim.title}
      </Link>
      <LayerBadge layer={relation.claim.layer} />
      {relation.note ? (
        <span className="text-sm text-pilot-grey-600">{relation.note}</span>
      ) : null}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-pilot-grey-600">{label}</dt>
      <dd className="mt-1 text-[15px] font-medium text-pilot-grey-900">
        {value}
      </dd>
    </div>
  );
}
