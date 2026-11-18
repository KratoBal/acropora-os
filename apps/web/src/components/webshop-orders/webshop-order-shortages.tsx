"use client";
import {
  WEBSHOP_SHORTAGE_CHANNELS,
  WEBSHOP_SHORTAGE_CHOICES,
  type WebshopOrderLine,
  type WebshopOrderShortageAgreementInput,
  type WebshopOrderShortageOpenInput,
  type WebshopOrderShortageResolveInput,
  type WebshopOrderShortageView,
  type WebshopShortageChannel,
  type WebshopShortageChoice,
  type WebshopShortageStatus,
  type WebshopVariantOption,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSelect,
  type PilotBadgeVariant,
} from "@/components/pilot/pilot-ui";
import { webshopOrdersApi } from "@/lib/api/webshop-orders";
import { formatDateTimeHu } from "@/lib/format/date";

import { DialogShell } from "./webshop-order-lines";

/**
 * A KÉSZLETHIÁNY KÁRTYÁJA A WEBSHOP-RENDELÉS LAPJÁN (task t-20261118-keszlethiany-kepernyo; card ac167fc2, második szelet). A #2670 API-ja
 * rögzíti, miben állapodtak meg a vevővel, amikor a rendelés után kiderül a hiány: a három választás (szétbontás, csere, elhagyás), a
 * csatorna, mit mondtak, tételenként a rendelt, a meglévő és a jóváhagyott mennyiség, a csere változata, és a kapcsolt (szétbontott)
 * rendelés. A kártya NEM szerkeszti a rendelést: a tételművelet és a szétbontás marad a módosítás útja. Vevő-oldali szöveg nincs.
 *
 * A kliens UGYANAZOKAT a szabályokat ellenőrzi, mint a szerver (jegyzet kötelező, egész mennyiség a tartományban, legalább egy
 * csökkentett tétel, cserénél a változat, szétbontásnál a kapcsolt rendelés), hogy a gomb a 422 előtt tiltva legyen, magyarázattal.
 * A szerver marad a döntő: a válasza hibaszövegét a párbeszédablak megmutatja.
 */
export const SHORTAGE_STATUS_LABELS: Record<WebshopShortageStatus, string> = {
  OPEN: "Nyitott",
  AGREED: "Megállapodott",
  DONE: "Lezárva",
  WITHDRAWN: "Visszavonva",
};

export const SHORTAGE_CHOICE_LABELS: Record<WebshopShortageChoice, string> = {
  SPLIT: "Szétbontjuk a rendelést",
  REPLACE: "Cserélünk",
  REMOVE: "Elhagyjuk a hiányzó tételt",
};

export const SHORTAGE_CHANNEL_LABELS: Record<WebshopShortageChannel, string> = {
  PHONE: "Telefon",
  EMAIL: "E-mail",
  OTHER: "Egyéb",
};

const STATUS_VARIANT: Record<WebshopShortageStatus, PilotBadgeVariant> = {
  OPEN: "amber",
  AGREED: "teal",
  DONE: "success",
  WITHDRAWN: "grey",
};

const ACTIVE: readonly WebshopShortageStatus[] = ["OPEN", "AGREED"];

type OrderForShortages = { id: string; lines: WebshopOrderLine[] };

type DialogState =
  | { kind: "open" }
  | { kind: "agree"; shortage: WebshopOrderShortageView }
  | {
      kind: "resolve";
      shortage: WebshopOrderShortageView;
      outcome: "done" | "withdrawn";
    };

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

const isWhole = (value: number) => Number.isInteger(value);

