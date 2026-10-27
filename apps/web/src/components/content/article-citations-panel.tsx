"use client";

import { Alert, Button, ConfirmDialog, Input, Skeleton } from "@acropora/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  knowledgeBaseApi,
  type ArticleCitationReport,
  type CitationCheck,
  type CitationInput,
  type CitationKind,
  type ClaimStoreItem,
  type KnowledgeConclusion,
  type SentenceStatus,
} from "@/lib/api/knowledge-base";

/**
 * A CIKK HIVATKOZÁSAI (kutatási terv v4, 9.2 S5): a mentett szöveg minden
 * mondata VERIFIED állításra, jóváhagyott következtetésre vagy okkal jelölt
 * nem szakmai mondatra épül. A 7a ellenőrzés a cikkben FIGYELMEZTET, nem
 * töröl: a szöveg a szerkesztőé, a figyelmeztetést okkal fogadja el, vagy
 * átírja a mondatot. A panel csak a szerver jelentését rajzolja; a döntés
 * (mi hibás, mi megválaszolatlan) a szerveren születik.
 */

const STATUS_LABELS: Record<SentenceStatus, string> = {
  OK: "rendben",
  UNCITED: "nincs hivatkozás",
  INVALID: "hibás hivatkozás",
  WARNING: "megválaszolatlan figyelmeztetés",
};

const STATUS_CLASSES: Record<SentenceStatus, string> = {
  OK: "border-green-200",
  UNCITED: "border-amber-300",
  INVALID: "border-red-300",
  WARNING: "border-amber-300",
};

const PROBLEM_LABELS: Record<string, string> = {
  CLAIM_MISSING: "Az állítás nem létezik.",
  CLAIM_NOT_VERIFIED: "Az állítás már nem VERIFIED.",
  CONCLUSION_MISSING: "A következtetés nem létezik.",
  CONCLUSION_NOT_APPROVED: "A következtetés nincs jóváhagyva.",
  CONCLUSION_CLAIM_NOT_VERIFIED:
    "A következtetés egyik állítása már nem VERIFIED.",
  NOT_TECHNICAL_WITH_CITATION:
    "Nem szakmainak jelölt mondat nem hivatkozhat állításra.",
};

const ROW_LABELS: Record<string, string> = {
  TAXON: "faj",
  NEGATION: "tagadás",
  ENVIRONMENT: "környezet",
  QUANTITY: "mennyiség",
  EFFECT_DIRECTION: "hatás és irány",
  STRENGTH: "erősség",
  OVERGENERALISATION: "hatókör",
  UNSUPPORTED_CONSTRUCTION: "nem olvasható szerkezet",
  VOCABULARY: "szótár",
};

const KIND_LABELS: Record<CitationKind, string> = {
  CLAIM: "Állítás",
  CONCLUSION: "Következtetés",
  NOT_TECHNICAL: "Nem szakmai mondat",
};

interface Draft {
  sentence: string;
  kind: CitationKind;
  targetId: string;
  reason: string;
}

