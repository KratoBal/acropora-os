"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import {
  EMPTY_QUOTE_RICH_TEXT,
  hasPermission,
  parseQuoteRichText,
  PERMISSIONS,
  type QuoteBlockKindValue,
  type QuotePriceDisplay,
  type QuoteTemplateDto,
  type QuoteTemplateInput,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";

import {
  errorText,
  formatQuoteDay,
  isAbort,
  QUOTE_BLOCK_LABEL,
} from "./quote-format";
import { QUOTE_TEMPLATES_PATH, templateCopy } from "./quote-templates-page";

/** The kinds a template may hold (an image needs an upload, not in yet). */
const KINDS: QuoteBlockKindValue[] = [
  "TEXT",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
  "TERMS",
  "PAGE_BREAK",
];
/** Kinds that carry (or may carry) text. */
const TEXT_KINDS = new Set<QuoteBlockKindValue>([
  "TEXT",
  "TERMS",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
]);
/** Kinds whose text is required. */
const TEXT_REQUIRED = new Set<QuoteBlockKindValue>(["TEXT", "TERMS"]);
/** What a block becomes in a quote, in a few words. */
const BLOCK_HINT: Record<QuoteBlockKindValue, string> = {
  TEXT: "Szövegblokk",
  SECTION: "Fejezet · üres tételhelyekkel",
  OPTIONS: "Opciós blokk",
  SUMMARY: "Automatikus összesítő",
  TERMS: "Feltételek",
  IMAGE: "Kép",
  PAGE_BREAK: "Oldaltörés",
};
const PRICE_DISPLAY: Record<QuotePriceDisplay, string> = {
  NET: "Nettó árak",
  GROSS: "Bruttó árak",
  BOTH: "Nettó és bruttó",
};
const EMPTY = JSON.stringify(EMPTY_QUOTE_RICH_TEXT);

interface BlockDraft {
  key: string;
  kind: QuoteBlockKindValue;
  title: string;
  /** the text as the rich-text editor holds it (JSON) */
  content: string;
}

interface Draft {
  name: string;
  priceDisplay: QuotePriceDisplay;
  days: string;
  blocks: BlockDraft[];
  milestones: Array<{ label: string; percent: string }>;
}

let nextKey = 0;
const key = () => `b${++nextKey}`;

function draftOf(template: QuoteTemplateDto | null): Draft {
  if (!template)
    return {
      name: "",
      priceDisplay: "NET",
      days: "30",
      blocks: [],
      milestones: [],
    };
  return {
    name: template.name,
    priceDisplay: template.priceDisplay,
    days: String(template.defaultValidityDays),
    blocks: template.blocks.map((b) => ({
      key: key(),
      kind: b.kind,
      title: b.title ?? "",
      content: b.content ? JSON.stringify(b.content) : EMPTY,
    })),
    milestones: template.milestones.map((m) => ({ ...m })),
  };
}

/** The draft as the API takes it; an empty optional text is no text. */
export function templateInputOf(draft: Draft): QuoteTemplateInput {
  return {
    name: draft.name.trim(),
    priceDisplay: draft.priceDisplay,
    defaultValidityDays: Number(draft.days),
    blocks: draft.blocks.map((b) => {
      const content =
        TEXT_KINDS.has(b.kind) && b.content !== EMPTY
          ? parseQuoteRichText(JSON.parse(b.content))
          : null;
      return {
        kind: b.kind,
        title: b.title.trim() || null,
        content,
      };
    }),
    milestones: draft.milestones.map((m) => ({
      label: m.label.trim(),
      percent: m.percent.trim().replace(",", "."),
    })),
  };
}

/**
 * EGY AJÁNLATSABLON SZERKESZTÉSE (#1582; Figma 35 · OS / Offers / Template
 * Editor, 579:2562). Név, a blokkok sorrendje és szövege, az alapértelmezett
 * érvényesség, az ár-megjelenítés és a fizetési ütemezés; a mentés egyben
 * megy. A sablon nem élő ajánlat: módosítása a már megírt ajánlatokat nem
 * érinti. Nyelv, „Alapértelmezett” jelző és pénznem nincs: nincs mögöttük
 * modell (szándékos eltérés, FIGMA-MAP); a fizetési ütemezés a terven nem
 * látszik, de a sablon része (a P1 is ebből másolja).
 */
