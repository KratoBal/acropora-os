"use client";

import { plainText } from "@/lib/format/plain-text";
import {
  Alert,
  ConfirmDialog,
  Pagination,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
  PilotFileInput,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS, uploadAccept } from "@acropora/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_SOURCES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type BulkScreeningInput,
  type BulkScreeningResult,
  type ExclusionReason,
  type KnowledgeSourceList,
  type KnowledgeSourceRow,
  type ScreeningDecisionInput,
  type ScreeningSummary,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";

/**
 * FORRÁSSZŰRÉS (Research & Knowledge Engine S4; Figma K2d2lES872xzwQHCMVXtam
 * 3:68, „Szakirodalmi források”). A felderítés (S2) forrásairól a szakmai
 * szerkesztő dönt: befogad, vagy kizár okkal. Gyors, sorozatos munka, ezért
 * billentyűvel is megy: ↓/J következő, ↑/K előző, B befogad, X kizár.
 *
 * TÖMEGES DÖNTÉS (Picasso 3.26-b): a döntésre váró sor jelölhető (szóközzel is), az
 * oldal egyben, vagy a szűrt lista minden döntésre váró sora, minden oldalról. A
 * kijelöltekre egy Befogad vagy egy Kizár (egy okkal) megy, megerősítés után; a
 * soronkénti gombok maradnak. Ami közben döntést kapott, nem íródik felül: a
 * válasz megmondja, hány ilyen volt.
 *
 * A terv „AI: releváns” jelvénye NEM látszik: a gépi szűrési javaslat még nem
 * létezik (a terv 7. pontja szerint a modell javasol, de ezt egy későbbi
 * szelet adja); egy kitalált jelvény rosszabb a hiányánál.
 */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  NOT_MARINE: "Nem tengeri",
  NOT_CORAL: "Nem korall",
  NOT_RELEVANT: "Nem releváns",
  DUPLICATE: "Duplikátum",
  OTHER: "Egyéb",
};

const KIND_LABELS: Record<string, string> = {
  PEER_REVIEWED: "Szakcikk",
  PREPRINT: "Preprint",
  REVIEW: "Áttekintés",
  BOOK: "Könyv",
  MANUFACTURER: "Gyártói anyag",
  HOBBY_ARTICLE: "Akvarisztikai cikk",
  FORUM: "Fórum",
  OWN_DATA: "Saját mérés",
};

export const STUDY_LABELS: Record<string, string> = {
  CONTROLLED_LAB: "Kísérlet",
  MESOCOSM: "Mezokozmosz",
  FIELD_EXPERIMENT: "Terepi kísérlet",
  FIELD_OBSERVATIONAL: "Terepi",
  AQUARIUM_CASE: "Akvarisztikai beszámoló",
  AQUARIUM_SURVEY: "Akvarisztikai felmérés",
  REVIEW: "Áttekintés",
  META_ANALYSIS: "Metaanalízis",
  MANUFACTURER: "Gyártói anyag",
  OWN_MEASUREMENT: "Saját mérés",
  MODELLING: "Modell-szimuláció",
};

/**
 * A „Nem lett új forrás” szám NEM duplikátum-szám (barracuda, #1841): a
 * felderítés találatai közül mindaz, amiből nem lett új forrás-sor. A futások
 * ma nem tárolják külön az okokat, ezért a szám az összeg, és így is nevezzük.
 */
const NOT_NEW_HINT =
  "A felderítés találatai, amelyekből nem lett új forrás: ismétlődés (több lekérdezés, több adatbázis vagy egy korábbi futás ugyanazt a művet hozta), nem tárolható találat (ellenőrizetlen DOI, ellentmondó azonosító) és kihagyott rekord. Nem csak duplikátum.";

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Döntésre vár" },
  { value: "INCLUDED", label: "Befogadva" },
  { value: "EXCLUDED", label: "Kizárva" },
  { value: "ALL", label: "Mind" },
] as const;

const LIST_TITLES: Record<string, string> = {
  PENDING: "Döntésre váró publikációk",
  INCLUDED: "Befogadott publikációk",
  EXCLUDED: "Kizárt publikációk",
  ALL: "Minden publikáció",
};

