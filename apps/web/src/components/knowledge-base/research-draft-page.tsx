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
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_RESEARCH_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type ResearchDraftClaim,
  type ResearchDraftDetail,
  type ResearchDraftReport,
  type ResearchDraftRow,
  type ResearchDraftSource,
} from "@/lib/api/knowledge-base";
import {
  DIRECTION_LABELS,
  FIELD_LABELS,
  METHOD_LABELS,
  quantityLabel,
} from "./claim-review-page";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";
import { STUDY_LABELS } from "./source-screening-page";

/**
 * KUTATÁSI TERVEZETEK, A B MÓD (Research & Knowledge Engine S6; Figma
 * K2d2lES872xzwQHCMVXtam 3:472, „09 · Kérdés–válasz próba”). A szerkesztő
 * kérdéséből a gép nyílt forrásokat keres és olvas, és a kiolvasott, ellenőrzött
 * jelölt állításokból összefoglalót írat. Az eredmény MODELL-SZÖVEG KÜLSŐ
 * FORRÁSOKBÓL: szaggatott keret és saját címke jelöli, másképp néz ki, mint egy
 * elfogadott állítás (terv v4, 7. pont).
 *
 * Ebből a képernyőből SEMMI nem kerül a tudástárba: nincs „átveszem” gomb,
 * mert nincs olyan út, ami a tervezetből állítást vagy forrást írna (a terv
 * szerint ilyen kód-út nem is lehet; research-draft-isolation.test.ts). Az
 * átvétel a normál munkafolyamat: forrás befogadása, kiolvasás, ellenőrzés.
 *
 * Mind a három végpont `knowledge.manage` jogot kér, ezért a képernyő is: aki
 * csak olvas, ennek a fülét sem látja. Az A mód (ellenőrzött tudásból) nem ezen
 * a képernyőn van; egy le nem kötött mód-kapcsoló hibának látszana.
 */
export const RESEARCH_DRAFT_POLL_MS = 5000;

const STATUS_LABELS: Record<ResearchDraftRow["status"], string> = {
  RUNNING: "Fut",
  DRAFT: "Tervezet",
  FAILED: "Sikertelen",
};

const STATUS_VARIANTS = {
  RUNNING: "blue",
  DRAFT: "default",
  FAILED: "danger",
} as const;

/** Why a draft FAILED: the chain's reason, or the api's own (`report.error`). */
export const FAILURE_TEXT: Record<string, string> = {
  AI_QUERIES_UNAVAILABLE:
    "Az AI nem adott keresőkifejezést: nem volt elérhető. Próbáld újra később.",
  AI_QUERIES_REFUSED:
    "Az AI erre a kérdésre nem fogalmazott keresőkifejezést. Fogalmazd át szakmaibbra.",
  NO_QUERIES: "Egyetlen keresőkifejezés sem ment át az ellenőrzésen.",
  NO_SOURCES: "A keresés nem talált nyílt hozzáférésű forrást.",
  NO_OPEN_FULL_TEXT:
    "A talált források egyikének sem volt olvasható nyílt teljes szövege.",
  NO_CLAIMS:
    "A kiolvasott szövegekből egyetlen állítás sem ment át az ellenőrzésen, ezért összefoglaló sem készült.",
  AI_SUMMARY_UNAVAILABLE:
    "Az összefoglaló nem készült el: az AI nem volt elérhető. A jelölt állítások lent megvannak.",
  AI_SUMMARY_REFUSED:
    "Az AI ezekből az állításokból nem írt összefoglalót. A jelölt állítások lent megvannak.",
  SUMMARY_EMPTY:
    "Az összefoglaló minden mondata kiesett az ellenőrzésen. A jelölt állítások lent megvannak.",
  STALE_RUNNING:
    "A futás megszakadt (például az api újraindult közben), és lezárult. Indítsd újra.",
};

export function failureText(report: ResearchDraftReport): string {
  const code = report.reason ?? report.error;
  if (!code) return "A futás ok megnevezése nélkül állt le.";
  return FAILURE_TEXT[code] ?? `A futás hibával állt le (${code}).`;
}

