"use client";

import {
  Alert,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
} from "@acropora/ui";
import { RichTextEditor } from "@acropora/ui/rich-text-editor";
import {
  EMPTY_QUOTE_RICH_TEXT,
  hasPermission,
  PERMISSIONS,
  type QuoteBlockKindValue,
  type QuoteCostingDto,
  type QuoteDetailDto,
  type QuoteInternalBlock,
  type QuoteInternalVersion,
  type QuoteSnippetDto,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";

import { bomLineName, QuoteBomDrawer } from "./quote-bom-drawer";
import {
  errorText,
  formatQuantity,
  formatQuoteMoney,
  isAbort,
  QUOTE_BLOCK_LABEL,
} from "./quote-format";
import { QuoteItemDrawer } from "./quote-item-drawer";
import { QUOTES_PATH } from "./quote-list-page";

type Item = QuoteInternalBlock["items"][number];

const TEXT_KINDS = new Set<QuoteBlockKindValue>([
  "TEXT",
  "TERMS",
  "SECTION",
  "OPTIONS",
  "SUMMARY",
]);
const ITEM_KINDS = new Set<QuoteBlockKindValue>(["SECTION", "OPTIONS"]);
const ADDABLE: ReadonlyArray<QuoteBlockKindValue> = [
  "TEXT",
  "SECTION",
  "OPTIONS",
  "TERMS",
  "SUMMARY",
  "PAGE_BREAK",
];
const EMPTY = JSON.stringify(EMPTY_QUOTE_RICH_TEXT);

/** A szerkeszthető verzió: az egyetlen DRAFT, ha van. */
export function draftVersion(
  quote: QuoteDetailDto,
): QuoteInternalVersion | null {
  return quote.versions.find((v) => v.status === "DRAFT") ?? null;
}

/**
 * AZ AJÁNLAT SZERKESZTŐJE (#1582 P1; Figma 35 · OS / Offers / Editor,
 * 569:171, a 572:383 és 573:782 interakciós keretekkel). Minden módosítás
 * azonnal ment (a végpontok soronként írnak, zárolva), és a válasz a teljes,
 * jogfüggő ajánlat. A PDF-előnézet és a kiküldés a P2-P3 része, a JEV-javaslat
 * nem P1: ezek nem jelennek meg.
 */
export function QuoteEditorPage({ quoteId }: { quoteId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const user = session?.user;
  const canView = Boolean(user && hasPermission(user, PERMISSIONS.QUOTES_VIEW));
  const canManage = Boolean(
    user && hasPermission(user, PERMISSIONS.QUOTES_MANAGE),
  );
  const canCosts = Boolean(
    user && hasPermission(user, PERMISSIONS.QUOTES_COSTS_VIEW),
  );
  const canCreateProduct = Boolean(
    user && hasPermission(user, PERMISSIONS.PRODUCTS_MANAGE),
  );

  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [costing, setCosting] = useState<QuoteCostingDto | null>(null);
  const [snippets, setSnippets] = useState<QuoteSnippetDto[]>([]);
  const [snippetId, setSnippetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [itemDrawer, setItemDrawer] = useState<{
    blockId: string | null;
    item: Item | null;
  } | null>(null);
  const [bomItemId, setBomItemId] = useState<string | null>(null);

  const version = quote ? draftVersion(quote) : null;

  const loadCosting = useCallback(
    async (current: QuoteDetailDto | null) => {
      const draft = current ? draftVersion(current) : null;
      if (!canCosts || !draft) return setCosting(null);
      try {
        setCosting(await quotesApi.costing(token, quoteId, draft.id));
      } catch {
        setCosting(null);
      }
    },
    [canCosts, quoteId, token],
  );

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    quotesApi
      .detail(token, quoteId, controller.signal)
      .then((loaded) => {
        setQuote(loaded);
        void loadCosting(loaded);
      })
      .catch((cause: unknown) => {
        if (!isAbort(cause))
          setError(errorText(cause, "Az ajánlat nem tölthető be."));
      });
    if (canManage)
      quotesApi
        .snippets(token, false, controller.signal)
        .then(setSnippets)
        .catch(() => setSnippets([]));
    return () => controller.abort();
  }, [canManage, canView, loadCosting, quoteId, token]);

  /** Egy írás: a válasz a friss ajánlat, utána a kalkuláció is frissül. */
  const write = async (action: () => Promise<QuoteDetailDto>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setQuote(next);
      await loadCosting(next);
      return true;
    } catch (cause) {
      setError(errorText(cause, "A módosítás nem menthető."));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saved = (next: QuoteDetailDto) => {
    setQuote(next);
    void loadCosting(next);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az árajánlatokhoz"
        description="quotes.view jogosultság szükséges."
      />
    );
  if (error && !quote)
    return <Alert variant="danger" title="Hiba történt" description={error} />;
  if (!quote) return <Skeleton className="h-64 w-full" />;

  const header = (
    <PilotPageHeader
      eyebrow="Pénzügy / Árajánlatok"
      title={`${quote.quoteNumber} · ${quote.title}`}
      description="Szerkeszd az ügyfélnek látható ajánlati dokumentumot blokkokból, miközben a belső kalkuláció külön marad."
      actions={
        <PilotButton
          variant="secondary"
          size="regular"
          onClick={() => router.push(`${QUOTES_PATH}/${quote.id}`)}
        >
          Ajánlat adatlapja
        </PilotButton>
      }
    />
  );

  if (!version || !canManage)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        {header}
        <Alert
          variant="info"
          title={canManage ? "Nincs szerkeszthető piszkozat" : "Csak olvasható"}
          description={
            canManage
              ? "A publikált verzió zárolva van. Az adatlapon nyitható belőle új verzió."
              : "quotes.manage jogosultság szükséges a szerkesztéshez."
          }
        />
      </PilotThemeRoot>
    );

  const v = version;
  const blocks = v.blocks;
  const move = (index: number, delta: number) => {
    const ids = blocks.map((b) => b.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void write(() => quotesApi.reorderBlocks(token, quote.id, v.id, ids));
  };
  const addBlock = (kind: QuoteBlockKindValue) =>
    void write(() =>
      quotesApi.addBlock(token, quote.id, v.id, {
        kind,
        title: kind === "PAGE_BREAK" ? null : QUOTE_BLOCK_LABEL[kind],
        ...(kind === "TEXT" || kind === "TERMS"
          ? { content: EMPTY_QUOTE_RICH_TEXT }
          : {}),
      }),
    );
  const lineFor = (itemId: string) =>
    costing?.lines.find((line) => line.itemId === itemId) ?? null;
  const bomItem =
    blocks.flatMap((b) => b.items).find((i) => i.id === bomItemId) ?? null;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      {header}
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}

      <PilotCard>
        <div className="grid gap-5 p-5 sm:grid-cols-4">
          <Fact label="Partner" value={quote.customerName ?? "—"} />
          <Fact label="Verzió" value={`v${v.versionNumber} · piszkozat`} />
          <div>
            <p className="text-xs text-pilot-grey-600">Érvényes</p>
            <input
              type="date"
              aria-label="Érvényesség"
              className="mt-1 rounded-md border border-pilot-grey-200 px-2 py-1 text-sm font-semibold"
              value={v.validUntil}
              disabled={busy}
              onChange={(event) =>
                event.target.value &&
                void write(() =>
                  quotesApi.updateVersion(token, quote.id, v.id, {
                    validUntil: event.target.value,
                  }),
                )
              }
            />
          </div>
          <Fact label="Pénznem" value={v.currency} />
        </div>
      </PilotCard>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {blocks.map((block, index) => (
            <BlockCard
              key={block.id}
              block={block}
              currency={v.currency}
              busy={busy}
              first={index === 0}
              last={index === blocks.length - 1}
              onMove={(delta) => move(index, delta)}
              onDelete={() =>
                void write(() =>
                  quotesApi.deleteBlock(token, quote.id, v.id, block.id),
                )
              }
              onSave={(patch) =>
                write(() =>
                  quotesApi.updateBlock(token, quote.id, v.id, block.id, patch),
                )
              }
              onAddItem={() => setItemDrawer({ blockId: block.id, item: null })}
              onEditItem={(item) => setItemDrawer({ blockId: null, item })}
              onBom={(item) => setBomItemId(item.id)}
              onDeleteItem={(item) =>
                void write(() =>
                  quotesApi.deleteItem(token, quote.id, v.id, item.id),
                )
              }
              bomCount={(itemId) =>
                v.bomItems.filter((b) => b.quoteItemId === itemId).length
              }
            />
          ))}

          <PilotCard>
            <div className="space-y-4 p-5">
              <p className="text-sm font-semibold text-pilot-aqua-700">
                + Új blokk hozzáadása
              </p>
              <div className="flex flex-wrap gap-2">
                {ADDABLE.map((kind) => (
                  <PilotButton
                    key={kind}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => addBlock(kind)}
                  >
                    {QUOTE_BLOCK_LABEL[kind]}
                  </PilotButton>
                ))}
                <PilotButton
                  variant="secondary"
                  disabled
                  title="A képfeltöltés egy későbbi fázisban jön."
                >
                  {QUOTE_BLOCK_LABEL.IMAGE}
                </PilotButton>
              </div>
              {snippets.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <PilotSelect
                    chevron
                    aria-label="Szövegrészlet"
                    value={snippetId}
                    onChange={setSnippetId}
                  >
                    <option value="">Szövegrészlet beszúrása…</option>
                    {snippets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </PilotSelect>
                  <PilotButton
                    variant="secondary"
                    disabled={!snippetId || busy}
                    onClick={() =>
                      void write(() =>
                        quotesApi.insertSnippet(
                          token,
                          quote.id,
                          v.id,
                          snippetId,
                        ),
                      ).then((ok) => ok && setSnippetId(""))
                    }
                  >
                    Beszúrás
                  </PilotButton>
                </div>
              ) : null}
            </div>
          </PilotCard>

          <MilestonesCard
            key={v.milestones.map((m) => `${m.label}:${m.percent}`).join("|")}
            initial={v.milestones.map((m) => ({
              label: m.label,
              percent: m.percent,
            }))}
            busy={busy}
            onSave={(milestones) =>
              write(() =>
                quotesApi.setMilestones(token, quote.id, v.id, milestones),
              )
            }
          />
        </div>

        <aside className="space-y-4">
          {canCosts ? (
            <PilotCard>
              <PilotCardHeader title="Belső kalkuláció" />
              <div className="space-y-3 p-5 text-sm">
                <p className="text-xs text-pilot-grey-600">
                  Az ügyfél PDF-jében nem jelenik meg.
                </p>
                {costing ? (
                  <>
                    <Fact
                      label="Eladási ár (nettó)"
                      value={formatQuoteMoney(costing.totals.net, v.currency)}
                    />
                    <Fact
                      label="Kiválasztott opciók"
                      value={formatQuoteMoney(v.optionalNetTotal, v.currency)}
                    />
                    <Fact
                      label="Becsült beszerzés"
                      value={`${formatQuoteMoney(costing.totals.cost, v.currency)}${costing.totals.costComplete ? "" : " (hiányos)"}`}
                    />
                    <Fact
                      label="Becsült fedezet"
                      value={
                        costing.totals.marginAmount === null
                          ? "—"
                          : `${formatQuoteMoney(costing.totals.marginAmount, v.currency)} · ${costing.totals.marginPercent ?? "—"}%`
                      }
                    />
                    {costing.warnings.map((w) => (
                      <p key={w} className="text-xs text-pilot-amber-700">
                        {w}
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-xs text-pilot-grey-600">
                    A kalkuláció nem tölthető be.
                  </p>
                )}
              </div>
            </PilotCard>
          ) : null}
          <PilotCard>
            <PilotCardHeader title="BOM / belső összetevők" />
            <ul className="space-y-1 p-5 text-sm">
              {v.bomItems.length === 0 ? (
                <li className="text-pilot-grey-600">Nincs BOM-sor.</li>
              ) : (
                v.bomItems.map((row) => (
                  <li key={row.id}>
                    • {bomLineName(row)} × {formatQuantity(row.quantity)}{" "}
                    {row.unit}
                  </li>
                ))
              )}
            </ul>
          </PilotCard>
        </aside>
      </div>

      <QuoteItemDrawer
        open={itemDrawer !== null}
        onClose={() => setItemDrawer(null)}
        token={token}
        quoteId={quote.id}
        versionId={v.id}
        currency={v.currency}
        blockId={itemDrawer?.blockId ?? null}
        item={itemDrawer?.item ?? null}
        costing={itemDrawer?.item ? lineFor(itemDrawer.item.id) : null}
        onSaved={saved}
      />
      <QuoteBomDrawer
        open={bomItem !== null}
        onClose={() => setBomItemId(null)}
        token={token}
        quoteId={quote.id}
        versionId={v.id}
        currency={v.currency}
        item={bomItem}
        rows={v.bomItems.filter((b) => b.quoteItemId === bomItemId)}
        costing={bomItem ? lineFor(bomItem.id) : null}
        canCosts={canCosts}
        canCreateProduct={canCreateProduct}
        onSaved={saved}
      />
    </PilotThemeRoot>
  );
}

function BlockCard({
  block,
  currency,
  busy,
  first,
  last,
  onMove,
  onDelete,
  onSave,
  onAddItem,
  onEditItem,
  onBom,
  onDeleteItem,
  bomCount,
}: {
  block: QuoteInternalBlock;
  currency: string;
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onSave: (patch: {
    title?: string | null;
    content?: unknown;
  }) => Promise<boolean>;
  onAddItem: () => void;
  onEditItem: (item: Item) => void;
  onBom: (item: Item) => void;
  onDeleteItem: (item: Item) => void;
  bomCount: (itemId: string) => number;
}) {
  const initialText =
    block.content && "type" in block.content
      ? JSON.stringify(block.content)
      : EMPTY;
  const [title, setTitle] = useState(block.title ?? "");
  const [text, setText] = useState(initialText);
  const dirty = title !== (block.title ?? "") || text !== initialText;
  const label = QUOTE_BLOCK_LABEL[block.kind];
  const subtotal = block.items
    .filter((i) => !i.isOptional)
    .reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitNetPrice), 0);

  return (
    <PilotCard>
      <section
        aria-label={`${label}: ${block.title ?? ""}`}
        className="space-y-4 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PilotBadge variant="grey">{label}</PilotBadge>
            {block.kind !== "PAGE_BREAK" ? (
              <PilotInput
                aria-label={`${label} címe`}
                value={title}
                onChange={setTitle}
              />
            ) : null}
          </div>
          <div className="flex gap-1">
            <PilotButton
              variant="ghost"
              aria-label={`${label}: feljebb`}
              disabled={busy || first}
              onClick={() => onMove(-1)}
            >
              ↑
            </PilotButton>
            <PilotButton
              variant="ghost"
              aria-label={`${label}: lejjebb`}
              disabled={busy || last}
              onClick={() => onMove(1)}
            >
              ↓
            </PilotButton>
            <PilotButton
              variant="ghost"
              aria-label={`${label}: törlés`}
              disabled={busy}
              onClick={onDelete}
            >
              ×
            </PilotButton>
          </div>
        </div>

        {block.kind === "PAGE_BREAK" ? (
          <div className="border-t-2 border-dashed border-pilot-grey-200 pt-2 text-center text-xs text-pilot-grey-600">
            Oldaltörés
          </div>
        ) : TEXT_KINDS.has(block.kind) ? (
          <RichTextEditor
            mode="quote"
            aria-label={`${label} szövege`}
            value={text}
            onChange={setText}
          />
        ) : null}

        {block.kind !== "PAGE_BREAK" && dirty ? (
          <PilotButton
            disabled={busy}
            onClick={() =>
              void onSave({
                title: title.trim() || null,
                ...(TEXT_KINDS.has(block.kind)
                  ? { content: JSON.parse(text) as unknown }
                  : {}),
              })
            }
          >
            Blokk mentése
          </PilotButton>
        ) : null}

        {ITEM_KINDS.has(block.kind) ? (
          <div className="space-y-2">
            {block.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-pilot-grey-200 p-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {item.isOptional ? "☐ " : ""}
                    {item.name}
                  </p>
                  {item.variantLabel ? (
                    <p className="text-xs text-pilot-grey-600">
                      {item.variantLabel}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {item.isOptional ? "+ " : ""}
                    {formatQuantity(item.quantity)} {item.unit} ×{" "}
                    {formatQuoteMoney(item.unitNetPrice, currency)}
                  </p>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    <PilotButton
                      variant="ghost"
                      aria-label={`${item.name}: szerkesztés`}
                      onClick={() => onEditItem(item)}
                    >
                      Szerkesztés
                    </PilotButton>
                    {item.source !== "STANDALONE" ? (
                      <PilotButton
                        variant="ghost"
                        aria-label={`${item.name}: BOM`}
                        onClick={() => onBom(item)}
                      >
                        Belső BOM: {bomCount(item.id)} tétel
                      </PilotButton>
                    ) : null}
                    <PilotButton
                      variant="ghost"
                      aria-label={`${item.name}: törlés`}
                      disabled={busy}
                      onClick={() => onDeleteItem(item)}
                    >
                      Törlés
                    </PilotButton>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={onAddItem}
              >
                + Tétel hozzáadása
              </PilotButton>
              {block.items.length ? (
                <p className="text-sm font-semibold text-pilot-aqua-700">
                  {block.kind === "OPTIONS"
                    ? "Az opcionális tételek alapból nem számítanak bele a főösszegbe."
                    : `Részösszeg: ${formatQuoteMoney(String(subtotal), currency)}`}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </PilotCard>
  );
}

function MilestonesCard({
  initial,
  busy,
  onSave,
}: {
  initial: Array<{ label: string; percent: string }>;
  busy: boolean;
  onSave: (
    milestones: Array<{ label: string; percent: string }>,
  ) => Promise<boolean>;
}) {
  const [rows, setRows] = useState(initial);
  const sum = rows.reduce(
    (s, r) => s + (Number(r.percent.replace(",", ".")) || 0),
    0,
  );
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const set = (index: number, key: "label" | "percent", value: string) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  return (
    <PilotCard>
      <PilotCardHeader title="Fizetési ütemezés" />
      <div className="space-y-3 p-5">
        {rows.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <PilotInput
              aria-label={`${index + 1}. mérföldkő neve`}
              value={row.label}
              onChange={(value) => set(index, "label", value)}
            />
            <PilotInput
              aria-label={`${index + 1}. mérföldkő százaléka`}
              inputMode="decimal"
              value={row.percent}
              onChange={(value) => set(index, "percent", value)}
            />
            <span className="text-sm">%</span>
            <PilotButton
              variant="ghost"
              aria-label={`${index + 1}. mérföldkő törlése`}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              ×
            </PilotButton>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <PilotButton
            variant="secondary"
            onClick={() => setRows([...rows, { label: "", percent: "" }])}
          >
            + Mérföldkő
          </PilotButton>
          <span
            className={`text-sm ${rows.length && Math.abs(sum - 100) > 1e-9 ? "text-pilot-red-700" : "text-pilot-grey-600"}`}
          >
            Összesen: {sum.toLocaleString("hu-HU")}%
          </span>
          {dirty ? (
            <PilotButton disabled={busy} onClick={() => void onSave(rows)}>
              Ütemezés mentése
            </PilotButton>
          ) : null}
        </div>
      </div>
    </PilotCard>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-pilot-grey-600">{label}</p>
      <p className="mt-1 font-semibold text-pilot-grey-900">{value}</p>
    </div>
  );
}
