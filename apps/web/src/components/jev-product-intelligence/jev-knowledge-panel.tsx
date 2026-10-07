"use client";

import { PilotSection } from "@acropora/ui";
import {
  PRODUCT_COPY_BLOCKS,
  PRODUCT_ENRICHMENT_FIELDS,
  PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES,
  type ProductCopyBlock,
  type ProductCopyEntry,
  type ProductEnrichmentFieldKey,
  type ProductFieldReview,
  type ProductKnowledgeFact,
  type ProductManualEvidenceInput,
  type ProductManualEvidenceSourceType,
} from "@acropora/types";
import { useEffect, useState, type FormEvent } from "react";

import {
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "@/components/pilot/pilot-ui";

import {
  COPY_BLOCK_LABEL,
  MANUAL_SOURCE_LABEL,
  acceptedLine,
  canApproveCopy,
  conflictMentions,
  copyStateLabel,
  isAcceptable,
  type ConflictingField,
} from "./jev-knowledge";
import { FIELD_LABEL } from "./jev-presentation";

const TEXTAREA_CLASS =
  "w-full rounded-md bg-white px-3 py-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500";

/**
 * "ELFOGAD" ON A FIELD ROW, AND WHAT IS ACCEPTED ALREADY.
 *
 * Only VERIFIED, SUGGESTED and CONFLICTING_SOURCES can be accepted; a
 * conflict is accepted WITHOUT a value (the shop then says the sources
 * disagree). Without `products.knowledge.approve` the button is not drawn:
 * the server refuses the write anyway, and a dead button teaches nothing.
 */
export function JevAcceptAction({
  review,
  fact,
  canApprove,
  busy,
  onAccept,
}: {
  review: ProductFieldReview;
  fact: ProductKnowledgeFact | null;
  canApprove: boolean;
  busy: boolean;
  onAccept: (fieldResultId: string) => void;
}) {
  const line = acceptedLine(fact, review);
  const current = fact?.fieldResultId === review.fieldResultId;
  const offer = canApprove && isAcceptable(review) && !current;
  if (!line && !offer) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 pt-2 text-xs leading-4">
      <p className={line ? "text-pilot-aqua-700" : "text-pilot-grey-500"}>
        {line ?? "Még nincs elfogadva."}
      </p>
      {offer ? (
        <PilotButton
          variant="secondary"
          size="regular"
          disabled={busy}
          onClick={() => onAccept(review.fieldResultId)}
        >
          {review.status === "CONFLICTING_SOURCES"
            ? "Elfogad ütközésként"
            : "Elfogad"}
        </PilotButton>
      ) : null}
    </div>
  );
}

const FIELD_OPTIONS = (
  Object.keys(PRODUCT_ENRICHMENT_FIELDS) as ProductEnrichmentFieldKey[]
).sort((a, b) => FIELD_LABEL[a].localeCompare(FIELD_LABEL[b], "hu"));

/**
 * A MANUAL EVIDENCE ENTRY: the source's own words, the value in the field's
 * form, where it came from. It is stored as an ordinary JEV check, and the
 * field is reconciled again with everything it already holds, so the
 * result can be a conflict.
 */
export function JevManualEvidenceForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: ProductManualEvidenceInput) => Promise<boolean>;
}) {
  const [field, setField] = useState<ProductEnrichmentFieldKey>("dosing");
  const [sourceType, setSourceType] =
    useState<ProductManualEvidenceSourceType>("MANUFACTURER_PAGE");
  const [url, setUrl] = useState("");
  const [raw, setRaw] = useState("");
  const [value, setValue] = useState("");
  const complete =
    url.trim() !== "" && raw.trim() !== "" && value.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!complete || busy) return;
    const stored = await onSubmit({ field, sourceType, url, raw, value });
    if (stored) {
      setRaw("");
      setValue("");
    }
  };

  return (
    <PilotSection
      title="Kézi bizonyíték"
      subtitle="Forrásból kimásolt adat, szó szerinti idézettel"
    >
      <form
        aria-label="Kézi bizonyíték"
        onSubmit={submit}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PilotFormField label="Mező" required>
            <PilotSelect
              aria-label="Mező"
              value={field}
              onChange={(next) => setField(next as ProductEnrichmentFieldKey)}
              chevron
            >
              {FIELD_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {FIELD_LABEL[key]}
                </option>
              ))}
            </PilotSelect>
          </PilotFormField>
          <PilotFormField label="Forrás fajtája" required>
            <PilotSelect
              aria-label="Forrás fajtája"
              value={sourceType}
              onChange={(next) =>
                setSourceType(next as ProductManualEvidenceSourceType)
              }
              chevron
            >
              {PRODUCT_MANUAL_EVIDENCE_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MANUAL_SOURCE_LABEL[type]}
                </option>
              ))}
            </PilotSelect>
          </PilotFormField>
        </div>
        <PilotFormField label="A forrás címe" required>
          <PilotInput
            aria-label="A forrás címe"
            type="url"
            value={url}
            onChange={setUrl}
            placeholder="https://"
          />
        </PilotFormField>
        <PilotFormField
          label="Szó szerinti idézet"
          help="Ahogy a forrásban áll, az eredeti nyelven."
          required
        >
          <textarea
            aria-label="Szó szerinti idézet"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
          />
        </PilotFormField>
        <PilotFormField
          label="Érték"
          help={
            field === "dosing"
              ? "Adagolásnál például: 1 drop/100 L/day vagy 1 drop/100 L, 1-2/week"
              : "A mező saját alakjában; a szerver ellenőrzi."
          }
          required
        >
          <PilotInput aria-label="Érték" value={value} onChange={setValue} />
        </PilotFormField>
        <div>
          <PilotButton
            type="submit"
            variant="primary"
            size="regular"
            disabled={!complete || busy}
          >
            Bizonyíték rögzítése
          </PilotButton>
        </div>
      </form>
    </PilotSection>
  );
}

