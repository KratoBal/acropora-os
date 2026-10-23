"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { KNOWLEDGE_CLAIMS_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  knowledgeBaseApi,
  type Applicability,
  type ClaimReview,
  type ClaimReviewField,
} from "@/lib/api/knowledge-base";
import { KnowledgeBaseTabs, KnowledgeLayerLegend } from "./knowledge-base-tabs";
import { STUDY_LABELS } from "./source-screening-page";

/**
 * ÁLLÍTÁS ELLENŐRZÉSE (Research & Knowledge Engine S4; Figma
 * K2d2lES872xzwQHCMVXtam 3:137, a „Kiolvasás” menüpont). A gép (S3) egy
 * állítást mezőnként javasolt, minden mezőt szó szerinti horgonnyal; a
 * szerkesztő mezőnként elfogad, javít vagy elvet, és az állítás csak akkor
 * menthető, ha minden mező döntött (a terv 7a. 1. pontja).
 *
 * A javítást a szerver ugyanazon a horgony-ellenőrzésen viszi át, mint a gép
 * értékét: ami nem horgonyozható, az nem mező. Egy szótáron kívüli érték
 * (szerkesztői kérdés) változatlanul nem fogadható el: javítani kell egy
 * ismert értékre, vagy elvetni. Új szótár-sor felvétele nem itt történik.
 */
export const FIELD_LABELS: Record<string, string> = {
  species: "Faj",
  environment: "Környezet",
  quantity: "Mennyiség",
  effect: "Hatás",
  direction: "Irány",
  studyType: "Vizsgálattípus",
  sampleSize: "Mintaszám",
  measurementMethod: "Mérési módszer",
  uncertainty: "Bizonytalanság",
  conditions: "Feltételek",
};

const DIRECTION_LABELS: Record<string, string> = {
  INCREASE: "Növekszik",
  DECREASE: "Csökken",
  NONE: "Nincs hatás",
};

const METHOD_LABELS: Record<string, string> = {
  COLORIMETRIC_KIT: "Színreakciós teszt",
  PHOTOMETER: "Fotométer",
  LAB_SPECTROPHOTOMETRY: "Laboratóriumi spektrofotometria",
  AUTOANALYZER: "Autoanalizátor",
  ICP_OES: "ICP-OES",
  ICP_MS: "ICP-MS",
  ION_CHROMATOGRAPHY: "Ionkromatográfia",
  OTHER: "Egyéb",
  NOT_REPORTED: "Nem közölt",
};

export const APPLICABILITY_LABELS: Record<Applicability, string> = {
  DIRECT: "Közvetlenül",
  ANALOGOUS: "Analóg módon",
  LIMITED: "Csak korlátozottan",
  NOT_APPLICABLE: "Nem alkalmazható",
};

const UNITS = ["µmol/l", "mg/l", "µg/l", "ppm", "ppb"] as const;

/** The server's refusal codes, in the editor's words. */
const REFUSAL_TEXT: Record<string, string> = {
  NUMBER_NOT_AT_UNIT: "a szám nem közvetlenül az egység előtt áll a horgonyban",
  NUMBER_NOT_IN_ANCHOR: "a szám nem szerepel a horgonyban",
  UNIT_NOT_IN_ANCHOR: "az egység nem szerepel a horgonyban",
  UNIT_UNKNOWN: "ismeretlen egység",
  BASIS_MISSING: "tömegegységnél a bázist is meg kell adni (PO₄ vagy P)",
  BASIS_NOT_IN_ANCHOR: "a bázis nem szerepel a horgonyban",
  RANGE_INVERTED: "az alsó határ nagyobb a felsőnél",
  VALUE_NOT_IN_ANCHOR: "a szöveg nem szerepel szó szerint a horgonyban",
  NOT_A_KNOWN_ANCHORED_VALUE:
    "ezt az értéket a horgony szövege nem nevezi meg, vagy nincs a szótárban",
  UNKNOWN_VALUE: "érvénytelen érték",
  NO_VALUE: "hiányzó érték",
  ANCHOR_TOO_SHORT: "a horgony túl rövid ehhez a mezőhöz",
};