/** A source's `read`: READ, or why it was not read. */
export const READ_LABELS: Record<string, string> = {
  READ: "Kiolvasva",
  RETRACTED: "Visszavont mű: nem olvastuk",
  RETRACTION_UNCHECKED:
    "A visszavonás-ellenőrzés (Crossref) nem érte el: nem olvastuk",
  NO_OPEN_FULL_TEXT: "Nincs nyílt teljes szöveg",
  NOT_TRIED: "Nem került sorra",
};

const readLabel = (code: string) =>
  READ_LABELS[code] ?? `Nem olvasható (${code})`;

/** The OS's own check of the summary, by drop code. */
export const DROP_LABELS: Record<string, string> = {
  UNMARKED: "nincs állítás-hivatkozás a mondat végén",
  MARKER_NOT_AT_END: "a hivatkozás nem a mondat végén áll",
  UNKNOWN_MARKER: "nem létező jelölt állításra hivatkozik",
  NUMBER_NOT_IN_CLAIMS: "olyan számot ír, ami a hivatkozott állításokban nincs",
};

const countBy = (codes: string[]) => {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts];
};

/** Only an http(s) address becomes a link: a source's URL comes from an external API. */
export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function sourceHref(s: ResearchDraftSource): string | null {
  return (
    safeHref(s.url) ?? (s.doi ? safeHref(`https://doi.org/${s.doi}`) : null)
  );
}

/** "Koop et al., 2001", the reference the API side names a source by. */
export function sourceRef(s: ResearchDraftSource): string {
  const first = s.authors[0]?.split(/[ ,]/)[0];
  const who = first
    ? `${first}${s.authors.length > 1 ? " et al." : ""}`
    : s.title.slice(0, 80);
  return `${who}, ${s.year ?? "év nélkül"}`;
}

const MARKER = /\[\[claim:([A-Za-z0-9_-]{1,64})\]\]/gu;