/**
 * THE CUSTOMER COPY: one textarea per block, its state, save and approve.
 *
 * Saving makes the block a draft written against today's facts; approving
 * needs a fresh draft. A stale block (the facts changed since the save) is
 * never projected, and it says so above its text.
 */
export function JevCopyPanel({
  copy,
  conflicts = [],
  canApprove,
  busy,
  onSave,
  onApprove,
}: {
  copy: readonly ProductCopyEntry[];
  /** Fields whose sources disagree: the lead and the body warn about them. */
  conflicts?: readonly ConflictingField[];
  canApprove: boolean;
  busy: boolean;
  onSave: (block: ProductCopyBlock, body: string) => void;
  onApprove: (block: ProductCopyBlock) => void;
}) {
  return (
    <PilotSection
      title="Vevői szöveg"
      subtitle="Csak a jóváhagyott, nem elavult szöveg kerül a webshopba, és csak akkor, ha a termék minden elfogadott ténye ellenőrzött"
    >
      <div className="flex flex-col gap-4">
        {PRODUCT_COPY_BLOCKS.map((block) => (
          <CopyBlockEditor
            key={block}
            block={block}
            entry={copy.find((entry) => entry.block === block)}
            conflicts={block === "lead" || block === "body" ? conflicts : []}
            canApprove={canApprove}
            busy={busy}
            onSave={onSave}
            onApprove={onApprove}
          />
        ))}
      </div>
    </PilotSection>
  );
}

function CopyBlockEditor({
  block,
  entry,
  conflicts,
  canApprove,
  busy,
  onSave,
  onApprove,
}: {
  block: ProductCopyBlock;
  entry: ProductCopyEntry | undefined;
  conflicts: readonly ConflictingField[];
  canApprove: boolean;
  busy: boolean;
  onSave: (block: ProductCopyBlock, body: string) => void;
  onApprove: (block: ProductCopyBlock) => void;
}) {
  const saved = entry?.body ?? "";
  const [draft, setDraft] = useState(saved);
  // A save or a reload brings a new saved text; the editor follows it.
  useEffect(() => setDraft(saved), [saved]);
  const changed = draft.trim() !== saved;
  const label = COPY_BLOCK_LABEL[block];
  const oneLine = block === "seoTitle" || block === "metaDescription";

  return (
    <div className="flex flex-col gap-1.5" data-copy-block={block}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-pilot-grey-900">{label}</p>
        <p
          className={`text-xs ${
            entry?.stale ? "text-pilot-amber-700" : "text-pilot-grey-500"
          }`}
        >
          {copyStateLabel(entry)}
        </p>
      </div>
      <textarea
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={oneLine ? 1 : block === "body" ? 6 : 3}
        readOnly={!canApprove}
        className={TEXTAREA_CLASS}
      />
      <CopyConflictWarning text={draft} conflicts={conflicts} />
      {canApprove ? (
        <div className="flex flex-wrap gap-2">
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={busy || !changed || draft.trim() === ""}
            onClick={() => onSave(block, draft)}
          >
            {`${label} mentése`}
          </PilotButton>
          <PilotButton
            variant="primary"
            size="regular"
            disabled={busy || changed || !canApproveCopy(entry)}
            onClick={() => onApprove(block)}
          >
            {`${label} jóváhagyása`}
          </PilotButton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * THE COPY RULE, AS A WARNING (KZ Amino stage run, finding 7). Where the
 * sources disagree, the copy must not state a value: it would carry the
 * conflict into the shop. The text names a value of such a field: an amber
 * line quoting it. It names none: a quiet line naming the fields, because a
 * paraphrase in other words is not something a match can see. Never blocks.
 */
function CopyConflictWarning({
  text,
  conflicts,
}: {
  text: string;
  conflicts: readonly ConflictingField[];
}) {
  if (conflicts.length === 0) return null;
  const named = conflictMentions(text, conflicts);
  if (named.length > 0)
    return (
      <p role="alert" className="text-xs leading-4 text-pilot-amber-700">
        {`Figyelem: a szöveg ütköző értéket nevez meg (${named
          .map(
            (conflict) =>
              `${FIELD_LABEL[conflict.field]}: ${conflict.values.join(", ")}`,
          )
          .join(
            "; ",
          )}). A források ebben nem egyeznek, a szöveg ne állítson értéket.`}
      </p>
    );
  return (
    <p className="text-xs leading-4 text-pilot-grey-500">
      {`Ütköző mező: ${conflicts
        .map((conflict) => FIELD_LABEL[conflict.field])
        .join(
          ", ",
        )}. A szöveg ne nevezzen meg belőle értéket, a saját szavaival sem.`}
    </p>
  );
}
