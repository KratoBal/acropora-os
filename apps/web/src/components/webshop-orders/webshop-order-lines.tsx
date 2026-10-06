"use client";
import { Icon } from "@acropora/ui";
import type {
  WebshopOrderDetail,
  WebshopOrderLine,
  WebshopOrderLineEdit,
  WebshopOrderSplitInput,
  WebshopOrderSplitResult,
  WebshopVariantOption,
} from "@acropora/types";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  PilotButton,
  PilotDialog,
  PilotInput,
} from "@/components/pilot/pilot-ui";
import type { LineSelection } from "./line-selection";

/**
 * A TÉTELEK TÁBLÁJA A MŰVELETEKKEL (Rendelések, 6. PR; a prompt 12-13. pontja,
 * Figma 501:1642). Soronként kijelölő és három ikon: mennyiség, csere,
 * törlés. A kijelölés a „Szétbontás” műveletet nyitja (a kártya fejlécében).
 * A műveletek csak akkor állnak, ha a tételek most módosíthatók; ha nem, a
 * tábla alatt áll, miért.
 */

const SwapIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);
const TrashIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);
export const ScissorsIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
  </svg>
);

function RowAction({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded-md p-1.5 ${danger ? "text-pilot-red-700 hover:bg-pilot-red-50" : "text-pilot-grey-600 hover:bg-pilot-grey-100"}`}
    >
      {children}
    </button>
  );
}

function DialogShell({
  title,
  onClose,
  busy,
  error,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  error: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <PilotDialog open onClose={busy ? () => undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="space-y-4 p-5"
      >
        <h2 className="text-base font-semibold text-pilot-grey-900">{title}</h2>
        {children}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">{footer}</div>
      </div>
    </PilotDialog>
  );
}

type Open =
  | { kind: "quantity"; line: WebshopOrderLine }
  | { kind: "replace"; line: WebshopOrderLine }
  | { kind: "remove"; line: WebshopOrderLine }
  | null;

export function OrderLinesTable({
  order,
  money,
  canManage,
  selection,
  onEdit,
  onSearchVariants,
}: {
  order: WebshopOrderDetail;
  money: (value: number) => string;
  canManage: boolean;
  selection: LineSelection;
  onEdit: (itemId: string, edit: WebshopOrderLineEdit) => Promise<void>;
  onSearchVariants: (query: string) => Promise<WebshopVariantOption[]>;
}) {
  const [open, setOpen] = useState<Open>(null);
  const editable = canManage && order.lineEdit.allowed;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-pilot-grey-200 text-[11px] uppercase tracking-[0.05em] text-pilot-grey-500">
              <th className="py-2 pr-3 font-semibold">Termék</th>
              <th className="py-2 pr-3 font-semibold">Cikkszám</th>
              <th className="py-2 pr-3 text-right font-semibold">Menny.</th>
              <th className="py-2 pr-3 text-right font-semibold">Egységár</th>
              <th className="py-2 pr-3 text-right font-semibold">Összesen</th>
              {canManage ? (
                <th className="py-2">
                  <span className="sr-only">Kijelölés és műveletek</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-pilot-grey-100">
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-3 pr-3 text-pilot-grey-900">
                  {line.title}
                  {line.variantTitle ? (
                    <span className="block text-xs text-pilot-grey-500">
                      {line.variantTitle}
                    </span>
                  ) : null}
                </td>
                <td className="py-3 pr-3 text-xs text-pilot-grey-600">
                  {line.sku ?? "—"}
                </td>
                <td className="py-3 pr-3 text-right">{line.quantity}</td>
                <td className="py-3 pr-3 text-right">
                  {money(line.unitPrice)}
                </td>
                <td className="py-3 pr-3 text-right font-semibold">
                  {money(line.total)}
                </td>
                {canManage ? (
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="checkbox"
                        aria-label={`${line.title} kijelölése`}
                        checked={selection.isSelected(line.id)}
                        onChange={() => selection.toggle(line.id)}
                        className="mr-1 size-4"
                      />
                      {editable ? (
                        <>
                          <RowAction
                            label="Mennyiség módosítása"
                            onClick={() => setOpen({ kind: "quantity", line })}
                          >
                            <Icon name="pencil" size={16} />
                          </RowAction>
                          <RowAction
                            label="Termék cseréje"
                            onClick={() => setOpen({ kind: "replace", line })}
                          >
                            <SwapIcon />
                          </RowAction>
                          <RowAction
                            label="Tétel törlése"
                            danger
                            onClick={() => setOpen({ kind: "remove", line })}
                          >
                            <TrashIcon />
                          </RowAction>
                        </>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && !order.lineEdit.allowed && order.lineEdit.reason ? (
        <p className="mt-2 text-xs text-pilot-grey-500">
          {order.lineEdit.reason}
        </p>
      ) : null}
      {open?.kind === "quantity" ? (
        <QuantityDialog
          line={open.line}
          onClose={() => setOpen(null)}
          onEdit={onEdit}
        />
      ) : null}
      {open?.kind === "replace" ? (
        <ReplaceDialog
          line={open.line}
          onClose={() => setOpen(null)}
          onEdit={onEdit}
          onSearch={onSearchVariants}
        />
      ) : null}
      {open?.kind === "remove" ? (
        <RemoveDialog
          line={open.line}
          onClose={() => setOpen(null)}
          onEdit={onEdit}
        />
      ) : null}
    </>
  );
}

/** Egy művelet futtatása a párbeszédből: siker után bezár, hiba a párbeszédben marad. */
function useRun(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A tétel nem változott.",
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function QuantityDialog({
  line,
  onClose,
  onEdit,
}: {
  line: WebshopOrderLine;
  onClose: () => void;
  onEdit: (itemId: string, edit: WebshopOrderLineEdit) => Promise<void>;
}) {
  const [value, setValue] = useState(String(line.quantity));
  const { busy, error, run } = useRun(onClose);
  const quantity = Number(value);
  const valid = Number.isInteger(quantity) && quantity >= 1;
  return (
    <DialogShell
      title="Mennyiség módosítása"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <PilotButton
            size="regular"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Mégse
          </PilotButton>
          <PilotButton
            size="regular"
            variant="primary"
            disabled={busy || !valid}
            onClick={() =>
              void run(() => onEdit(line.id, { kind: "quantity", quantity }))
            }
          >
            Mentés
          </PilotButton>
        </>
      }
    >
      <p className="text-sm text-pilot-grey-700">{line.title}</p>
      <label className="block text-xs text-pilot-grey-500">
        Új mennyiség
        <PilotInput
          aria-label="Új mennyiség"
          type="number"
          min={1}
          value={value}
          onChange={setValue}
          className="mt-1"
        />
      </label>
      <p className="text-xs text-pilot-grey-500">
        A rendelés összege változik; kártyás fizetésnél a levonás a
        Kiszállításkor megy, az új összeggel.
      </p>
    </DialogShell>
  );
}

function ReplaceDialog({
  line,
  onClose,
  onEdit,
  onSearch,
}: {
  line: WebshopOrderLine;
  onClose: () => void;
  onEdit: (itemId: string, edit: WebshopOrderLineEdit) => Promise<void>;
  onSearch: (query: string) => Promise<WebshopVariantOption[]>;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<WebshopVariantOption[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [value, setValue] = useState(String(line.quantity));
  const { busy, error, run } = useRun(onClose);
  const [searchError, setSearchError] = useState<string | null>(null);
  const quantity = Number(value);
  const search = async () => {
    setSearchError(null);
    setPicked(null);
    try {
      setOptions(await onSearch(query));
    } catch (cause) {
      setSearchError(
        cause instanceof Error ? cause.message : "A keresés nem sikerült.",
      );
    }
  };
  return (
    <DialogShell
      title="Termék cseréje"
      onClose={onClose}
      busy={busy}
      error={error ?? searchError}
      footer={
        <>
          <PilotButton
            size="regular"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Mégse
          </PilotButton>
          <PilotButton
            size="regular"
            variant="primary"
            disabled={
              busy || !picked || !(Number.isInteger(quantity) && quantity >= 1)
            }
            onClick={() =>
              void run(() =>
                onEdit(line.id, {
                  kind: "replace",
                  variantId: picked!,
                  quantity,
                }),
              )
            }
          >
            Csere
          </PilotButton>
        </>
      }
    >
      <p className="text-sm text-pilot-grey-700">Helyette: {line.title}</p>
      <div className="flex gap-2">
        <PilotInput
          aria-label="Termék keresése"
          placeholder="Név vagy cikkszám"
          value={query}
          onChange={setQuery}
        />
        <PilotButton
          size="regular"
          variant="secondary"
          disabled={query.trim().length < 2}
          onClick={() => void search()}
        >
          Keresés
        </PilotButton>
      </div>
      {options ? (
        options.length ? (
          <ul
            aria-label="Találatok"
            className="max-h-48 space-y-1 overflow-y-auto"
          >
            {options.map((option) => (
              <li key={option.variantId}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="replacement"
                    checked={picked === option.variantId}
                    onChange={() => setPicked(option.variantId)}
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
          <p className="text-sm text-pilot-grey-500">Nincs találat.</p>
        )
      ) : null}
      <label className="block text-xs text-pilot-grey-500">
        Mennyiség
        <PilotInput
          aria-label="Mennyiség"
          type="number"
          min={1}
          value={value}
          onChange={setValue}
          className="mt-1"
        />
      </label>
    </DialogShell>
  );
}

function RemoveDialog({
  line,
  onClose,
  onEdit,
}: {
  line: WebshopOrderLine;
  onClose: () => void;
  onEdit: (itemId: string, edit: WebshopOrderLineEdit) => Promise<void>;
}) {
  const { busy, error, run } = useRun(onClose);
  return (
    <DialogShell
      title="Tétel törlése"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        <>
          <PilotButton
            size="regular"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Mégse
          </PilotButton>
          <PilotButton
            size="regular"
            variant="danger"
            disabled={busy}
            onClick={() => void run(() => onEdit(line.id, { kind: "remove" }))}
          >
            Törlés
          </PilotButton>
        </>
      }
    >
      <p className="text-sm text-pilot-grey-700">
        Törlöd a rendelésből: <span className="font-medium">{line.title}</span>{" "}
        ({line.quantity} db)?
      </p>
    </DialogShell>
  );
}

/**
 * A SZÉTBONTÁS PÁRBESZÉDE (acrobot 26310, 2. döntés): a kijelölt tételeket
 * mutatja, és kimondja, hogy maga a bontás (új rendelés a kijelölt
 * tételekkel, a fizetés sorsa) a következő körben készül el.
 */
/** Egy szétbontás azonosítója: a párbeszédablaké, az újraküldés ugyanazt viszi. */
function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `split-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * A SZÉTBONTÁS (kártya 0a14f739 C/3): a kijelölt tételek, soronként a
 * bontandó mennyiséggel, új kapcsolt rendelésbe kerülnek a webshopban. A
 * kérés azonosítója az ablak megnyitásakor születik, ezért egy elveszett
 * válasz után az újraküldés nem bont kétszer. Az egész rendelés nem bontás.
 */
export function SplitDialog({
  lines,
  allLines,
  reason,
  onClose,
  onSplit,
}: {
  lines: WebshopOrderLine[];
  /** A rendelés összes tétele: az egész rendelés nem bontható. */
  allLines: WebshopOrderLine[];
  /** Ha nem `null`, most nem bontható, és ez az oka. */
  reason: string | null;
  onClose: () => void;
  onSplit: (
    input: WebshopOrderSplitInput,
  ) => Promise<WebshopOrderSplitResult["created"]>;
}) {
  const [requestId] = useState(newRequestId);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, String(line.quantity)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<
    WebshopOrderSplitResult["created"] | null
  >(null);
  const wanted = lines.map((line) => ({
    itemId: line.id,
    quantity: Number(quantities[line.id]),
  }));
  const invalid = lines.find((line, index) => {
    const quantity = wanted[index]!.quantity;
    return (
      !Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity
    );
  });
  const whole = allLines.every(
    (line) =>
      wanted.find((item) => item.itemId === line.id)?.quantity ===
      line.quantity,
  );
  const hint = invalid
    ? `${invalid.title}: 1 és ${invalid.quantity} közötti mennyiség bontható.`
    : whole
      ? "Minden tétel teljes mennyisége nem bontás: az eredeti rendelésben maradnia kell valaminek."
      : null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await onSplit({ lines: wanted, requestId }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A bontás nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell
      title="Szétbontás"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={
        created || reason ? (
          <PilotButton size="regular" variant="secondary" onClick={onClose}>
            Bezárás
          </PilotButton>
        ) : (
          <>
            <PilotButton
              size="regular"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Mégse
            </PilotButton>
            <PilotButton
              size="regular"
              variant="primary"
              disabled={busy || hint !== null}
              onClick={() => void submit()}
            >
              {busy ? "Bontás…" : "Szétbontás"}
            </PilotButton>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-2 text-sm text-pilot-grey-800">
          <p>
            Létrejött a{" "}
            {created.displayId !== null ? `#${created.displayId}` : "kapcsolt"}{" "}
            rendelés a kijelölt tételekkel.
          </p>
          {created.awaitingPayment ? (
            <p className="text-pilot-amber-700">
              Az új rendelés fizetésre vár. A fizetési linket az adatlapjáról
              küldd, amikor kiszállítható: a link 6 nap után lejár.
            </p>
          ) : null}
          <Link
            href={`/webshop/rendelesek/${encodeURIComponent(created.id)}`}
            className="font-medium text-pilot-aqua-700 underline"
          >
            Az új rendelés megnyitása
          </Link>
        </div>
      ) : reason ? (
        <p className="text-sm text-pilot-grey-700">{reason}</p>
      ) : (
        <>
          <p className="text-sm text-pilot-grey-600">
            A kijelölt tételek új, kapcsolt rendelésbe kerülnek. Az eredeti
            rendelés összege ennyivel csökken.
          </p>
          <ul aria-label="Kijelölt tételek" className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-center justify-between gap-3 text-sm text-pilot-grey-800"
              >
                <span className="min-w-0">
                  {line.title}
                  <span className="block text-xs text-pilot-grey-500">
                    a rendelésen: {line.quantity} db
                  </span>
                </span>
                <PilotInput
                  aria-label={`${line.title}: bontandó mennyiség`}
                  type="number"
                  min={1}
                  max={line.quantity}
                  value={quantities[line.id] ?? ""}
                  onChange={(value) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: value,
                    }))
                  }
                  className="w-20"
                />
              </li>
            ))}
          </ul>
          {hint ? <p className="text-xs text-pilot-red-700">{hint}</p> : null}
        </>
      )}
    </DialogShell>
  );
}