export function QuoteTemplateEditorPage({
  templateId,
}: {
  templateId: string | null;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_TEMPLATES_MANAGE),
  );
  const [template, setTemplate] = useState<QuoteTemplateDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(
    templateId ? null : draftOf(null),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<QuoteBlockKindValue>("TEXT");
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!canManage || !templateId) return;
    const controller = new AbortController();
    quotesApi
      .templateList(token, true, controller.signal)
      .then((list) => {
        const found = list.find((t) => t.id === templateId) ?? null;
        if (!found) setError("A sablon nem található.");
        setTemplate(found);
        setDraft(draftOf(found));
      })
      .catch((cause) => {
        if (!isAbort(cause))
          setError(errorText(cause, "A sablon nem tölthető be."));
      });
    return () => controller.abort();
  }, [canManage, templateId, token]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az ajánlatsablonokhoz"
        description="quotes.templates.manage jogosultság szükséges."
      />
    );
  if (!draft)
    return error ? (
      <Alert variant="danger" title="Hiba történt" description={error} />
    ) : (
      <Skeleton className="h-64 w-full" />
    );

  const readOnly = Boolean(template?.archivedAt);
  const change = (next: Partial<Draft>) => {
    setDraft({ ...draft, ...next });
    setSaved(false);
  };
  const setBlock = (index: number, next: Partial<BlockDraft>) =>
    change({
      blocks: draft.blocks.map((b, i) => (i === index ? { ...b, ...next } : b)),
    });
  const move = (index: number, delta: number) => {
    const blocks = [...draft.blocks];
    const [moved] = blocks.splice(index, 1);
    blocks.splice(index + delta, 0, moved!);
    change({ blocks });
  };
  const sum = draft.milestones.reduce(
    (s, m) => s + (Number(m.percent.replace(",", ".")) || 0),
    0,
  );
  const missingText = draft.blocks.some(
    (b) => TEXT_REQUIRED.has(b.kind) && b.content === EMPTY,
  );
  const days = Number(draft.days);
  const ready =
    !readOnly &&
    Boolean(draft.name.trim()) &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 365 &&
    !missingText &&
    (draft.milestones.length === 0 || Math.abs(sum - 100) < 0.001);

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const input = templateInputOf(draft);
      const next = template
        ? await quotesApi.updateTemplate(token, template.id, input)
        : await quotesApi.createTemplate(token, input);
      if (!template) {
        router.replace(`${QUOTE_TEMPLATES_PATH}/${next.id}`);
        return;
      }
      setTemplate(next);
      setDraft(draftOf(next));
      setSaved(true);
    } catch (cause) {
      setError(errorText(cause, "A sablon nem menthető."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const created = await quotesApi.createTemplate(
        token,
        templateCopy(template),
      );
      router.push(`${QUOTE_TEMPLATES_PATH}/${created.id}`);
    } catch (cause) {
      setError(errorText(cause, "A másolat nem készült el."));
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!template) return;
    setArchiving(false);
    setBusy(true);
    try {
      const next = await quotesApi.archiveTemplate(token, template.id);
      setTemplate(next);
    } catch (cause) {
      setError(errorText(cause, "A sablon nem archiválható."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Beállítások / Árajánlatok"
        title={template ? `Sablon · ${template.name}` : "Új sablon"}
        description="A sablon szerkezete új ajánlat létrehozásakor másolódik; az egyedi ajánlat később szabadon módosítható."
        actions={
          <div className="flex flex-wrap gap-2">
            <PilotButton
              variant="ghost"
              onClick={() => router.push(QUOTE_TEMPLATES_PATH)}
            >
              Vissza a sablonokhoz
            </PilotButton>
            {template ? (
              <PilotButton
                variant="secondary"
                size="regular"
                disabled={busy}
                onClick={() => void copy()}
              >
                Másolat készítése
              </PilotButton>
            ) : null}
            <PilotButton
              size="regular"
              disabled={!ready || busy}
              onClick={() => void save()}
            >
              Sablon mentése
            </PilotButton>
          </div>
        }
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {saved ? (
        <Alert variant="info" title="A sablon elmentve." description="" />
      ) : null}

      <PilotCard>
        <div className="flex flex-wrap items-end gap-6 p-5">
          <PilotFormField label="Sablon neve" required className="min-w-72">
            <PilotInput
              aria-label="Sablon neve"
              value={draft.name}
              readOnly={readOnly}
              onChange={(name) => change({ name })}
            />
          </PilotFormField>
          <div className="flex items-center gap-3">
            <PilotBadge variant={template?.archivedAt ? "grey" : "success"}>
              {template?.archivedAt ? "Archivált" : "Aktív"}
            </PilotBadge>
            {template && !readOnly ? (
              <PilotButton variant="ghost" onClick={() => setArchiving(true)}>
                Archiválás
              </PilotButton>
            ) : null}
          </div>
        </div>
      </PilotCard>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <PilotCard>
          <PilotCardHeader title="Sablon blokkjai" />
          <div className="space-y-3 p-5">
            {draft.blocks.length ? null : (
              <p className="text-sm text-pilot-grey-600">
                Még nincs blokk. Lent adhatsz hozzá.
              </p>
            )}
            <ol className="space-y-3">
              {draft.blocks.map((block, index) => {
                const label = `${index + 1}. blokk`;
                return (
                  <li
                    key={block.key}
                    className="rounded-lg p-4 ring-1 ring-pilot-grey-200"
                  >
                    <div className="flex items-start gap-3">
                      <span className="rounded bg-pilot-grey-50 px-2 py-0.5 text-xs text-pilot-grey-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-pilot-grey-900">
                          {block.title || QUOTE_BLOCK_LABEL[block.kind]}
                        </p>
                        <p className="text-xs text-pilot-grey-600">
                          {BLOCK_HINT[block.kind]}
                          {TEXT_REQUIRED.has(block.kind) &&
                          block.content === EMPTY
                            ? " · a szöveg még hiányzik"
                            : ""}
                        </p>
                      </div>
                      {readOnly ? null : (
                        <div className="flex gap-1">
                          <PilotButton
                            variant="ghost"
                            aria-label={`${label}: feljebb`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </PilotButton>
                          <PilotButton
                            variant="ghost"
                            aria-label={`${label}: lejjebb`}
                            disabled={index === draft.blocks.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </PilotButton>
                          <PilotButton
                            variant="ghost"
                            aria-label={`${label}: szerkesztés`}
                            onClick={() =>
                              setOpen(open === block.key ? null : block.key)
                            }
                          >
                            ✎
                          </PilotButton>
                          <PilotButton
                            variant="ghost"
                            aria-label={`${label}: másolat`}
                            onClick={() =>
                              change({
                                blocks: [
                                  ...draft.blocks.slice(0, index + 1),
                                  { ...block, key: key() },
                                  ...draft.blocks.slice(index + 1),
                                ],
                              })
                            }
                          >
                            ⧉
                          </PilotButton>
                          <PilotButton
                            variant="ghost"
                            aria-label={`${label}: eltávolítás`}
                            onClick={() =>
                              change({
                                blocks: draft.blocks.filter(
                                  (_, i) => i !== index,
                                ),
                              })
                            }
                          >
                            ×
                          </PilotButton>
                        </div>
                      )}
                    </div>
                    {open === block.key && !readOnly ? (
                      <div className="mt-4 space-y-3">
                        <PilotFormField label="Cím">
                          <PilotInput
                            aria-label={`${label}: cím`}
                            value={block.title}
                            onChange={(title) => setBlock(index, { title })}
                          />
                        </PilotFormField>
                        {TEXT_KINDS.has(block.kind) ? (
                          <RichTextEditor
                            mode="quote"
                            aria-label={`${label}: szöveg`}
                            value={block.content}
                            onChange={(content) => setBlock(index, { content })}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {readOnly ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <PilotSelect
                  aria-label="Új blokk fajtája"
                  chevron
                  className="w-48"
                  value={newKind}
                  onChange={(value) => setNewKind(value as QuoteBlockKindValue)}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {QUOTE_BLOCK_LABEL[kind]}
                    </option>
                  ))}
                </PilotSelect>
                <PilotButton
                  variant="secondary"
                  onClick={() => {
                    const added = {
                      key: key(),
                      kind: newKind,
                      title: "",
                      content: EMPTY,
                    };
                    change({ blocks: [...draft.blocks, added] });
                    setOpen(added.key);
                  }}
                >
                  + Blokk hozzáadása
                </PilotButton>
              </div>
            )}
          </div>
        </PilotCard>

        <PilotCard>
          <PilotCardHeader title="Alapértelmezések" />
          <div className="space-y-4 p-5">
            <PilotFormField
              label="Ajánlat érvényessége (nap)"
              help="Új ajánlatnál ennyi nappal későbbi dátum lesz az érvényesség."
            >
              <PilotInput
                aria-label="Ajánlat érvényessége (nap)"
                type="number"
                min={1}
                max={365}
                readOnly={readOnly}
                value={draft.days}
                onChange={(days) => change({ days })}
              />
            </PilotFormField>
            <PilotFormField label="PDF ármegjelenés">
              <PilotSelect
                aria-label="PDF ármegjelenés"
                chevron
                disabled={readOnly}
                value={draft.priceDisplay}
                onChange={(value) =>
                  change({ priceDisplay: value as QuotePriceDisplay })
                }
              >
                {(Object.keys(PRICE_DISPLAY) as QuotePriceDisplay[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {PRICE_DISPLAY[value]}
                    </option>
                  ),
                )}
              </PilotSelect>
            </PilotFormField>
            <PilotFormField
              label="Fizetési ütemezés"
              help={
                draft.milestones.length
                  ? `Összesen ${sum}%${Math.abs(sum - 100) < 0.001 ? "" : ", 100% kell legyen"}.`
                  : "Nincs ütemezés: az ajánlatban adható meg."
              }
            >
              <div className="space-y-2">
                {draft.milestones.map((m, index) => (
                  <div key={index} className="flex gap-2">
                    <PilotInput
                      aria-label={`${index + 1}. mérföldkő neve`}
                      readOnly={readOnly}
                      value={m.label}
                      onChange={(label) =>
                        change({
                          milestones: draft.milestones.map((x, i) =>
                            i === index ? { ...x, label } : x,
                          ),
                        })
                      }
                    />
                    <PilotInput
                      aria-label={`${index + 1}. mérföldkő százaléka`}
                      className="w-20"
                      inputMode="decimal"
                      readOnly={readOnly}
                      value={m.percent}
                      onChange={(percent) =>
                        change({
                          milestones: draft.milestones.map((x, i) =>
                            i === index ? { ...x, percent } : x,
                          ),
                        })
                      }
                    />
                    {readOnly ? null : (
                      <PilotButton
                        variant="ghost"
                        aria-label={`${index + 1}. mérföldkő törlése`}
                        onClick={() =>
                          change({
                            milestones: draft.milestones.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        ×
                      </PilotButton>
                    )}
                  </div>
                ))}
                {readOnly ? null : (
                  <PilotButton
                    variant="ghost"
                    onClick={() =>
                      change({
                        milestones: [
                          ...draft.milestones,
                          { label: "", percent: "" },
                        ],
                      })
                    }
                  >
                    + Mérföldkő
                  </PilotButton>
                )}
              </div>
            </PilotFormField>
            <div className="rounded-lg bg-pilot-aqua-50 p-4 text-sm text-pilot-grey-700">
              <p className="font-semibold">Sablon ≠ élő ajánlat</p>
              <p className="mt-1 text-xs">
                A sablon módosítása nem változtatja meg a korábban létrehozott
                ajánlatokat. Új ajánlat indításakor készül belőle másolat.
              </p>
            </div>
            {template ? (
              <p className="text-xs text-pilot-grey-600">
                Utolsó módosítás: {formatQuoteDay(template.updatedAt)}
              </p>
            ) : null}
          </div>
        </PilotCard>
      </div>

      <ConfirmDialog
        open={archiving}
        title="Sablon archiválása"
        consequence="Az archivált sablonból nem indítható új ajánlat. A belőle már létrehozott ajánlatok nem változnak."
        recovery="Visszaállítás most nincs: ha újra kell, a Másolat készítésével vehetsz fel újat belőle."
        confirmLabel="Archiválás"
        onConfirm={() => void archive()}
        onCancel={() => setArchiving(false)}
      />
    </PilotThemeRoot>
  );
}