export function ShortagesCard({
  order,
  canManage,
  onSearchVariants,
}: {
  order: OrderForShortages;
  canManage: boolean;
  /** The page's own variant search: the replacement is picked from the same list as the line replace dialog. */
  onSearchVariants: (query: string) => Promise<WebshopVariantOption[]>;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [cases, setCases] = useState<WebshopOrderShortageView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    webshopOrdersApi
      .shortages(token, order.id, controller.signal)
      .then(setCases)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("A készlethiányok listája nem tölthető be.");
      });
    return () => controller.abort();
  }, [token, order.id]);

  const reload = useCallback(async () => {
    setCases(await webshopOrdersApi.shortages(token, order.id));
  }, [token, order.id]);

  const activeItems = new Set(
    (cases ?? [])
      .filter((c) => ACTIVE.includes(c.status))
      .flatMap((c) => c.lines.map((l) => l.itemId)),
  );

  return (
    // the same section as the other cards of this page (its `Card` is local to the page file)
    <section
      aria-label="Készlethiány"
      className="rounded-2xl border border-pilot-grey-200 bg-white p-5"
    >
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          Készlethiány
        </h2>
        {canManage ? (
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() => setDialog({ kind: "open" })}
          >
            Hiány felvétele
          </PilotButton>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-pilot-red-700">
          {error}
        </p>
      ) : cases === null ? (
        <div
          aria-label="Készlethiányok betöltése"
          className="h-12 animate-pulse rounded-lg bg-pilot-grey-100"
        />
      ) : cases.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          Nincs rögzített készlethiány ezen a rendelésen.
        </p>
      ) : (
        <div className="space-y-3">
          {cases.map((shortage) => (
            <ShortageItem
              key={shortage.id}
              shortage={shortage}
              canManage={canManage}
              onAgree={() => setDialog({ kind: "agree", shortage })}
              onResolve={(outcome) =>
                setDialog({ kind: "resolve", shortage, outcome })
              }
            />
          ))}
        </div>
      )}
      {dialog?.kind === "open" ? (
        <OpenDialog
          lines={order.lines}
          activeItems={activeItems}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await webshopOrdersApi.openShortage(token, order.id, input);
            await reload();
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === "agree" ? (
        <AgreementDialog
          shortage={dialog.shortage}
          onSearchVariants={onSearchVariants}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await webshopOrdersApi.agreeShortage(
              token,
              order.id,
              dialog.shortage.id,
              input,
            );
            await reload();
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === "resolve" ? (
        <ResolveDialog
          shortage={dialog.shortage}
          outcome={dialog.outcome}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await webshopOrdersApi.resolveShortage(
              token,
              order.id,
              dialog.shortage.id,
              input,
            );
            await reload();
            setDialog(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ShortageItem({
  shortage,
  canManage,
  onAgree,
  onResolve,
}: {
  shortage: WebshopOrderShortageView;
  canManage: boolean;
  onAgree: () => void;
  onResolve: (outcome: "done" | "withdrawn") => void;
}) {
  const active = ACTIVE.includes(shortage.status);
  return (
    <article
      data-testid={`shortage-${shortage.id}`}
      className="space-y-3 rounded-xl border border-pilot-grey-200 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PilotBadge variant={STATUS_VARIANT[shortage.status]}>
          {SHORTAGE_STATUS_LABELS[shortage.status]}
        </PilotBadge>
        <span className="text-xs text-pilot-grey-500">
          Felvéve: {formatDateTimeHu(shortage.detectedAt)}
        </span>
      </div>
      <ul className="space-y-2">
        {shortage.lines.map((line) => (
          <li key={line.id} className="text-sm text-pilot-grey-800">
            <span className="font-medium">{line.title}</span>
            {line.sku ? (
              <span className="ml-2 text-xs text-pilot-grey-500">
                {line.sku}
              </span>
            ) : null}
            <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-pilot-grey-600">
              <span>rendelve {line.orderedQuantity} db</span>
              {line.availableQuantity !== null ? (
                <span>van {line.availableQuantity} db</span>
              ) : null}
              {line.agreedQuantity !== null ? (
                <span>jóváhagyott {line.agreedQuantity} db</span>
              ) : null}
              {line.replacementVariantId ? (
                <span>
                  csere: {line.replacementSku ?? line.replacementVariantId}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {shortage.choice ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-pilot-grey-500">Választás</dt>
          <dd>{SHORTAGE_CHOICE_LABELS[shortage.choice]}</dd>
          {shortage.channel ? (
            <>
              <dt className="text-pilot-grey-500">Csatorna</dt>
              <dd>{SHORTAGE_CHANNEL_LABELS[shortage.channel]}</dd>
            </>
          ) : null}
          {shortage.agreedAt ? (
            <>
              <dt className="text-pilot-grey-500">Mikor</dt>
              <dd>{formatDateTimeHu(shortage.agreedAt)}</dd>
            </>
          ) : null}
          {shortage.agreementNote ? (
            <>
              <dt className="text-pilot-grey-500">Mit mondtak</dt>
              <dd className="break-words">{shortage.agreementNote}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {shortage.splitOrderId ? (
        <p className="text-sm">
          <Link
            href={`/webshop/rendelesek/${encodeURIComponent(shortage.splitOrderId)}`}
            className="font-medium text-pilot-aqua-700 underline"
          >
            A kapcsolt rendelés megnyitása
          </Link>
        </p>
      ) : null}
      {shortage.resolutionNote ? (
        <p className="break-words text-sm text-pilot-grey-700">
          {shortage.resolutionNote}
        </p>
      ) : null}
      {canManage && active ? (
        <div className="flex flex-wrap gap-2">
          <PilotButton size="regular" variant="secondary" onClick={onAgree}>
            {shortage.status === "AGREED"
              ? "Megállapodás módosítása"
              : "Megállapodás rögzítése"}
          </PilotButton>
          {shortage.status === "AGREED" ? (
            <PilotButton
              size="regular"
              variant="secondary"
              onClick={() => onResolve("done")}
            >
              Lezárás
            </PilotButton>
          ) : null}
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() => onResolve("withdrawn")}
          >
            Visszavonás
          </PilotButton>
        </div>
      ) : null}
    </article>
  );
}

function CancelButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <PilotButton
      size="regular"
      variant="secondary"
      disabled={busy}
      onClick={onClick}
    >
      Mégse
    </PilotButton>
  );
}

/** One submit with the busy flag and the server's error text, for the three dialogs. */
function useSubmit(run: () => Promise<void>, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(message(cause, fallback));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function OpenDialog({
  lines,
  activeItems,
  onClose,
  onSubmit,
}: {
  lines: WebshopOrderLine[];
  activeItems: Set<string>;
  onClose: () => void;
  onSubmit: (input: WebshopOrderShortageOpenInput) => Promise<void>;
}) {
  // itemId -> the available quantity as typed ("" when unknown); an absent key is an item not picked
  const [picked, setPicked] = useState<Record<string, string>>({});
  const ids = Object.keys(picked);
  const hint = (() => {
    for (const id of ids) {
      const line = lines.find((l) => l.id === id)!;
      const text = picked[id]!.trim();
      if (text === "") continue;
      const n = Number(text);
      if (!isWhole(n) || n < 0 || n >= line.quantity)
        return `${line.title}: a meglévő mennyiség kisebb legyen a rendeltnél (0 és ${line.quantity - 1} közötti egész szám).`;
    }
    return null;
  })();
  const { busy, error, submit } = useSubmit(
    () =>
      onSubmit({
        lines: ids.map((id) => {
          const text = picked[id]!.trim();
          return text === ""
            ? { itemId: id }
            : { itemId: id, availableQuantity: Number(text) };
        }),
      }),
    "A hiány felvétele nem sikerült.",
  );
  return (
    <DialogShell
      title="Hiány felvétele"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <CancelButton busy={busy} onClick={onClose} />
          <PilotButton
            size="regular"
            variant="primary"
            disabled={busy || ids.length === 0 || hint !== null}
            onClick={() => void submit()}
          >
            {busy ? "Felvétel…" : "Felvétel"}
          </PilotButton>
        </>
      }
    >
      <p className="text-sm text-pilot-grey-600">
        Jelöld meg a tételeket, amelyekből kevesebb van, mint amennyit a vevő
        rendelt. A rendelt mennyiséget a rendelés adja.
      </p>
      <ul className="space-y-2">
        {lines.map((line) => {
          const taken = activeItems.has(line.id);
          const isPicked = line.id in picked;
          return (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 text-sm text-pilot-grey-800"
            >
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={line.title}
                  disabled={taken}
                  checked={isPicked}
                  onChange={(event) =>
                    setPicked((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[line.id] = "";
                      else delete next[line.id];
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  {line.title}
                  <span className="block text-xs text-pilot-grey-500">
                    rendelve: {line.quantity} db
                    {taken ? " · már van nyitott hiánya" : ""}
                  </span>
                </span>
              </label>
              {isPicked ? (
                <PilotInput
                  aria-label={`${line.title}: meglévő mennyiség`}
                  type="number"
                  min={0}
                  max={line.quantity - 1}
                  placeholder="van"
                  value={picked[line.id] ?? ""}
                  onChange={(value) =>
                    setPicked((current) => ({ ...current, [line.id]: value }))
                  }
                  className="w-20"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {hint ? <p className="text-xs text-pilot-red-700">{hint}</p> : null}
    </DialogShell>
  );
}

function AgreementDialog({
  shortage,
  onSearchVariants,
  onClose,
  onSubmit,
}: {
  shortage: WebshopOrderShortageView;
  onSearchVariants: (query: string) => Promise<WebshopVariantOption[]>;
  onClose: () => void;
  onSubmit: (input: WebshopOrderShortageAgreementInput) => Promise<void>;
}) {
  const [choice, setChoice] = useState<WebshopShortageChoice>(
    shortage.choice ?? "SPLIT",
  );
  const [channel, setChannel] = useState<WebshopShortageChannel>(
    shortage.channel ?? "PHONE",
  );
  const [when, setWhen] = useState("");
  const [note, setNote] = useState(shortage.agreementNote ?? "");
  const [agreed, setAgreed] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      shortage.lines.map((l) => [
        l.itemId,
        String(l.agreedQuantity ?? l.availableQuantity ?? l.orderedQuantity),
      ]),
    ),
  );
  const [variants, setVariants] = useState<
    Record<string, { variantId: string; sku: string | null } | undefined>
  >(() =>
    Object.fromEntries(
      shortage.lines
        .filter((l) => l.replacementVariantId)
        .map((l) => [
          l.itemId,
          { variantId: l.replacementVariantId!, sku: l.replacementSku },
        ]),
    ),
  );
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<
    Record<string, WebshopVariantOption[] | undefined>
  >({});
  const [searchError, setSearchError] = useState<string | null>(null);

  // an empty field is no quantity (Number("") would read it as 0, a line dropped by accident)
  const quantityOf = (itemId: string) =>
    (agreed[itemId] ?? "").trim() === "" ? Number.NaN : Number(agreed[itemId]);
  const reduced = (l: WebshopOrderShortageView["lines"][number]) =>
    quantityOf(l.itemId) < l.orderedQuantity;
  const whenDate = when ? new Date(when) : null;
  const hint = (() => {
    for (const l of shortage.lines) {
      const n = quantityOf(l.itemId);
      if (!isWhole(n) || n < 0 || n > l.orderedQuantity)
        return `${l.title}: a jóváhagyott mennyiség 0 és ${l.orderedQuantity} közötti egész szám.`;
    }
    if (!shortage.lines.some(reduced))
      return "Legalább egy tétel mennyiségének csökkennie kell, különben nincs mit megállapítani.";
    if (choice === "REPLACE")
      for (const l of shortage.lines)
        if (reduced(l) && !variants[l.itemId])
          return `${l.title}: válaszd ki a cserét.`;
    if (whenDate && Number.isNaN(whenDate.getTime()))
      return "A megállapodás ideje nem érvényes.";
    if (!note.trim()) return "Írd le, miben állapodtatok meg.";
    return null;
  })();

  const { busy, error, submit } = useSubmit(
    () =>
      onSubmit({
        choice,
        channel,
        ...(whenDate ? { agreedAt: whenDate.toISOString() } : {}),
        note: note.trim(),
        lines: shortage.lines.map((l) => {
          const variant =
            choice === "REPLACE" && reduced(l) ? variants[l.itemId] : undefined;
          return {
            itemId: l.itemId,
            agreedQuantity: quantityOf(l.itemId),
            ...(variant
              ? {
                  replacementVariantId: variant.variantId,
                  ...(variant.sku ? { replacementSku: variant.sku } : {}),
                }
              : {}),
          };
        }),
      }),
    "A megállapodás rögzítése nem sikerült.",
  );

  const search = async (itemId: string) => {
    setSearchError(null);
    try {
      const found = await onSearchVariants(queries[itemId] ?? "");
      setOptions((current) => ({ ...current, [itemId]: found }));
    } catch (cause) {
      setSearchError(message(cause, "A keresés nem sikerült."));
    }
  };

  return (
    <DialogShell
      title="Megállapodás rögzítése"
      onClose={onClose}
      busy={busy}
      error={error ?? searchError}
      footer={
        <>
          <CancelButton busy={busy} onClick={onClose} />
          <PilotButton
            size="regular"
            variant="primary"
            disabled={busy || hint !== null}
            onClick={() => void submit()}
          >
            {busy ? "Rögzítés…" : "Rögzítés"}
          </PilotButton>
        </>
      }
    >
      <fieldset className="space-y-1">
        <legend className="text-xs text-pilot-grey-500">
          Mit választott a vevő?
        </legend>
        {WEBSHOP_SHORTAGE_CHOICES.map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="shortage-choice"
              aria-label={SHORTAGE_CHOICE_LABELS[value]}
              checked={choice === value}
              onChange={() => setChoice(value)}
            />
            {SHORTAGE_CHOICE_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs text-pilot-grey-500">
          Csatorna
          <PilotSelect
            aria-label="Csatorna"
            value={channel}
            onChange={(value) => setChannel(value as WebshopShortageChannel)}
          >
            {WEBSHOP_SHORTAGE_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {SHORTAGE_CHANNEL_LABELS[value]}
              </option>
            ))}
          </PilotSelect>
        </label>
        <label className="block text-xs text-pilot-grey-500">
          Mikor egyeztek meg (ha nem most)
          <PilotInput
            aria-label="Mikor egyeztek meg (ha nem most)"
            type="datetime-local"
            value={when}
            onChange={setWhen}
            className="mt-1"
          />
        </label>
      </div>
      <ul className="space-y-3">
        {shortage.lines.map((l) => (
          <li key={l.itemId} className="space-y-2 text-sm text-pilot-grey-800">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                {l.title}
                <span className="block text-xs text-pilot-grey-500">
                  rendelve {l.orderedQuantity} db
                  {l.availableQuantity !== null
                    ? `, van ${l.availableQuantity} db`
                    : ""}
                </span>
              </span>
              <PilotInput
                aria-label={`${l.title}: jóváhagyott mennyiség`}
                type="number"
                min={0}
                max={l.orderedQuantity}
                value={agreed[l.itemId] ?? ""}
                onChange={(value) =>
                  setAgreed((current) => ({ ...current, [l.itemId]: value }))
                }
                className="w-20"
              />
            </div>
            {choice === "REPLACE" && reduced(l) ? (
              <div className="space-y-2 rounded-lg bg-pilot-grey-50 p-3">
                <div className="flex gap-2">
                  <PilotInput
                    aria-label={`${l.title}: csere keresése`}
                    placeholder="Név vagy cikkszám"
                    value={queries[l.itemId] ?? ""}
                    onChange={(value) =>
                      setQueries((current) => ({
                        ...current,
                        [l.itemId]: value,
                      }))
                    }
                  />
                  <PilotButton
                    size="regular"
                    variant="secondary"
                    disabled={(queries[l.itemId] ?? "").trim().length < 2}
                    onClick={() => void search(l.itemId)}
                  >
                    Keresés
                  </PilotButton>
                </div>
                {variants[l.itemId] ? (
                  <p className="text-xs text-pilot-grey-600">
                    Kiválasztva:{" "}
                    {variants[l.itemId]!.sku ?? variants[l.itemId]!.variantId}
                  </p>
                ) : null}
                {options[l.itemId] ? (
                  options[l.itemId]!.length ? (
                    <ul
                      aria-label="Találatok"
                      className="max-h-40 space-y-1 overflow-y-auto"
                    >
                      {options[l.itemId]!.map((option) => (
                        <li key={option.variantId}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`replacement-${l.itemId}`}
                              checked={
                                variants[l.itemId]?.variantId ===
                                option.variantId
                              }
                              onChange={() =>
                                setVariants((current) => ({
                                  ...current,
                                  [l.itemId]: {
                                    variantId: option.variantId,
                                    sku: option.sku,
                                  },
                                }))
                              }
                            />
                            {option.title}
                            {option.sku ? (
                              <span className="text-xs text-pilot-grey-500">
                                {option.sku}
                              </span>
                            ) : null}
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-pilot-grey-500">
                      Nincs találat.
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <label className="block text-xs text-pilot-grey-500">
        Mit mondtak
        <textarea
          aria-label="Mit mondtak"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-pilot-grey-200 p-2 text-sm text-pilot-grey-900"
        />
      </label>
      {hint ? <p className="text-xs text-pilot-red-700">{hint}</p> : null}
    </DialogShell>
  );
}

function ResolveDialog({
  shortage,
  outcome,
  onClose,
  onSubmit,
}: {
  shortage: WebshopOrderShortageView;
  outcome: "done" | "withdrawn";
  onClose: () => void;
  onSubmit: (input: WebshopOrderShortageResolveInput) => Promise<void>;
}) {
  const [splitOrderId, setSplitOrderId] = useState("");
  const [note, setNote] = useState("");
  const done = outcome === "done";
  const needsSplit = done && shortage.choice === "SPLIT";
  const missing = needsSplit ? !splitOrderId.trim() : !done && !note.trim();
  const { busy, error, submit } = useSubmit(
    () =>
      onSubmit(
        done
          ? needsSplit
            ? { outcome: "done", splitOrderId: splitOrderId.trim() }
            : { outcome: "done" }
          : { outcome: "withdrawn", note: note.trim() },
      ),
    done ? "A lezárás nem sikerült." : "A visszavonás nem sikerült.",
  );
  const title = done ? "Lezárás" : "Visszavonás";
  return (
    <DialogShell
      title={title}
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <CancelButton busy={busy} onClick={onClose} />
          <PilotButton
            size="regular"
            variant="primary"
            disabled={busy || missing}
            onClick={() => void submit()}
          >
            {title} rögzítése
          </PilotButton>
        </>
      }
    >
      {done ? (
        <>
          <p className="text-sm text-pilot-grey-600">
            A megállapodást végrehajtottuk. A lezárás után a hiány nem
            módosítható.
          </p>
          {needsSplit ? (
            <label className="block text-xs text-pilot-grey-500">
              A kapcsolt (új) rendelés azonosítója
              <PilotInput
                aria-label="A kapcsolt (új) rendelés azonosítója"
                value={splitOrderId}
                onChange={setSplitOrderId}
                maxLength={64}
                className="mt-1"
              />
              <span className="mt-1 block">
                A szétbontás után létrejött új rendelés webcímének utolsó része.
              </span>
            </label>
          ) : null}
        </>
      ) : (
        <label className="block text-xs text-pilot-grey-500">
          Az indok
          <textarea
            aria-label="Az indok"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
            className="mt-1 w-full rounded-lg border border-pilot-grey-200 p-2 text-sm text-pilot-grey-900"
          />
        </label>
      )}
    </DialogShell>
  );
}