/** What a bulk decision did, in one line: the decided, and what was left as it was. */
export function bulkResultText(result: BulkScreeningResult): string {
  return [
    `${result.decided} forrás döntése mentve.`,
    result.notPending
      ? `${result.notPending} közben már döntést kapott, az változatlan maradt.`
      : null,
    result.missing ? `${result.missing} forrás már nem létezik.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Az a sor egy mondatban, ami a cím alatt áll: év · típus · hozzáférés. */
export function sourceMeta(row: KnowledgeSourceRow): string {
  const type =
    (row.studyType && STUDY_LABELS[row.studyType]) ??
    KIND_LABELS[row.kind] ??
    row.kind;
  const access = !row.openAccess
    ? "Teljes szöveg nélkül"
    : row.licence === "UNKNOWN"
      ? "Nyílt hozzáférés · Licenc ellenőrzendő"
      : `Nyílt hozzáférés · ${row.licence}`;
  return [row.year ?? "év nélkül", type, access].join(" · ");
}

interface Filters {
  status: string;
  kind: string;
  yearFrom: string;
  yearTo: string;
  openAccess: string;
}

const EMPTY_FILTERS: Filters = {
  status: "PENDING",
  kind: "",
  yearFrom: "",
  yearTo: "",
  openAccess: "",
};

export function SourceScreeningPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  // the editor's manual PDF starts an extraction run: the run's own permission (research-kezi-pdf)
  const canReadPdf = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_RESEARCH_RUN),
  );
  const canDecide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<KnowledgeSourceList | null>(null);
  const [summary, setSummary] = useState<ScreeningSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [excluding, setExcluding] = useState<string | null>(null);
  const [reason, setReason] = useState<ExclusionReason>("NOT_RELEVANT");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [bulkExcluding, setBulkExcluding] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"INCLUDE" | "EXCLUDE" | null>(
    null,
  );
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("status", filters.status);
    if (filters.kind) p.set("kind", filters.kind);
    if (filters.yearFrom) p.set("yearFrom", filters.yearFrom);
    if (filters.yearTo) p.set("yearTo", filters.yearTo);
    if (filters.openAccess) p.set("openAccess", filters.openAccess);
    p.set("page", String(page));
    return p;
  }, [filters, page]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        const [nextList, nextSummary] = await Promise.all([
          knowledgeBaseApi.sources(token, params, signal),
          knowledgeBaseApi.screeningSummary(token, signal),
        ]);
        setList(nextList);
        setSummary(nextSummary);
        setSelected((current) =>
          Math.min(current, Math.max(0, nextList.items.length - 1)),
        );
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError((caught as Error)?.message ?? "Ismeretlen hiba.");
      }
    },
    [canView, token, params],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = async (
    row: KnowledgeSourceRow,
    input: ScreeningDecisionInput,
  ) => {
    setBusy(row.id);
    setActionError(null);
    try {
      await knowledgeBaseApi.screen(token, row.id, input);
      setExcluding(null);
      setNote("");
      // decided on its row: no longer one the bulk decision would take
      setChecked((current) => without(current, [row.id]));
      await load();
    } catch (caught) {
      setActionError((caught as Error)?.message ?? "Ismeretlen hiba.");
    } finally {
      setBusy(null);
    }
  };

  const selectAll = async () => {
    setActionError(null);
    setBulkNotice(null);
    try {
      const all = new URLSearchParams(params);
      all.delete("page");
      const result = await knowledgeBaseApi.pendingSourceIds(token, all);
      setChecked(new Set(result.ids));
      if (result.total > result.ids.length)
        setBulkNotice(
          `A szűrt listán ${result.total} döntésre váró forrás van; egyszerre ${result.ids.length} jelölhető ki.`,
        );
    } catch (caught) {
      setActionError((caught as Error)?.message ?? "Ismeretlen hiba.");
    }
  };

  const decideMany = async () => {
    if (!bulkConfirm) return;
    const decision: Exclude<ScreeningDecisionInput, { decision: "RESET" }> =
      bulkConfirm === "INCLUDE"
        ? { decision: "INCLUDE" }
        : {
            decision: "EXCLUDE",
            reason,
            ...(note.trim() ? { note: note.trim() } : {}),
          };
    setBusy("bulk");
    setActionError(null);
    try {
      const input: BulkScreeningInput = { ...decision, ids: [...checked] };
      const result = await knowledgeBaseApi.screenMany(token, input);
      setChecked(new Set());
      setBulkExcluding(false);
      setNote("");
      setBulkNotice(bulkResultText(result));
      await load();
    } catch (caught) {
      setActionError((caught as Error)?.message ?? "Ismeretlen hiba.");
    } finally {
      setBusy(null);
      setBulkConfirm(null);
    }
  };

  const items = list?.items ?? [];
  const pendingOnPage = items.filter((r) => r.screening.status === "PENDING");
  const pageAllChecked =
    pendingOnPage.length > 0 && pendingOnPage.every((r) => checked.has(r.id));
  const toggle = (id: string) =>
    setChecked((current) =>
      current.has(id) ? without(current, [id]) : new Set([...current, id]),
    );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const row = items[selected];
    const key = event.key.toLowerCase();
    if (key === "arrowdown" || key === "j") {
      setSelected((s) => Math.min(s + 1, Math.max(0, items.length - 1)));
      event.preventDefault();
    } else if (key === "arrowup" || key === "k") {
      setSelected((s) => Math.max(s - 1, 0));
      event.preventDefault();
    } else if (canDecide && row && busy === null && key === "b") {
      void decide(row, { decision: "INCLUDE" });
      event.preventDefault();
    } else if (canDecide && row && key === "x") {
      setExcluding(row.id);
      event.preventDefault();
    } else if (
      canDecide &&
      row?.screening.status === "PENDING" &&
      event.key === " "
    ) {
      toggle(row.id);
      event.preventDefault();
    }
  };

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

  const totalPages = list
    ? Math.max(1, Math.ceil(list.total / list.pageSize))
    : 1;
  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelected(0);
    // a selection belongs to the list it was made on
    setChecked(new Set());
    setBulkExcluding(false);
    setBulkNotice(null);
  };

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="Szakirodalmi források"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_SOURCES_PATH} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        {summary ? (
          <dl
            aria-label="Szűrési napló"
            className="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-pilot-grey-600"
          >
            <SummaryItem label="Talált" value={summary.identified} />
            <SummaryItem
              label="Nem lett új forrás"
              value={summary.notNew}
              title={NOT_NEW_HINT}
            />
            <SummaryItem label="Döntésre vár" value={summary.pending} />
            <SummaryItem
              label="Kizárt"
              value={summary.excluded}
              title={(Object.keys(EXCLUSION_REASON_LABELS) as ExclusionReason[])
                .map(
                  (r) =>
                    `${EXCLUSION_REASON_LABELS[r]}: ${summary.excludedByReason[r]}`,
                )
                .join(", ")}
            />
            <SummaryItem label="Befogadott" value={summary.included} />
          </dl>
        ) : (
          <Skeleton className="h-6 w-96" />
        )}
        <PilotButton
          variant="secondary"
          size="action"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}
        >
          Szűrők
        </PilotButton>
      </div>

      {showFilters ? (
        <PilotCard className="flex flex-wrap items-end gap-4 p-4">
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Állapot</span>
            <PilotSelect
              aria-label="Állapot"
              value={filters.status}
              onChange={(v) => setFilter("status", v)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </PilotSelect>
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Típus</span>
            <PilotSelect
              aria-label="Típus"
              value={filters.kind}
              onChange={(v) => setFilter("kind", v)}
            >
              <option value="">Mind</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </PilotSelect>
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Évtől</span>
            <PilotInput
              aria-label="Évtől"
              inputMode="numeric"
              value={filters.yearFrom}
              onChange={(v) =>
                setFilter("yearFrom", v.replace(/\D/g, "").slice(0, 4))
              }
            />
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Évig</span>
            <PilotInput
              aria-label="Évig"
              inputMode="numeric"
              value={filters.yearTo}
              onChange={(v) =>
                setFilter("yearTo", v.replace(/\D/g, "").slice(0, 4))
              }
            />
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Hozzáférés</span>
            <PilotSelect
              aria-label="Hozzáférés"
              value={filters.openAccess}
              onChange={(v) => setFilter("openAccess", v)}
            >
              <option value="">Mind</option>
              <option value="true">Nyílt hozzáférés</option>
              <option value="false">Teljes szöveg nélkül</option>
            </PilotSelect>
          </label>
        </PilotCard>
      ) : null}

      {actionError ? (
        <Alert
          variant="danger"
          title="A döntés nem mentődött"
          description={actionError}
        />
      ) : null}
      {bulkNotice ? (
        <p role="status" className="text-sm text-pilot-grey-700">
          {bulkNotice}
        </p>
      ) : null}

      <ConfirmDialog
        open={bulkConfirm !== null}
        title={
          bulkConfirm === "INCLUDE"
            ? `${checked.size} forrás befogadása?`
            : `${checked.size} forrás kizárása?`
        }
        consequence={
          bulkConfirm === "INCLUDE"
            ? "A kijelölt, döntésre váró források befogadottak lesznek, a te nevedben. Ami közben döntést kapott, változatlan marad."
            : `A kijelölt, döntésre váró források kizártak lesznek, ezzel az okkal: ${EXCLUSION_REASON_LABELS[reason]}. Ami közben döntést kapott, változatlan marad.`
        }
        recovery="Egy forrás döntése a során vonható vissza (Döntés visszavonása); tömegesen nem."
        confirmLabel={
          bulkConfirm === "INCLUDE"
            ? `${checked.size} befogadása`
            : `${checked.size} kizárása`
        }
        busy={busy === "bulk"}
        onConfirm={() => void decideMany()}
        onCancel={() => setBulkConfirm(null)}
      />

      <PilotCard className="p-5">
        <h2 className="text-lg font-semibold text-pilot-grey-900">
          {LIST_TITLES[filters.status]}
        </h2>
        {canDecide && items.length ? (
          <p className="mt-1 text-xs text-pilot-grey-500">
            Billentyűvel: ↓ vagy J következő, ↑ vagy K előző, B befogad, X
            kizár, szóköz kijelöl.
          </p>
        ) : null}
        {canDecide && (pendingOnPage.length > 0 || checked.size > 0) ? (
          <div
            aria-label="Tömeges döntés"
            className="mt-3 space-y-3 rounded-md bg-pilot-grey-50 p-3 text-sm text-pilot-grey-700"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Az oldal döntésre váró sorainak kijelölése"
                  checked={pageAllChecked}
                  disabled={pendingOnPage.length === 0}
                  onChange={() =>
                    setChecked((current) =>
                      pageAllChecked
                        ? without(
                            current,
                            pendingOnPage.map((r) => r.id),
                          )
                        : new Set([
                            ...current,
                            ...pendingOnPage.map((r) => r.id),
                          ]),
                    )
                  }
                />
                <span>Az oldal</span>
              </label>
              <PilotButton
                variant="ghost"
                size="action"
                disabled={busy !== null}
                onClick={() => void selectAll()}
              >
                Mind kijelölése a szűrt listán
              </PilotButton>
              {checked.size > 0 ? (
                <>
                  <span className="font-medium text-pilot-grey-900">
                    {checked.size} kijelölve
                  </span>
                  <PilotButton
                    size="action"
                    disabled={busy !== null}
                    onClick={() => setBulkConfirm("INCLUDE")}
                  >
                    {`Befogad (${checked.size})`}
                  </PilotButton>
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={busy !== null}
                    onClick={() => {
                      setExcluding(null);
                      setBulkExcluding(true);
                    }}
                  >
                    {`Kizár (${checked.size})`}
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    size="action"
                    onClick={() => {
                      setChecked(new Set());
                      setBulkExcluding(false);
                    }}
                  >
                    Kijelölés törlése
                  </PilotButton>
                </>
              ) : null}
            </div>
            {bulkExcluding && checked.size > 0 ? (
              <ExclusionForm
                reason={reason}
                note={note}
                busy={busy !== null}
                saveLabel={`Kizárás mentése (${checked.size})`}
                onReason={setReason}
                onNote={setNote}
                onSave={() => setBulkConfirm("EXCLUDE")}
                onCancel={() => setBulkExcluding(false)}
              />
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4">
            <Alert
              variant="danger"
              title="A források nem tölthetők be"
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
          </div>
        ) : list === null ? (
          <p role="status" className="mt-4 text-sm text-pilot-grey-500">
            Betöltés…
          </p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-pilot-grey-500">
            {summary && summary.unique === 0
              ? "Még nincs forrás: indíts felderítést (knowledge:discover vagy a felderítő végpont)."
              : "Ezekkel a szűrőkkel nincs forrás."}
          </p>
        ) : (
          <div
            ref={listRef}
            tabIndex={0}
            role="list"
            aria-label={LIST_TITLES[filters.status]}
            onKeyDown={onKeyDown}
            className="mt-2 outline-none"
          >
            {items.map((row, index) => (
              <SourceItem
                key={row.id}
                row={row}
                selected={index === selected}
                onSelect={() => setSelected(index)}
                checked={checked.has(row.id)}
                onCheck={() => toggle(row.id)}
                canDecide={canDecide}
                canReadPdf={canReadPdf}
                token={token}
                busy={busy !== null}
                excluding={excluding === row.id}
                reason={reason}
                note={note}
                onReason={setReason}
                onNote={setNote}
                onInclude={() => void decide(row, { decision: "INCLUDE" })}
                onExclude={() => {
                  setBulkExcluding(false);
                  setExcluding(row.id);
                }}
                onCancelExclude={() => setExcluding(null)}
                onConfirmExclude={() =>
                  void decide(row, {
                    decision: "EXCLUDE",
                    reason,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  })
                }
                onReset={() => void decide(row, { decision: "RESET" })}
                onClassified={() => void load()}
              />
            ))}
          </div>
        )}
        {list && totalPages > 1 ? (
          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            onPageChange={(p) => {
              setPage(p);
              setSelected(0);
            }}
          />
        ) : null}
      </PilotCard>

      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function without(set: ReadonlySet<string>, ids: readonly string[]) {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/** The exclusion's reason and note: one row's, or the selection's (Picasso 3.26-b). */
function ExclusionForm(props: {
  reason: ExclusionReason;
  note: string;
  busy: boolean;
  saveLabel: string;
  onReason: (r: ExclusionReason) => void;
  onNote: (n: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const noteMissing = props.reason === "OTHER" && !props.note.trim();
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md bg-pilot-grey-50 p-3">
      <label className="space-y-1 text-sm text-pilot-grey-700">
        <span>Kizárás oka</span>
        <PilotSelect
          aria-label="Kizárás oka"
          value={props.reason}
          onChange={(v) => props.onReason(v as ExclusionReason)}
        >
          {(Object.keys(EXCLUSION_REASON_LABELS) as ExclusionReason[]).map(
            (r) => (
              <option key={r} value={r}>
                {EXCLUSION_REASON_LABELS[r]}
              </option>
            ),
          )}
        </PilotSelect>
      </label>
      <label className="min-w-64 flex-1 space-y-1 text-sm text-pilot-grey-700">
        <span>Megjegyzés{props.reason === "OTHER" ? " (kötelező)" : ""}</span>
        <PilotInput
          aria-label="Megjegyzés"
          value={props.note}
          onChange={props.onNote}
        />
      </label>
      <PilotButton
        size="action"
        disabled={props.busy || noteMissing}
        onClick={props.onSave}
      >
        {props.saveLabel}
      </PilotButton>
      <PilotButton variant="ghost" size="action" onClick={props.onCancel}>
        Mégse
      </PilotButton>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title?: string;
}) {
  return (
    <div className="flex gap-1.5" title={title}>
      <dt>{label}:</dt>
      <dd className="font-medium text-pilot-grey-800">
        {value.toLocaleString("hu-HU")}
      </dd>
    </div>
  );
}

/**
 * THE EDITOR'S PDF OF A WORK WITH NO OPEN TEXT (research-kezi-pdf; plan v4, S3). Offered on an included source whose text
 * was never read; the upload starts an extraction run of its own, and the claims come on the Kiolvasás tab. The PDF is read
 * and dropped: only its fingerprint stays.
 */
function ManualPdfUpload({
  sourceId,
  token,
}: {
  sourceId: string;
  token: string;
}) {
  const [state, setState] = useState<{
    kind: "idle" | "busy" | "ok" | "error";
    text?: string;
  }>({ kind: "idle" });
  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-1"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="text-[13px] font-semibold text-pilot-grey-700">
        Kézi PDF a kiolvasáshoz
        <PilotFileInput
          accept={uploadAccept(["pdf"])}
          className="ml-2 text-[13px]"
          disabled={state.kind === "busy" || state.kind === "ok"}
          data-testid={`manual-pdf-${sourceId}`}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setState({ kind: "busy" });
            try {
              await knowledgeBaseApi.uploadManualPdf(token, sourceId, file);
              setState({
                kind: "ok",
                text: "A kiolvasás elindult; az állítások a Kiolvasás fülön jelennek meg.",
              });
            } catch (caught) {
              setState({
                kind: "error",
                text: (caught as Error)?.message ?? "A feltöltés nem sikerült.",
              });
            }
          }}
        />
      </label>
      {state.text ? (
        <span
          role="status"
          className={`text-[13px] ${state.kind === "error" ? "text-pilot-red-700" : "text-pilot-grey-600"}`}
        >
          {state.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * THE STUDY TYPE OF A SOURCE NO ANCHOR CLASSIFIES (research-diagram-irany). A claim's evidence level comes from its
 * source's study type; without one, none of its claims can be answered from (NO_EVIDENCE_LEVEL). Usually a claim's
 * review sets it from a study-type anchor; this is for a source whose text gave none. The note says where it is read
 * from, and goes to the log.
 */
function StudyTypeForm({
  sourceId,
  token,
  onClassified,
}: {
  sourceId: string;
  token: string;
  onClassified: () => void;
}) {
  const [studyType, setStudyType] = useState("");
  const [controlled, setControlled] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{
    kind: "idle" | "busy" | "error";
    text?: string;
  }>({ kind: "idle" });
  const ready = studyType !== "" && note.trim() !== "" && state.kind !== "busy";
  return (
    <div
      aria-label="Vizsgálati típus"
      className="space-y-2 rounded-md bg-pilot-accent-warm-soft p-3 text-[13px] text-pilot-grey-900"
      onClick={(e) => e.stopPropagation()}
    >
      <p>
        A forrásnak nincs vizsgálati típusa, ezért az állításai nem kerülhetnek
        válaszba. Add meg a forrás alapján.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <PilotSelect
          aria-label="Vizsgálati típus megadása"
          value={studyType}
          onChange={(v) => setStudyType(v)}
        >
          <option value="">Válassz típust</option>
          {Object.entries(STUDY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </PilotSelect>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={controlled}
            onChange={(e) => setControlled(e.target.checked)}
          />
          <span>Van kontrollcsoport</span>
        </label>
        <PilotInput
          aria-label="Honnan derül ki"
          value={note}
          onChange={setNote}
          placeholder="Honnan derül ki (pl. Methods)"
        />
        <PilotButton
          variant="secondary"
          disabled={!ready}
          onClick={async () => {
            setState({ kind: "busy" });
            try {
              await knowledgeBaseApi.classifySource(token, sourceId, {
                studyType,
                ...(controlled ? { controlled: true } : {}),
                note: note.trim(),
              });
              setState({ kind: "idle" });
              onClassified();
            } catch (caught) {
              setState({
                kind: "error",
                text: (caught as Error)?.message ?? "A mentés nem sikerült.",
              });
            }
          }}
        >
          Típus mentése
        </PilotButton>
      </div>
      {state.text ? (
        <p role="status" className="text-pilot-red-700">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}

function SourceItem(props: {
  row: KnowledgeSourceRow;
  selected: boolean;
  onSelect: () => void;
  checked: boolean;
  onCheck: () => void;
  canDecide: boolean;
  canReadPdf: boolean;
  token: string;
  busy: boolean;
  excluding: boolean;
  reason: ExclusionReason;
  note: string;
  onReason: (r: ExclusionReason) => void;
  onNote: (n: string) => void;
  onInclude: () => void;
  onExclude: () => void;
  onCancelExclude: () => void;
  onConfirmExclude: () => void;
  onReset: () => void;
  onClassified: () => void;
}) {
  const { row } = props;
  const pending = row.screening.status === "PENDING";
  return (
    <div
      role="listitem"
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onSelect}
      className={`border-b border-pilot-grey-200 px-2 py-5 last:border-b-0 ${
        props.selected ? "bg-pilot-grey-50" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        {props.canDecide && pending ? (
          <input
            type="checkbox"
            className="mt-1"
            aria-label={`${plainText(row.title)} kijelölése`}
            checked={props.checked}
            onClick={(e) => e.stopPropagation()}
            onChange={props.onCheck}
          />
        ) : null}
        <div className="min-w-0 flex-[1_1_18rem] space-y-1">
          <p className="text-[15px] font-semibold text-pilot-grey-900">
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {plainText(row.title)}
              </a>
            ) : (
              plainText(row.title)
            )}
          </p>
          <p className="text-[13px] text-pilot-grey-600">{sourceMeta(row)}</p>
          {row.authors.length ? (
            <p className="text-[13px] text-pilot-grey-500">
              {row.authors.join(", ")}
              {row.authorCount > row.authors.length
                ? ` és még ${row.authorCount - row.authors.length}`
                : ""}
              {row.venue ? ` · ${row.venue}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {row.retracted ? (
              <PilotBadge variant="danger">Visszavont</PilotBadge>
            ) : null}
            {row.corrected ? (
              <PilotBadge variant="amber">Javított</PilotBadge>
            ) : null}
            {row.retractionUnchecked ? (
              <PilotBadge variant="grey">
                Visszavonás nem ellenőrzött
              </PilotBadge>
            ) : null}
            {!pending ? (
              <PilotBadge
                variant={
                  row.screening.status === "INCLUDED" ? "success" : "grey"
                }
              >
                {row.screening.status === "INCLUDED"
                  ? "Befogadva"
                  : `Kizárva: ${row.screening.reason ? EXCLUSION_REASON_LABELS[row.screening.reason] : ""}`}
                {row.screening.by ? ` · ${row.screening.by.displayName}` : ""}
              </PilotBadge>
            ) : null}
          </div>
          {row.screening.note ? (
            <p className="text-[13px] italic text-pilot-grey-500">
              „{row.screening.note}”
            </p>
          ) : null}
          {props.canReadPdf &&
          row.screening.status === "INCLUDED" &&
          !row.retracted &&
          !row.fullTextRead ? (
            <ManualPdfUpload sourceId={row.id} token={props.token} />
          ) : null}
          {props.canDecide &&
          row.screening.status === "INCLUDED" &&
          !row.retracted &&
          row.studyType === null ? (
            <StudyTypeForm
              sourceId={row.id}
              token={props.token}
              onClassified={props.onClassified}
            />
          ) : null}
        </div>
        {props.canDecide ? (
          <div className="flex items-center gap-2">
            {pending ? (
              <>
                <PilotButton
                  size="action"
                  disabled={props.busy}
                  onClick={props.onInclude}
                >
                  Befogad
                </PilotButton>
                <PilotButton
                  variant="secondary"
                  size="action"
                  disabled={props.busy}
                  onClick={props.onExclude}
                >
                  Kizár
                </PilotButton>
              </>
            ) : (
              <PilotButton
                variant="ghost"
                size="action"
                disabled={props.busy}
                onClick={props.onReset}
              >
                Döntés visszavonása
              </PilotButton>
            )}
          </div>
        ) : null}
      </div>
      {props.excluding ? (
        <div className="mt-3">
          <ExclusionForm
            reason={props.reason}
            note={props.note}
            busy={props.busy}
            saveLabel="Kizárás mentése"
            onReason={props.onReason}
            onNote={props.onNote}
            onSave={props.onConfirmExclude}
            onCancel={props.onCancelExclude}
          />
        </div>
      ) : null}
    </div>
  );
}