export function reviewErrorText(message: string): string {
  const coded = /^(\w+): ([A-Z_]+)$/.exec(message.trim());
  if (coded)
    return `${FIELD_LABELS[coded[1]!] ?? coded[1]}: ${
      REFUSAL_TEXT[coded[2]!] ?? coded[2]
    }.`;
  const named = /^(\w+): (two anchors propose|the claim no longer holds)/.exec(
    message.trim(),
  );
  if (named)
    return named[2] === "two anchors propose"
      ? `${FIELD_LABELS[named[1]!] ?? named[1]}: két horgony javasol értéket erre a mezőre, és az állítás a másikét tartja. Ezt javítsd vagy vesd el.`
      : `${FIELD_LABELS[named[1]!] ?? named[1]}: az állítás közben megváltozott. Töltsd be újra.`;
  if (/source was retracted/.test(message))
    return "A forrást visszavonták: erre az állításra nem épülhet semmi, csak elvethető.";
  if (/effect and the direction/.test(message))
    return "A hatás és az irány nem maradhat el. Ha valamelyik hibás, az állítást vesd el.";
  return message;
}

const decimal = (n: number | string) =>
  Number(n).toLocaleString("hu-HU", { maximumFractionDigits: 6 });

export function quantityLabel(
  min: number | string | null,
  max: number | string | null,
  unit: string,
  basis: "PO4" | "P" | null,
): string {
  const b = basis === "PO4" ? " PO₄" : basis === "P" ? " P" : "";
  const lo = min === null || min === "" ? null : Number(min);
  const hi = max === null || max === "" ? null : Number(max);
  if (lo !== null && hi !== null)
    return lo === hi
      ? `${decimal(lo)} ${unit}${b}`
      : `${decimal(lo)}–${decimal(hi)} ${unit}${b}`;
  if (lo !== null) return `legalább ${decimal(lo)} ${unit}${b}`;
  if (hi !== null) return `legfeljebb ${decimal(hi)} ${unit}${b}`;
  return unit;
}

type LocalDecision =
  | { decision: "ACCEPT" }
  | { decision: "REJECT" }
  | { decision: "CORRECT"; value: unknown; text: string };

/** The field's value as the editor reads it. */
function valueText(
  field: string,
  value: string | null,
  review: ClaimReview,
): string {
  if (value === null) return "";
  const option = (list: { key: string; label: string }[]) =>
    list.find((o) => o.key === value)?.label ?? value;
  switch (field) {
    case "species":
      return option(review.options.species);
    case "environment":
      return option(review.options.environment);
    case "effect":
      return option(review.options.effect);
    case "direction":
      return DIRECTION_LABELS[value] ?? value;
    case "studyType":
      return STUDY_LABELS[value] ?? value;
    case "measurementMethod":
      return METHOD_LABELS[value] ?? value;
    case "quantity": {
      const q = review.quantity;
      return q?.unit ? quantityLabel(q.min, q.max, q.unit, q.basis) : value;
    }
    default:
      return value;
  }
}

const required = (f: ClaimReviewField) =>
  f.owner === "CLAIM" || f.decision === "PENDING";