export function ArticleCitationsPanel({
  token,
  contentId,
  canEdit,
  reloadKey,
  dirty,
}: {
  token: string;
  contentId: string;
  /** `knowledge.manage`: the server refuses the writes without it anyway. */
  canEdit: boolean;
  /** Changes after each save, so the report reads the saved text again. */
  reloadKey: number;
  dirty: boolean;
}) {
  const [report, setReport] = useState<ArticleCitationReport | null>(null);
  const [claims, setClaims] = useState<ClaimStoreItem[]>([]);
  const [conclusions, setConclusions] = useState<KnowledgeConclusion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<{
    id: string;
    sentence: string;
  } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([
      knowledgeBaseApi.citations(token, contentId, controller.signal),
      knowledgeBaseApi.claimStore(token, null, controller.signal),
      knowledgeBaseApi.conclusions(token, controller.signal),
    ])
      .then(([r, store, list]) => {
        setReport(r);
        setClaims(store.claims);
        setConclusions(list.filter((c) => c.status === "APPROVED"));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A hivatkozások nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [token, contentId, reloadKey]);

  /** One write; only the newest answer is drawn (two quick clicks). */
  const write = useCallback(
    (run: () => Promise<ArticleCitationReport>, after?: () => void) => {
      const call = ++latest.current;
      setBusy(true);
      setError(null);
      run()
        .then((r) => {
          if (call !== latest.current) return;
          setReport(r);
          after?.();
        })
        .catch((cause: unknown) => {
          if (call !== latest.current) return;
          setError(
            cause instanceof Error ? cause.message : "A mentés nem sikerült.",
          );
        })
        .finally(() => {
          if (call === latest.current) setBusy(false);
        });
    },
    [],
  );

  const claimTitles = useMemo(
    () => new Map(claims.map((c) => [c.id, c.title])),
    [claims],
  );
  const conclusionTexts = useMemo(
    () => new Map(conclusions.map((c) => [c.id, c.text])),
    [conclusions],
  );
  const targets = useMemo(
    () => new Map((report?.targets ?? []).map((t) => [t.id, t])),
    [report],
  );

  if (error && !report)
    return (
      <Alert
        variant="danger"
        title="A hivatkozások nem tölthetők be"
        description={error}
      />
    );
  if (!report) return <Skeleton className="h-24 w-full" />;

  const writable = canEdit && report.editable;

  const targetLabel = (check: CitationCheck) => {
    const t = targets.get(check.id);
    if (!t) return KIND_LABELS[check.kind];
    if (t.kind === "NOT_TECHNICAL")
      return `${KIND_LABELS.NOT_TECHNICAL}: ${t.reason ?? ""}`;
    if (t.kind === "CLAIM")
      return `${KIND_LABELS.CLAIM}: ${
        (t.claimId && claimTitles.get(t.claimId)) ??
        `${t.claimId} (nincs az állítás-tárban)`
      }`;
    return `${KIND_LABELS.CONCLUSION}: ${
      (t.conclusionId && conclusionTexts.get(t.conclusionId)) ??
      `${t.conclusionId} (nem jóváhagyott)`
    }`;
  };

  const save = () => {
    if (!draft) return;
    const input: CitationInput =
      draft.kind === "CLAIM"
        ? { sentence: draft.sentence, kind: "CLAIM", claimId: draft.targetId }
        : draft.kind === "CONCLUSION"
          ? {
              sentence: draft.sentence,
              kind: "CONCLUSION",
              conclusionId: draft.targetId,
            }
          : {
              sentence: draft.sentence,
              kind: "NOT_TECHNICAL",
              reason: draft.reason,
            };
    write(
      () => knowledgeBaseApi.addCitation(token, contentId, input),
      () => setDraft(null),
    );
  };

  const draftReady =
    draft !== null &&
    (draft.kind === "NOT_TECHNICAL"
      ? draft.reason.trim() !== ""
      : draft.targetId !== "");

  return (
    <section
      aria-label="Hivatkozások"
      className="space-y-3 rounded-lg border border-pilot-grey-200 bg-white p-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-dusk-800">
          Hivatkozások (kutatási tudástár)
        </h2>
        <p className="text-sm text-dusk-600" data-testid="citation-summary">
          {report.counts.sentences} mondat · {report.counts.uncited} hivatkozás
          nélkül · {report.counts.invalid} hibás ·{" "}
          {report.counts.unansweredWarnings} megválaszolatlan figyelmeztetés
          {report.clean ? " · minden mondat rendben" : ""}
        </p>
        <p className="text-xs text-dusk-500">
          A mentett szöveget ellenőrzi
          {dirty ? "; a még nem mentett módosítások nincsenek benne" : ""}.
          {report.editable
            ? ""
            : " A cikk jóváhagyásra vár vagy jóvá van hagyva: a hivatkozások csak javításra visszaküldve módosíthatók."}
        </p>
      </div>

      {report.blockers.includes("VOCABULARY_NOT_APPROVED") ? (
        <Alert
          variant="danger"
          title="A szótár nincs jóváhagyva"
          description={`A ${report.vocabulary.version}. változat nincs jóváhagyva, ezért az ellenőrzés nem zárulhat rendben.`}
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      <ol className="space-y-2">
        {report.sentences.map((s, index) => (
          <li
            key={`${index}-${s.sentence}`}
            data-status={s.status}
            className={`space-y-1 rounded border-l-4 bg-pilot-grey-50 p-2 ${STATUS_CLASSES[s.status]}`}
          >
            <p className="text-sm text-dusk-900">{s.sentence}</p>
            <p className="text-xs font-medium text-dusk-600">
              {STATUS_LABELS[s.status]}
            </p>
            {s.citations.map((c) => (
              <div key={c.id} className="space-y-1 pl-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-dusk-800">{targetLabel(c)}</span>
                  {writable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setRemoving({ id: c.id, sentence: s.sentence })
                      }
                    >
                      Hivatkozás törlése
                    </Button>
                  ) : null}
                </div>
                {c.problems.map((p) => (
                  <p key={p} className="text-red-800">
                    {PROBLEM_LABELS[p] ?? p}
                  </p>
                ))}
                {c.warnings.length ? (
                  <ul className="space-y-0.5">
                    {c.warnings.map((w, k) => (
                      <li
                        key={k}
                        className={
                          c.unanswered.includes(w.code)
                            ? "text-amber-900"
                            : "text-dusk-500"
                        }
                      >
                        {ROW_LABELS[w.row] ?? w.row}: <code>{w.code}</code>{" "}
                        {w.detail}
                        {c.unanswered.includes(w.code)
                          ? ""
                          : " (megválaszolva)"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {writable && c.unanswered.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Az elfogadás oka"
                      placeholder="Miért elfogadható így a mondat?"
                      value={answers[c.id] ?? ""}
                      onChange={(event) =>
                        setAnswers({ ...answers, [c.id]: event.target.value })
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy || !(answers[c.id] ?? "").trim()}
                      onClick={() =>
                        write(
                          () =>
                            knowledgeBaseApi.answerCitation(
                              token,
                              contentId,
                              c.id,
                              c.unanswered,
                              (answers[c.id] ?? "").trim(),
                            ),
                          () => setAnswers({ ...answers, [c.id]: "" }),
                        )
                      }
                    >
                      Elfogadom okkal
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {writable && draft?.sentence !== s.sentence ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    sentence: s.sentence,
                    kind: "CLAIM",
                    targetId: "",
                    reason: "",
                  })
                }
              >
                Hivatkozás hozzáadása
              </Button>
            ) : null}
            {writable && draft?.sentence === s.sentence ? (
              <div className="flex flex-wrap items-center gap-2 pl-2">
                <select
                  aria-label="A hivatkozás fajtája"
                  className="rounded border border-pilot-grey-300 px-2 py-1 text-sm"
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as CitationKind,
                      targetId: "",
                    })
                  }
                >
                  {(Object.keys(KIND_LABELS) as CitationKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                {draft.kind === "NOT_TECHNICAL" ? (
                  <Input
                    aria-label="Miért nem szakmai a mondat"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft({ ...draft, reason: event.target.value })
                    }
                  />
                ) : (
                  <select
                    aria-label={
                      draft.kind === "CLAIM"
                        ? "VERIFIED állítás"
                        : "Jóváhagyott következtetés"
                    }
                    className="max-w-md rounded border border-pilot-grey-300 px-2 py-1 text-sm"
                    value={draft.targetId}
                    onChange={(event) =>
                      setDraft({ ...draft, targetId: event.target.value })
                    }
                  >
                    <option value="">Válassz…</option>
                    {(draft.kind === "CLAIM"
                      ? claims.map((c) => ({ id: c.id, label: c.title }))
                      : conclusions.map((c) => ({ id: c.id, label: c.text }))
                    ).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !draftReady}
                  onClick={save}
                >
                  Hivatkozás mentése
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                >
                  Mégse
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {report.orphaned.length ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-dusk-800">
            Árva hivatkozások (a mondatuk már nincs a szövegben)
          </h3>
          <ul className="space-y-1 text-xs text-dusk-600">
            {report.orphaned.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {KIND_LABELS[o.kind]}: „{o.sentence}”
                </span>
                {writable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setRemoving({ id: o.id, sentence: o.sentence })
                    }
                  >
                    Törlés
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Törlöd ezt a hivatkozást?"
        consequence={`A mondat („${removing?.sentence ?? ""}”) e nélkül a hivatkozás nélkül marad, és a hivatkozás figyelmeztetéseire adott válaszok is elvesznek.`}
        recovery="A hivatkozás újra felvehető ugyanerre a mondatra; a törlés az auditnaplóban megmarad."
        confirmLabel="Hivatkozás törlése"
        busy={busy}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          write(
            () => knowledgeBaseApi.removeCitation(token, contentId, target.id),
            () => setRemoving(null),
          );
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