/** The summary as text and claim markers; the markers become links to the claims below. */
export function summaryParts(
  text: string,
): ({ text: string } | { claim: string })[] {
  const parts: ({ text: string } | { claim: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(MARKER)) {
    if (m.index! > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ claim: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

const claimAnchor = (id: string) => `kutatasi-allitas-${id}`;

type Labels = Map<string, string>;

/** A candidate claim's fields, in the editor's words. */
export function claimFieldRows(
  c: ResearchDraftClaim,
  labels: Labels,
): [string, string][] {
  const vocab = (kind: string, key: string | null) =>
    key === null ? null : (labels.get(`${kind}:${key}`) ?? key);
  const rows: [string, string | null][] = [
    ["species", vocab("TAXON", c.species)],
    ["environment", vocab("ENVIRONMENT", c.environment)],
    ["effect", vocab("EFFECT", c.effect)],
    [
      "direction",
      c.direction ? (DIRECTION_LABELS[c.direction] ?? c.direction) : null,
    ],
    [
      "quantity",
      c.quantity
        ? quantityLabel(
            c.quantity.min,
            c.quantity.max,
            c.quantity.unit,
            c.quantity.basis,
          )
        : null,
    ],
    [
      "studyType",
      c.studyType ? (STUDY_LABELS[c.studyType] ?? c.studyType) : null,
    ],
    [
      "sampleSize",
      c.sampleSize
        ? `${c.sampleSize.value}${c.sampleSize.unit ? ` ${c.sampleSize.unit}` : ""}`
        : null,
    ],
    [
      "measurementMethod",
      c.measurementMethod
        ? (METHOD_LABELS[c.measurementMethod] ?? c.measurementMethod)
        : null,
    ],
    ["uncertainty", c.uncertainty],
    ["conditions", c.conditions],
  ];
  return rows
    .filter((r): r is [string, string] => r[1] !== null && r[1] !== "")
    .map(([field, value]) => [FIELD_LABELS[field] ?? field, value]);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });

export function ResearchDraftPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );

  const [list, setList] = useState<ResearchDraftRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResearchDraftDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Labels>(new Map());
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadList = useCallback(
    (signal?: AbortSignal) => {
      if (!canManage) return;
      setLoadError(null);
      knowledgeBaseApi
        .researchDrafts(token, signal)
        .then((rows) => {
          setList(rows);
          setSelected((current) => current ?? rows[0]?.id ?? null);
        })
        .catch((cause: unknown) => {
          if ((cause as Error)?.name === "AbortError") return;
          setLoadError((cause as Error)?.message ?? "Ismeretlen hiba.");
        });
    },
    [canManage, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    loadList(controller.signal);
    // the vocabulary only names the claims' keys: without it the key itself shows
    if (canManage)
      knowledgeBaseApi
        .vocabulary(token, controller.signal)
        .then((v) =>
          setLabels(
            new Map(v.entries.map((e) => [`${e.kind}:${e.key}`, e.label])),
          ),
        )
        .catch(() => undefined);
    return () => controller.abort();
  }, [loadList, canManage, token]);

  useEffect(() => {
    if (!canManage || !selected) return;
    const controller = new AbortController();
    setDetailError(null);
    knowledgeBaseApi
      .researchDraft(token, selected, controller.signal)
      .then(setDetail)
      .catch((cause: unknown) => {
        if ((cause as Error)?.name === "AbortError") return;
        setDetailError((cause as Error)?.message ?? "Ismeretlen hiba.");
      });
    return () => controller.abort();
  }, [canManage, token, selected]);

  // a RUNNING draft is read back until it settles, then the list follows it
  const running = detail?.status === "RUNNING" ? detail.id : null;
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      knowledgeBaseApi
        .researchDraft(token, running, controller.signal)
        .then((next) => {
          setDetail(next);
          if (next.status !== "RUNNING") loadList();
        })
        .catch((cause: unknown) => {
          if ((cause as Error)?.name === "AbortError") return;
          setDetailError((cause as Error)?.message ?? "Ismeretlen hiba.");
        });
    }, RESEARCH_DRAFT_POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [running, detail, token, loadList]);

  const start = () => {
    setBusy(true);
    setStartError(null);
    knowledgeBaseApi
      .startResearchDraft(token, question.trim())
      .then(({ id }) => {
        setQuestion("");
        setDetail(null);
        setSelected(id);
        loadList();
      })
      .catch((cause: unknown) =>
        setStartError((cause as Error)?.message ?? "Az indítás nem sikerült."),
      )
      .finally(() => setBusy(false));
  };

  const shown = detail && detail.id === selected ? detail : null;
  const anyRunning = list?.some((d) => d.status === "RUNNING") ?? false;

  if (!canManage)
    return (
      <PilotThemeRoot className="space-y-6">
        <Alert
          variant="danger"
          title="Nincs jogosultság"
          description="A kutatási tervezetekhez knowledge.manage jog kell."
        />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="AI válaszok tesztelése"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_RESEARCH_PATH} />

      <PilotCard className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-pilot-grey-900">
            Belső szakmai kérdés–válasz próba
          </h2>
          <PilotBadge variant="default">
            B · Mélykutatás · Ideiglenes
          </PilotBadge>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold text-pilot-grey-800">Kérdés</span>
          <textarea
            className="w-full rounded-lg border border-pilot-grey-300 bg-pilot-grey-50 p-3 text-[15px]"
            rows={3}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {startError ? (
          <Alert
            variant="danger"
            title="A kutatás nem indult el"
            description={startError}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-pilot-grey-500">
            {anyRunning
              ? "Egy kutatás már fut; egyszerre egy futhat."
              : "Nyílt forrásokat keres és olvas; néhány percig tart."}
          </span>
          <PilotButton
            size="action"
            disabled={busy || anyRunning || question.trim() === ""}
            onClick={start}
          >
            Kutatás indítása
          </PilotButton>
        </div>
      </PilotCard>

      {loadError ? (
        <Alert
          variant="danger"
          title="A kutatási tervezetek nem tölthetők be"
          description={loadError}
          action={
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => loadList()}
            >
              Újra
            </PilotButton>
          }
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <PilotCard className="space-y-3 p-5">
          <h2 className="text-lg font-semibold text-pilot-grey-900">
            Korábbi kutatások
          </h2>
          {list === null && !loadError ? (
            <div role="status" aria-label="Betöltés" className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list?.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">
              Még nincs kutatási tervezet. Írj be egy kérdést, és indítsd el.
            </p>
          ) : (
            <ul className="space-y-2">
              {list?.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={d.id === selected ? "true" : undefined}
                    className={`w-full rounded-lg border p-3 text-left text-sm ${
                      d.id === selected
                        ? "border-pilot-grey-900"
                        : "border-pilot-grey-200"
                    }`}
                    onClick={() => setSelected(d.id)}
                  >
                    <span className="line-clamp-2 text-pilot-grey-900">
                      {d.question}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <PilotBadge variant={STATUS_VARIANTS[d.status]}>
                        {STATUS_LABELS[d.status]}
                      </PilotBadge>
                      <span className="text-xs text-pilot-grey-500">
                        {when(d.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PilotCard>

        <div className="space-y-4">
          {detailError ? (
            <Alert
              variant="danger"
              title="A kutatási tervezet nem tölthető be"
              description={detailError}
            />
          ) : null}
          {!selected ? (
            <PilotCard className="p-5">
              <p className="text-sm text-pilot-grey-600">
                Válassz egy kutatást a listából, vagy indíts újat.
              </p>
            </PilotCard>
          ) : !shown ? (
            detailError ? null : (
              <PilotCard className="p-5">
                <div role="status" aria-label="Betöltés" className="space-y-2">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </PilotCard>
            )
          ) : (
            <DraftView draft={shown} labels={labels} />
          )}
        </div>
      </div>
      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function DraftView({
  draft,
  labels,
}: {
  draft: ResearchDraftDetail;
  labels: Labels;
}) {
  const report = draft.report;
  const dropped = [
    ...(report.summaryDroppedHere ?? []),
    ...(report.summaryDroppedByAi ?? []),
  ];
  const claimIds = useMemo(
    () => new Set(draft.candidateClaims.map((c) => c.id)),
    [draft.candidateClaims],
  );
  return (
    <>
      <PilotCard className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PilotBadge variant={STATUS_VARIANTS[draft.status]}>
            {STATUS_LABELS[draft.status]}
          </PilotBadge>
          <span className="text-xs text-pilot-grey-500">
            Indítva {when(draft.createdAt)}
            {draft.finishedAt ? ` · lezárva ${when(draft.finishedAt)}` : ""}
          </span>
        </div>
        <p className="text-[15px] font-semibold text-pilot-grey-900">
          {draft.question}
        </p>

        {draft.status === "RUNNING" ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-pilot-grey-700">
              A kutatás fut: keresőkifejezések, forrás-felderítés, a nyílt
              teljes szövegek kiolvasása, végül az összefoglaló. A lap magától
              frissül.
            </p>
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {draft.status === "FAILED" ? (
          <Alert
            title="Nem készült összefoglaló"
            description={failureText(report)}
          />
        ) : null}

        {draft.status === "DRAFT" && draft.summary ? (
          <section
            aria-label="Modell-szöveg külső forrásokból"
            className="space-y-3 rounded-lg border-2 border-dashed border-pilot-grey-300 bg-pilot-grey-50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <PilotBadge variant="default">
                Modell-szöveg külső forrásokból · nem ellenőrzött
              </PilotBadge>
              {draft.summaryModel ? (
                <span className="text-xs text-pilot-grey-500">
                  Írta: {draft.summaryModel}
                </span>
              ) : null}
            </div>
            <p className="text-[15px] leading-7 text-pilot-grey-800">
              {summaryParts(draft.summary).map((part, i) =>
                "text" in part ? (
                  <Fragment key={i}>{part.text}</Fragment>
                ) : claimIds.has(part.claim) ? (
                  <a
                    key={i}
                    href={`#${claimAnchor(part.claim)}`}
                    className="mx-0.5 align-super text-xs text-pilot-blue-700 underline"
                  >
                    [{part.claim}]
                  </a>
                ) : (
                  <span key={i} className="align-super text-xs">
                    [{part.claim}]
                  </span>
                ),
              )}
            </p>
          </section>
        ) : null}

        {draft.status !== "RUNNING" ? (
          <div className="flex flex-wrap gap-2">
            <PilotBadge variant="blue">
              Jelölt állítások: {draft.candidateClaims.length}
            </PilotBadge>
            {draft.status === "DRAFT" ? (
              <PilotBadge variant="amber">
                Kiszűrt mondatok: {dropped.length} · csak belső nézet
              </PilotBadge>
            ) : null}
          </div>
        ) : null}
        {dropped.length > 0 ? (
          <ul className="space-y-1 text-xs text-pilot-grey-600">
            {countBy(dropped).map(([code, n]) => (
              <li key={code}>
                {n} mondat: {DROP_LABELS[code] ?? code}
              </li>
            ))}
          </ul>
        ) : null}
        {report.queries?.length ? (
          <p className="text-xs text-pilot-grey-500">
            Keresőkifejezések: {report.queries.join(" · ")}
          </p>
        ) : null}
        <p className="text-xs text-pilot-grey-500">
          B: ideiglenes kutatás, nem kerül a tudástárba. Egy forrás a normál
          úton kerülhet be: befogadás a Források fülön, kiolvasás, ellenőrzés.
        </p>
      </PilotCard>

      {draft.candidateClaims.length > 0 ? (
        <PilotCard className="space-y-3 p-5">
          <h3 className="text-base font-semibold text-pilot-grey-900">
            Jelölt állítások
          </h3>
          <ul className="space-y-3">
            {draft.candidateClaims.map((c) => {
              const source = draft.sources[c.source];
              return (
                <li
                  key={c.id}
                  id={claimAnchor(c.id)}
                  className="space-y-2 rounded-lg border border-dashed border-pilot-grey-300 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-pilot-grey-600">
                      {c.id}
                    </span>
                    <PilotBadge variant="grey">
                      Jelölt · nem ellenőrzött
                    </PilotBadge>
                    {source ? (
                      <span className="text-xs text-pilot-grey-500">
                        {sourceRef(source)}
                      </span>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                    {claimFieldRows(c, labels).map(([label, value]) => (
                      <Fragment key={label}>
                        <dt className="text-pilot-grey-500">{label}</dt>
                        <dd className="text-pilot-grey-900">{value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                  <blockquote className="border-l-2 border-pilot-grey-300 pl-3 text-pilot-grey-700">
                    {c.passage.text}
                    <span className="block text-xs text-pilot-grey-500">
                      {c.passage.locator}
                    </span>
                  </blockquote>
                </li>
              );
            })}
          </ul>
        </PilotCard>
      ) : null}

      {draft.sources.length > 0 ? (
        <PilotCard className="space-y-3 p-5">
          <h3 className="text-base font-semibold text-pilot-grey-900">
            Talált források
          </h3>
          <ul className="space-y-3">
            {draft.sources.map((s, i) => {
              const href = sourceHref(s);
              return (
                <li
                  key={`${s.doi ?? s.pmcid ?? s.title}-${i}`}
                  className="space-y-1 border-b border-pilot-grey-200 pb-3 text-sm last:border-b-0"
                >
                  <p className="text-pilot-grey-900">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                  </p>
                  <p className="text-xs text-pilot-grey-500">
                    {[sourceRef(s), s.venue, s.doi ? `DOI ${s.doi}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <PilotBadge variant={s.read === "READ" ? "teal" : "grey"}>
                      {readLabel(s.read)}
                    </PilotBadge>
                    {s.read === "READ" ? (
                      <span className="text-xs text-pilot-grey-500">
                        {s.claims} jelölt állítás
                      </span>
                    ) : null}
                    {s.retractionUnchecked ? (
                      <PilotBadge variant="amber">
                        Nincs DOI: a visszavonást csak az adatbázis saját
                        jelzése nézte
                      </PilotBadge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </PilotCard>
      ) : null}
    </>
  );
}