export function ClaimReviewPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_VIEW),
  );
  const canDecide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.KNOWLEDGE_MANAGE),
  );

  const [queue, setQueue] = useState<{ ids: string[]; total: number } | null>(
    null,
  );
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState<ClaimReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, LocalDecision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [applicability, setApplicability] = useState<Applicability | "">("");
  const [applicabilityReason, setApplicabilityReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [discardReason, setDiscardReason] = useState("");

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setQueue(await knowledgeBaseApi.reviewQueue(token, signal));
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        setError((caught as Error)?.message ?? "Ismeretlen hiba.");
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(controller.signal);
    return () => controller.abort();
  }, [loadQueue]);

  const currentId = queue?.ids[Math.min(index, queue.ids.length - 1)] ?? null;

  useEffect(() => {
    if (!currentId) {
      setReview(null);
      return;
    }
    const controller = new AbortController();
    setReview(null);
    setDecisions({});
    setEditing(null);
    setSelected(null);
    setSaveError(null);
    setDiscarding(false);
    setDiscardReason("");
    knowledgeBaseApi
      .claimReview(token, currentId, controller.signal)
      .then((r) => {
        setReview(r);
        setApplicability(r.applicability?.value ?? "");
        setApplicabilityReason(r.applicability?.reason ?? "");
      })
      .catch((caught: Error) => {
        if (caught?.name !== "AbortError")
          setError(caught?.message ?? "Ismeretlen hiba.");
      });
    return () => controller.abort();
  }, [currentId, token]);

  const pendingCount = useMemo(
    () =>
      review
        ? review.fields.filter((f) => required(f) && !decisions[f.anchorId])
            .length
        : 0,
    [review, decisions],
  );
  const applicabilityIncomplete =
    applicability !== "" && !applicabilityReason.trim();
  const canSave =
    canDecide &&
    review !== null &&
    !review.source.retracted &&
    pendingCount === 0 &&
    !applicabilityIncomplete &&
    !busy;

  const decide = (anchorId: string, d: LocalDecision) => {
    setDecisions((all) => ({ ...all, [anchorId]: d }));
    setEditing(null);
    setSaveError(null);
  };

  const afterWrite = async () => {
    // the saved claim leaves the queue: the same position shows the next one
    await loadQueue();
  };

  const save = async () => {
    if (!review || !canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      await knowledgeBaseApi.saveClaimReview(token, review.id, {
        decisions: review.fields.filter(required).map((f) => {
          const d = decisions[f.anchorId]!;
          return d.decision === "CORRECT"
            ? { anchorId: f.anchorId, decision: "CORRECT", value: d.value }
            : { anchorId: f.anchorId, decision: d.decision };
        }),
        applicability:
          applicability === ""
            ? null
            : { value: applicability, reason: applicabilityReason.trim() },
      });
      await afterWrite();
    } catch (caught) {
      setSaveError(reviewErrorText((caught as Error)?.message ?? ""));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!review || !discardReason.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      await knowledgeBaseApi.discardClaim(
        token,
        review.id,
        discardReason.trim(),
      );
      await afterWrite();
    } catch (caught) {
      setSaveError(reviewErrorText((caught as Error)?.message ?? ""));
    } finally {
      setBusy(false);
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

  const total = queue?.ids.length ?? 0;
  const position = Math.min(index, Math.max(total - 1, 0));
  const selectedField =
    review?.fields.find((f) => f.anchorId === selected) ?? null;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Kutatási és szerkesztői modul"
        title="Állítás ellenőrzése"
        meta={<PilotBadge variant="amber">Stage · Pilot</PilotBadge>}
      />
      <KnowledgeBaseTabs active={KNOWLEDGE_CLAIMS_PATH} />

      {error ? (
        <Alert
          variant="danger"
          title="Az állítás nem tölthető be"
          description={error}
          action={
            <PilotButton
              variant="secondary"
              size="action"
              onClick={() => {
                setError(null);
                void loadQueue();
              }}
            >
              Újra
            </PilotButton>
          }
        />
      ) : queue === null || (total > 0 && review === null) ? (
        <div role="status" aria-label="Betöltés" className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : total === 0 || review === null ? (
        <Alert
          variant="info"
          title="Nincs ellenőrzésre váró állítás"
          description="A kiolvasás (S3) jelölt állításai itt jelennek meg. Ha még nem futott kiolvasás a befogadott forrásokon, előbb az kell."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PilotBadge variant="amber">
              Állítás {String(position + 1).padStart(2, "0")}/
              {String(queue.total).padStart(2, "0")}
            </PilotBadge>
            <div className="flex gap-2">
              <PilotButton
                variant="secondary"
                size="action"
                disabled={position === 0 || busy}
                onClick={() => setIndex(position - 1)}
              >
                Előző
              </PilotButton>
              <PilotButton
                size="action"
                disabled={position >= total - 1 || busy}
                onClick={() => setIndex(position + 1)}
              >
                Következő →
              </PilotButton>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SourcePanel review={review} selected={selectedField} />

            <PilotCard className="space-y-4 p-5">
              <h2 className="text-lg font-semibold text-pilot-grey-900">
                Javasolt állítás – mezőnként
              </h2>
              <ul aria-label="Mezők" className="space-y-4">
                {review.fields.map((f) => (
                  <FieldRow
                    key={f.anchorId}
                    field={f}
                    review={review}
                    local={decisions[f.anchorId] ?? null}
                    canDecide={canDecide}
                    editing={editing === f.anchorId}
                    selected={selected === f.anchorId}
                    onSelect={() => setSelected(f.anchorId)}
                    onAccept={() => decide(f.anchorId, { decision: "ACCEPT" })}
                    onReject={() => decide(f.anchorId, { decision: "REJECT" })}
                    onEdit={() => {
                      setSelected(f.anchorId);
                      setEditing(f.anchorId);
                    }}
                    onCancelEdit={() => setEditing(null)}
                    onCorrect={(value, text) =>
                      decide(f.anchorId, { decision: "CORRECT", value, text })
                    }
                  />
                ))}
              </ul>

              <div className="space-y-3 border-t border-pilot-grey-200 pt-4">
                <EvidenceBadge review={review} decisions={decisions} />
                <label className="block space-y-1 text-sm text-pilot-grey-700">
                  <span>Otthoni akváriumra</span>
                  <PilotSelect
                    aria-label="Otthoni akváriumra"
                    value={applicability}
                    disabled={!canDecide}
                    onChange={(v) => setApplicability(v as Applicability | "")}
                  >
                    <option value="">Nincs döntés</option>
                    {(Object.keys(APPLICABILITY_LABELS) as Applicability[]).map(
                      (a) => (
                        <option key={a} value={a}>
                          {APPLICABILITY_LABELS[a]}
                        </option>
                      ),
                    )}
                  </PilotSelect>
                </label>
                {applicability !== "" ? (
                  <label className="block space-y-1 text-sm text-pilot-grey-700">
                    <span>Indoklás (kötelező)</span>
                    <PilotInput
                      aria-label="Indoklás"
                      value={applicabilityReason}
                      readOnly={!canDecide}
                      onChange={setApplicabilityReason}
                    />
                  </label>
                ) : null}
              </div>

              {saveError ? (
                <Alert
                  variant="danger"
                  title="Nem menthető"
                  description={saveError}
                />
              ) : null}

              {canDecide && review.source.retracted ? (
                <Alert
                  variant="danger"
                  title="Visszavont forrás"
                  description="Erre az állításra nem épülhet semmi: nem fogadható el, csak elvethető."
                />
              ) : canDecide && review.source.retractionUnchecked ? (
                <p
                  role="note"
                  className="rounded-md bg-pilot-accent-warm-soft p-3 text-sm text-pilot-grey-900"
                >
                  A visszavonás ennél a forrásnál nincs ellenőrizve (a Crossref-
                  ellenőrzés nem futott rá, jellemzően mert nincs DOI-ja).
                  Elfogadás előtt nézd meg a forrás oldalát.
                </p>
              ) : null}

              {canDecide ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <PilotButton
                      variant="ghost"
                      size="action"
                      disabled={busy}
                      onClick={() => setDiscarding((d) => !d)}
                    >
                      Állítás elvetése
                    </PilotButton>
                    <button
                      type="button"
                      disabled={!canSave}
                      onClick={() => void save()}
                      className="h-10 rounded-md bg-pilot-accent-warm px-5 text-sm font-semibold text-white hover:bg-pilot-accent-warm-text disabled:opacity-50"
                    >
                      Állítás mentése
                    </button>
                  </div>
                  {pendingCount > 0 ? (
                    <p className="text-right text-sm text-pilot-grey-600">
                      Állítás csak az összes mező ellenőrzése után fogadható el.
                      Hátra van: {pendingCount}.
                    </p>
                  ) : null}
                  {discarding ? (
                    <div className="flex flex-wrap items-end gap-3 rounded-md bg-pilot-grey-50 p-3">
                      <label className="min-w-64 flex-1 space-y-1 text-sm text-pilot-grey-700">
                        <span>Miért hibás az állítás? (kötelező)</span>
                        <PilotInput
                          aria-label="Elvetés oka"
                          value={discardReason}
                          onChange={setDiscardReason}
                        />
                      </label>
                      <PilotButton
                        variant="danger"
                        size="action"
                        disabled={busy || !discardReason.trim()}
                        onClick={() => void discard()}
                      >
                        Elvetés mentése
                      </PilotButton>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </PilotCard>
          </div>

          <p className="text-sm text-pilot-blue-700">
            Forrás → horgony → mezőérték → ellenőrzés → jóváhagyás
          </p>
        </>
      )}

      <KnowledgeLayerLegend />
    </PilotThemeRoot>
  );
}

function SourcePanel({
  review,
  selected,
}: {
  review: ClaimReview;
  selected: ClaimReviewField | null;
}) {
  const inPassage =
    selected !== null && review.passage.text.includes(selected.anchor.text);
  return (
    <PilotCard className="space-y-4 p-5">
      <h2 className="text-lg font-semibold text-pilot-grey-900">
        Forrás és pontos szöveghely
      </h2>
      <div className="space-y-2">
        <p className="font-medium text-pilot-grey-900">
          {review.source.doi ? (
            <a
              href={`https://doi.org/${review.source.doi}`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              {review.source.title}
            </a>
          ) : (
            review.source.title
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <PilotBadge variant="blue">
            <span aria-hidden="true">●</span> Tudományos
          </PilotBadge>
          {review.source.retracted ? (
            <PilotBadge variant="danger">Visszavont</PilotBadge>
          ) : null}
          {review.source.corrected ? (
            <PilotBadge variant="amber">Javított</PilotBadge>
          ) : null}
        </div>
        <p className="text-sm text-pilot-grey-600">
          {[review.source.year, review.passage.locator]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <blockquote
        aria-label="Forrásszöveg"
        className="rounded-md bg-pilot-grey-50 p-4 text-[15px] leading-relaxed text-pilot-grey-900"
      >
        {inPassage ? (
          <Highlighted
            text={review.passage.text}
            part={selected!.anchor.text}
          />
        ) : (
          review.passage.text
        )}
      </blockquote>
      {selected && !inPassage ? (
        <div
          aria-label="Horgony"
          className="space-y-1 rounded-md bg-pilot-accent-warm-soft p-4"
        >
          <p className="text-sm text-pilot-grey-600">
            {FIELD_LABELS[selected.field] ?? selected.field} horgonya ·{" "}
            {selected.anchor.locator}
          </p>
          <p className="font-semibold text-pilot-grey-900">
            {selected.anchor.text}
          </p>
        </div>
      ) : null}
      <p className="text-sm text-pilot-grey-500">
        A pontos forráshelyek kiemelése a mezőre kattintva történik.
      </p>
    </PilotCard>
  );
}

function Highlighted({ text, part }: { text: string; part: string }) {
  const at = text.indexOf(part);
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-pilot-accent-warm-soft px-0.5 font-semibold text-pilot-grey-900">
        {part}
      </mark>
      {text.slice(at + part.length)}
    </>
  );
}

function EvidenceBadge({
  review,
  decisions,
}: {
  review: ClaimReview;
  decisions: Record<string, LocalDecision>;
}) {
  // the study type the editor's decisions leave standing (or the one decided earlier)
  const study = review.fields
    .filter((f) => f.field === "studyType")
    .map((f) => {
      const d = decisions[f.anchorId];
      if (d?.decision === "REJECT" || f.decision === "REJECTED") return null;
      if (d?.decision === "CORRECT") return d.text;
      if (f.decision === "CORRECTED") return f.correctedValue;
      return f.value;
    })
    .find((v) => v);
  if (!study) return null;
  return (
    <PilotBadge variant="success">
      Bizonyíték: {STUDY_LABELS[study] ?? study}
    </PilotBadge>
  );
}

function FieldRow(props: {
  field: ClaimReviewField;
  review: ClaimReview;
  local: LocalDecision | null;
  canDecide: boolean;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onCorrect: (value: unknown, text: string) => void;
}) {
  const { field: f, review, local } = props;
  const label = FIELD_LABELS[f.field] ?? f.field;
  const decidedEarlier = !required(f);
  const shown =
    local?.decision === "CORRECT"
      ? local.text
      : f.decision === "CORRECTED" && f.correctedValue
        ? valueText(f.field, f.correctedValue, review)
        : valueText(f.field, f.value, review);
  const state = local?.decision ?? (decidedEarlier ? f.decision : null);
  const pressed = (d: string) =>
    local?.decision === d
      ? "bg-pilot-grey-900 text-white ring-pilot-grey-900"
      : "bg-white text-pilot-grey-800 ring-pilot-grey-200 hover:bg-pilot-grey-50";

  return (
    <li
      data-field={f.field}
      data-state={state ?? "PENDING"}
      className="space-y-2"
    >
      <p className="text-sm text-pilot-grey-600">
        {label}
        {f.owner === "SOURCE" ? " (a forrásé)" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onSelect}
          aria-pressed={props.selected}
          aria-label={`${label}: horgony mutatása`}
          className={`min-h-10 flex-1 rounded-md px-3 py-2 text-left font-semibold ${
            f.question !== null && local?.decision !== "CORRECT"
              ? "bg-pilot-accent-warm-soft text-pilot-grey-900"
              : "bg-pilot-grey-50 text-pilot-grey-900"
          } ${local?.decision === "REJECT" || state === "REJECTED" ? "line-through opacity-60" : ""} ${
            props.selected ? "ring-2 ring-pilot-accent-warm" : ""
          }`}
        >
          {f.question !== null && local?.decision !== "CORRECT" ? (
            <>Ismeretlen érték: „{f.question}”</>
          ) : (
            shown
          )}
          {local?.decision === "CORRECT" ? (
            <span className="ml-2 text-xs font-normal text-pilot-grey-600">
              javítva
            </span>
          ) : null}
        </button>
        {props.canDecide && !decidedEarlier ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-label={`${label}: elfogad`}
              title={
                f.question !== null
                  ? "A szótárban nem szereplő érték nem fogadható el: javítsd vagy vesd el."
                  : "Elfogad"
              }
              disabled={f.question !== null}
              onClick={props.onAccept}
              className={`h-10 w-11 rounded-md text-sm ring-1 disabled:opacity-40 ${pressed("ACCEPT")}`}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label={`${label}: javít`}
              onClick={props.onEdit}
              className={`h-10 rounded-md px-3 text-sm ring-1 ${pressed("CORRECT")}`}
            >
              Javít
            </button>
            <button
              type="button"
              aria-label={`${label}: elvet`}
              onClick={props.onReject}
              className={`h-10 w-11 rounded-md text-sm ring-1 ${pressed("REJECT")}`}
            >
              ×
            </button>
          </div>
        ) : decidedEarlier ? (
          <PilotBadge variant="grey">A forráson már eldöntve</PilotBadge>
        ) : null}
      </div>
      {f.field === "quantity" &&
      review.quantity &&
      local?.decision !== "CORRECT" ? (
        <p className="text-sm text-pilot-grey-600">
          {/* only a phosphate value is converted (acrobot 35808): a nitrate
              shown as mg/l PO4 was a false number on the editor's screen */}
          {review.quantity.normalizedMinMgL !== null ||
          review.quantity.normalizedMaxMgL !== null
            ? `≈ ${quantityLabel(
                review.quantity.normalizedMinMgL,
                review.quantity.normalizedMaxMgL,
                "mg/l",
                "PO4",
              )}`
            : "Nincs átváltva mg/l PO₄-re: a horgony nem foszfát-értékről szól."}
        </p>
      ) : null}
      {props.editing ? (
        <CorrectionEditor
          field={f}
          review={review}
          onCancel={props.onCancelEdit}
          onSave={props.onCorrect}
        />
      ) : null}
    </li>
  );
}

function CorrectionEditor({
  field,
  review,
  onSave,
  onCancel,
}: {
  field: ClaimReviewField;
  review: ClaimReview;
  onSave: (value: unknown, text: string) => void;
  onCancel: () => void;
}) {
  const f = field.field;
  const q = review.quantity;
  const [text, setText] = useState(field.value ?? "");
  const [min, setMin] = useState(q?.min ?? "");
  const [max, setMax] = useState(q?.max ?? "");
  const [unit, setUnit] = useState<string>(q?.unit ?? "µmol/l");
  const [basis, setBasis] = useState<string>(q?.basis ?? "");
  // the machine's sample size is stored as "12 colonies": the editor starts from it
  const [machineCount, ...machineUnit] =
    f === "sampleSize" ? (field.value ?? "").split(" ") : [""];
  const [count, setCount] = useState(machineCount ?? "");
  const [countUnit, setCountUnit] = useState(machineUnit.join(" "));

  const choices: { key: string; label: string }[] | null =
    f === "species" || f === "environment" || f === "effect"
      ? review.options[f]
      : f === "direction"
        ? Object.entries(DIRECTION_LABELS).map(([key, label]) => ({
            key,
            label,
          }))
        : f === "studyType"
          ? Object.entries(STUDY_LABELS).map(([key, label]) => ({ key, label }))
          : f === "measurementMethod"
            ? Object.entries(METHOD_LABELS).map(([key, label]) => ({
                key,
                label,
              }))
            : null;

  const number = (s: string) =>
    s.trim() === "" ? null : Number(s.trim().replace(",", "."));

  const submit = () => {
    if (f === "quantity") {
      const lo = number(min);
      const hi = number(max);
      const b = basis === "PO4" || basis === "P" ? basis : null;
      onSave(
        { min: lo, max: hi, unit, basis: b },
        quantityLabel(lo, hi, unit, b),
      );
      return;
    }
    if (f === "sampleSize") {
      const n = number(count);
      onSave(
        { value: n, unit: countUnit.trim() || null },
        `${n ?? ""} ${countUnit.trim()}`.trim(),
      );
      return;
    }
    const label = choices?.find((c) => c.key === text)?.label ?? text;
    onSave(text, label);
  };

  const empty =
    f === "quantity"
      ? number(min) === null && number(max) === null
      : f === "sampleSize"
        ? number(count) === null
        : !text.trim();

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md bg-pilot-grey-50 p-3">
      {f === "quantity" ? (
        <>
          <label className="w-24 space-y-1 text-sm text-pilot-grey-700">
            <span>Alsó</span>
            <PilotInput aria-label="Alsó határ" value={min} onChange={setMin} />
          </label>
          <label className="w-24 space-y-1 text-sm text-pilot-grey-700">
            <span>Felső</span>
            <PilotInput
              aria-label="Felső határ"
              value={max}
              onChange={setMax}
            />
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Egység</span>
            <PilotSelect aria-label="Egység" value={unit} onChange={setUnit}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </PilotSelect>
          </label>
          <label className="space-y-1 text-sm text-pilot-grey-700">
            <span>Bázis</span>
            <PilotSelect aria-label="Bázis" value={basis} onChange={setBasis}>
              <option value="">nincs</option>
              <option value="PO4">PO₄</option>
              <option value="P">P</option>
            </PilotSelect>
          </label>
        </>
      ) : f === "sampleSize" ? (
        <>
          <label className="w-24 space-y-1 text-sm text-pilot-grey-700">
            <span>Darab</span>
            <PilotInput
              aria-label="Mintaszám"
              value={count}
              onChange={setCount}
            />
          </label>
          <label className="w-40 space-y-1 text-sm text-pilot-grey-700">
            <span>Egység</span>
            <PilotInput
              aria-label="Minta egysége"
              value={countUnit}
              onChange={setCountUnit}
            />
          </label>
        </>
      ) : choices ? (
        <label className="min-w-64 flex-1 space-y-1 text-sm text-pilot-grey-700">
          <span>Helyes érték</span>
          <PilotSelect
            aria-label="Helyes érték"
            value={text}
            onChange={setText}
          >
            <option value="">Válassz…</option>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </PilotSelect>
        </label>
      ) : (
        <label className="min-w-64 flex-1 space-y-1 text-sm text-pilot-grey-700">
          <span>Helyes érték (szó szerint a horgonyból)</span>
          <PilotInput
            aria-label="Helyes érték"
            value={text}
            onChange={setText}
          />
        </label>
      )}
      <PilotButton size="action" disabled={empty} onClick={submit}>
        Javítás rögzítése
      </PilotButton>
      <PilotButton variant="ghost" size="action" onClick={onCancel}>
        Mégse
      </PilotButton>
    </div>
  );
}
