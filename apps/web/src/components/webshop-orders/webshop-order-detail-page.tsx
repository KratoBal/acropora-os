"use client";
import { Alert, Button, ConfirmDialog, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  WEBSHOP_ORDER_PAYMENT_STATE_LABELS,
  WEBSHOP_PROFORMA_DUE_DAYS,
  WEBSHOP_PARCEL_SIZES,
  WEBSHOP_CARD_PAYMENT_STATE_LABELS,
  glsDeliveryLabel,
  type WebshopOrderAddress,
  type WebshopOrderDetail,
  type WebshopOrderHistoryEntry,
  type WebshopOrderLineEdit,
  type WebshopOrderCardPayment,
  type WebshopOrderAddressInput,
  type WebshopVariantOption,
  type WebshopOrderStatus,
  type WebshopOrderStep,
  type WebshopParcelSize,
  type WebshopShippingNoticeOutcome,
  type WebshopStatusMailOutcome,
  WEBSHOP_CARRIER_NOTE_MAX,
  WEBSHOP_CUSTOMER_NOTE_MAX,
  type WebshopOrderMethodInput,
  type WebshopOrderMethodResult,
  type WebshopOrderNotesInput,
  type WebshopOrderSplitInput,
  type WebshopOrderSplitResult,
  type WebshopShippingOptions,
  type WebshopPickupPointSearch,
  type WebshopParcelTracking,
  type WebshopTransferReceiptInput,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotDialog,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { formatStatusAge } from "@/components/webshop/webshop-orders-page";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { webshopOrdersApi } from "@/lib/api/webshop-orders";
import { useLineSelection } from "./line-selection";
import {
  AddressDialog,
  EditPencil,
  MethodDialog,
  NoteDialog,
  PointDialog,
  TransferReceivedDialog,
} from "./webshop-order-edits";
import {
  OrderLinesTable,
  ScissorsIcon,
  SplitDialog,
} from "./webshop-order-lines";
import {
  STATUS_TILE,
  formatMoney,
  orderNumber,
} from "./webshop-orders-list-page";

/**
 * A WEBSHOP RENDELÉS ADATLAPJA (Balázs, 2026-10-05; Figma 494:386, 494:649,
 * 494:802, 494:996). Ebben a körben OLVASÓ: a műveletek (státuszmódosítás,
 * számla, csomagfeladás, tételműveletek, szerkesztő ceruzák) a következő
 * PR-okban jönnek, és addig nem állnak ott gombként, ami semmit nem csinál.
 */

const LONG_DATE = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Másolás gomb: a sikerét a saját felirata mondja ki (toast még nincs az OS-ben). */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "Másolva" : label}
      aria-label={copied ? "Másolva" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex size-7 items-center justify-center rounded-md bg-transparent text-pilot-grey-500 hover:text-pilot-accent-warm"
    >
      <Icon name="copy" size={16} />
    </button>
  );
}

function Card({
  title,
  children,
  className = "",
  action,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** A cím mellett álló művelet (a Tételeknél a „Szétbontás”). */
  action?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-2xl border border-pilot-grey-200 bg-white p-5 ${className}`}
    >
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-base font-semibold text-pilot-grey-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-pilot-grey-500">
        {label}
        {action}
      </p>
      <div className="mt-1 text-sm text-pilot-grey-900">{children}</div>
    </div>
  );
}

const STEP_STYLE: Record<
  WebshopOrderStep["state"],
  { circle: string; detail: string }
> = {
  done: {
    circle: "bg-pilot-green-50 text-pilot-green-700",
    detail: "text-pilot-grey-500",
  },
  current: {
    circle: "bg-pilot-blue-50 text-pilot-blue-700",
    detail: "text-pilot-grey-700",
  },
  blocked: {
    circle: "bg-pilot-grey-100 text-pilot-grey-500",
    detail: "text-pilot-accent-warm-text",
  },
  todo: {
    circle: "bg-pilot-grey-100 text-pilot-grey-500",
    detail: "text-pilot-grey-500",
  },
};

const STEP_STATE_LABEL: Record<WebshopOrderStep["state"], string> = {
  done: "kész",
  current: "folyamatban",
  blocked: "várakozik",
  todo: "még nem",
};

function Address({ address }: { address: WebshopOrderAddress | null }) {
  if (!address) return <span className="text-pilot-grey-500">—</span>;
  return (
    <>
      {address.company ? (
        <span className="block">{address.company}</span>
      ) : null}
      <span className="block">{address.line ?? "—"}</span>
    </>
  );
}

/** A két végállapot: nincs „Státusz módosítása”, csak a végállapot szövege (a prompt 9. pontja). */
const TERMINAL: readonly WebshopOrderStatus[] = [
  "closed",
  "closed_unsuccessfully",
];

/**
 * STÁTUSZ MÓDOSÍTÁSA (a prompt 9. pontja): csak a webshop átmenet-táblája
 * szerinti következő státuszok. A hiba (például a Kiszállításkori levonás
 * elutasítása) a párbeszédben marad, a kezelő a konkrét okot látja.
 *
 * A „Vevő értesítése” jelölő a webshop statuszlevele (C4, murena) után kerül
 * ide: addig nem lenne mit kapcsolnia.
 */
function StatusDialog({
  order,
  open,
  onClose,
  onSubmit,
}: {
  order: WebshopOrderDetail;
  open: boolean;
  onClose: () => void;
  onSubmit: (
    status: WebshopOrderStatus,
    notifyCustomer: boolean,
  ) => Promise<void>;
}) {
  const [next, setNext] = useState<string>("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setNext(order.nextStatuses[0]?.status ?? "");
      setNotify(true);
      setError(null);
    }
  }, [open, order.nextStatuses]);
  const submit = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(next as WebshopOrderStatus, notify);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A státusz nem változott.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <PilotDialog open={open} onClose={busy ? () => undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-dialog-title"
        className="space-y-4 p-5"
      >
        <h2
          id="status-dialog-title"
          className="text-base font-semibold text-pilot-grey-900"
        >
          Státusz módosítása
        </h2>
        <p className="text-sm text-pilot-grey-600">
          Jelenlegi státusz:{" "}
          <span className="font-medium text-pilot-grey-900">
            {order.status.label ?? "—"}
          </span>
        </p>
        <label className="block text-xs text-pilot-grey-500">
          Következő státusz
          <PilotSelect
            chevron
            aria-label="Következő státusz"
            value={next}
            onChange={setNext}
            className="mt-1 [&_select]:h-10"
          >
            {order.nextStatuses.map((option) => (
              <option key={option.status} value={option.status}>
                {option.label}
              </option>
            ))}
          </PilotSelect>
        </label>
        <label className="flex items-center gap-2 text-sm text-pilot-grey-700">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />
          Vevő értesítése
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Mégse
          </PilotButton>
          <PilotButton
            size="regular"
            onClick={() => void submit()}
            disabled={busy || !next}
          >
            {busy ? "Folyamatban…" : "Státusz módosítása"}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}

/** The GLS logo for the parcel's kind: home, point or locker (commerce #489). */
function glsLogoOf(point: WebshopOrderDetail["shipping"]["pickupPoint"]): {
  src: string;
  alt: string;
} {
  if (!point) return { src: "/images/gls.png", alt: "GLS" };
  return point.kind === "parcel-locker"
    ? { src: "/images/gls-automata.png", alt: "GLS Automata" }
    : { src: "/images/gls-csomagpont.png", alt: "GLS Csomagpont" };
}

export function WebshopOrderDetailPage({ id }: { id: string }) {
  const { session } = useAuth();
  const [order, setOrder] = useState<WebshopOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );
  // a számla kiállítása a rendelés kezelése ÉS a kiállítás joga (a szerver is mindkettőt kéri)
  const canIssue = Boolean(
    session &&
    hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE) &&
    hasPermission(session.user, PERMISSIONS.BILLING_ISSUE),
  );
  // a díjbekérő kiállítás ÉS kiküldés (a szerver a BILLING_RESEND-et is kéri)
  const canSendProforma =
    canIssue &&
    Boolean(session && hasPermission(session.user, PERMISSIONS.BILLING_RESEND));
  const token = session?.token ?? "";
  const [mailNotice, setMailNotice] = useState<string | null>(null);
  const changeStatus = async (
    status: WebshopOrderStatus,
    notifyCustomer: boolean,
  ) => {
    const result = await webshopOrdersApi.changeStatus(
      token,
      id,
      status,
      notifyCustomer,
    );
    setOrder(result.order);
    setMailNotice(statusMailText(result.mail));
    setNow(Date.now());
  };
  const resendStatusMail = async () => {
    const result = await webshopOrdersApi.resendStatusMail(token, id);
    setOrder(result.order);
    setMailNotice(statusMailText(result.mail));
    setNow(Date.now());
  };
  const issueInvoice = async () => {
    setOrder(await webshopOrdersApi.issueInvoice(token, id));
    setNow(Date.now());
  };
  const issueDeliveryNote = async () => {
    setOrder(await webshopOrdersApi.issueDeliveryNote(token, id));
    setNow(Date.now());
  };
  const sendProforma = async () => {
    setOrder(await webshopOrdersApi.sendProforma(token, id));
    setNow(Date.now());
  };
  const recordTransfer = async (input: WebshopTransferReceiptInput) => {
    setOrder(await webshopOrdersApi.recordTransferReceived(token, id, input));
    setNow(Date.now());
  };
  const syncTransferToShop = async () => {
    setOrder(await webshopOrdersApi.syncTransferToShop(token, id));
    setNow(Date.now());
  };
  const editLine = async (itemId: string, edit: WebshopOrderLineEdit) => {
    setOrder(await webshopOrdersApi.editLine(token, id, itemId, edit));
    setNow(Date.now());
  };
  const updateAddress = async (input: WebshopOrderAddressInput) => {
    setOrder(await webshopOrdersApi.updateAddress(token, id, input));
    setNow(Date.now());
  };
  const saveNote = async (text: string) => {
    setOrder(await webshopOrdersApi.saveInternalNote(token, id, text));
    setNow(Date.now());
  };
  const changePoint = async (pointId: string) => {
    setOrder(await webshopOrdersApi.changePoint(token, id, pointId));
    setNow(Date.now());
  };
  const split = async (input: WebshopOrderSplitInput) => {
    const result = await webshopOrdersApi.split(token, id, input);
    setOrder(result.order);
    setNow(Date.now());
    return result.created;
  };
  const saveNotes = async (input: WebshopOrderNotesInput) => {
    setOrder(await webshopOrdersApi.saveNotes(token, id, input));
    setNow(Date.now());
  };
  const searchPoints = (query: string) =>
    webshopOrdersApi.pickupPoints(token, id, query);
  // állandó azonosság: a követés mezője erre indít lekérést
  const loadShippingOptions = useCallback(
    () => webshopOrdersApi.shippingOptions(token, id),
    [token, id],
  );
  const searchMethodPoints = (optionId: string, query: string) =>
    webshopOrdersApi.shippingOptionPoints(token, id, optionId, query);
  const changeMethod = async (input: WebshopOrderMethodInput) => {
    const result = await webshopOrdersApi.changeShippingMethod(
      token,
      id,
      input,
    );
    setOrder(result.order);
    setMailNotice(methodChangeText(result.change));
    setNow(Date.now());
  };
  const parcelTracking = useCallback(
    () => webshopOrdersApi.parcelTracking(token, id),
    [token, id],
  );
  const releaseHold = async (notifyCustomer: boolean) => {
    const result = await webshopOrdersApi.releaseHold(
      token,
      id,
      notifyCustomer,
    );
    setOrder(result.order);
    setNow(Date.now());
    return statusMailText(result.mail);
  };
  const sendPaymentLink = async (notifyCustomer: boolean) => {
    const result = await webshopOrdersApi.sendPaymentLink(
      token,
      id,
      notifyCustomer,
    );
    setOrder(result.order);
    setNow(Date.now());
    return statusMailText(result.mail);
  };
  const searchVariants = (query: string) =>
    webshopOrdersApi.replacementVariants(token, id, query);
  const createParcel = async (size: WebshopParcelSize | undefined) => {
    const result = await webshopOrdersApi.createParcel(token, id, size);
    setOrder(result.order);
    setNow(Date.now());
    return result.notice;
  };
  const parcelLabel = async () => {
    const blob = await webshopOrdersApi.parcelLabel(token, id);
    window.open(URL.createObjectURL(blob), "_blank");
  };
  const releaseParcel = async () => {
    setOrder(await webshopOrdersApi.releaseParcel(token, id));
    setNow(Date.now());
  };
  const openPdf = async (documentId: string) => {
    const blob = await billingDocumentsApi.pdf(token, documentId);
    window.open(URL.createObjectURL(blob), "_blank");
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setOrder(await webshopOrdersApi.detail(token, id, signal));
        setNow(Date.now());
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A rendelés nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, id, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a rendelésekhez"
        description="A megtekintéshez orders.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <Link
        href="/webshop/rendelesek"
        className="inline-flex items-center gap-1 text-xs font-medium text-pilot-accent-warm-text hover:underline"
      >
        ← Vissza a rendelésekhez
      </Link>
      {error ? (
        <Alert
          variant="danger"
          title="A rendelés nem töltődött be"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újra
            </Button>
          }
        />
      ) : null}
      {loading && !order ? (
        <div aria-label="Rendelés betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {order && !error ? (
        <OrderBody
          order={order}
          now={now}
          canManage={canManage}
          canIssue={canIssue}
          canSendProforma={canSendProforma}
          onSendProforma={sendProforma}
          onRecordTransfer={recordTransfer}
          onSyncTransferToShop={syncTransferToShop}
          onChangeStatus={changeStatus}
          mailNotice={mailNotice}
          onResendStatusMail={resendStatusMail}
          onIssueInvoice={issueInvoice}
          onIssueDeliveryNote={issueDeliveryNote}
          onOpenPdf={openPdf}
          onCreateParcel={createParcel}
          onParcelLabel={parcelLabel}
          onReleaseParcel={releaseParcel}
          onParcelTracking={parcelTracking}
          onEditLine={editLine}
          onSearchVariants={searchVariants}
          onReleaseHold={releaseHold}
          onSendPaymentLink={sendPaymentLink}
          onUpdateAddress={updateAddress}
          onSaveNote={saveNote}
          onChangePoint={changePoint}
          onSplit={split}
          onLoadShippingOptions={loadShippingOptions}
          onSearchMethodPoints={searchMethodPoints}
          onChangeMethod={changeMethod}
          onSaveNotes={saveNotes}
          onSearchPoints={searchPoints}
        />
      ) : null}
    </PilotThemeRoot>
  );
}

/** Ezekben az állapotokban nincs számla-kiállítás (a szerver is így dönt). */
const NOT_INVOICEABLE: readonly (WebshopOrderStatus | null)[] = [
  null,
  "pending_processing",
  "closed_unsuccessfully",
];

/**
 * A SZÁMLA KÁRTYA (Rendelések, 4. PR). A kiállítás a Számlázás kiállítása:
 * ugyanaz a zár és ugyanaz a Számlázz.hu-hívás, ezért a bizonylat a
 * Számlázásban is megnyitható. A kiállítás alatti és az elutasított állapot
 * nem kap új gombot: ott a Számlázásban kell megnézni, mi történt.
 */
function InvoiceCard({
  order,
  canIssue,
  onIssue,
  onIssueDeliveryNote,
  onOpenPdf,
}: {
  order: WebshopOrderDetail;
  canIssue: boolean;
  onIssue: () => Promise<void>;
  onIssueDeliveryNote: () => Promise<void>;
  onOpenPdf: (documentId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A KIÁLLÍTÁS MEGERŐSÍTÉSSEL (acrobot 26827, biztonsági korlát): a gomb
  // valódi Számlázz.hu-bizonylatot állít ki, tehát egy kattintás nem elég
  const [confirming, setConfirming] = useState<
    "invoice" | "deliveryNote" | null
  >(null);
  const invoice = order.invoice;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };
  const link = invoice ? (
    <Link
      href={`/penzugy/szamlazas/${encodeURIComponent(invoice.id)}`}
      className="text-sm font-medium text-pilot-aqua-700 underline"
    >
      Megnyitás a Számlázásban
    </Link>
  ) : null;
  const waiting = NOT_INVOICEABLE.includes(order.status.code);
  const external = order.externalInvoice;
  return (
    <Card title="Számla">
      <div className="space-y-3">
        {!invoice && order.bankTransfer ? (
          <ExternalInvoiceField external={external} />
        ) : invoice?.status === "ISSUED" ? (
          <>
            <Field
              label="Számlaszám"
              action={
                invoice.number ? (
                  <CopyButton
                    value={invoice.number}
                    label="Számlaszám másolása"
                  />
                ) : null
              }
            >
              {invoice.number ?? "—"}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <PilotButton
                size="regular"
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => onOpenPdf(invoice.id))}
              >
                PDF megnyitása
              </PilotButton>
              {link}
            </div>
            <DeliveryNoteField
              note={order.deliveryNote}
              canIssue={canIssue}
              busy={busy}
              onIssue={() => setConfirming("deliveryNote")}
              onOpenPdf={(documentId) => void run(() => onOpenPdf(documentId))}
            />
          </>
        ) : invoice?.status === "ISSUING" ? (
          <>
            <p className="text-sm text-pilot-amber-700">
              A kiállítás elindult, és ellenőrzésre vár: nézd meg a
              Számlázz.hu-n, elkészült-e.
            </p>
            {link}
          </>
        ) : invoice?.status === "ISSUE_FAILED" ? (
          <>
            <p className="text-sm text-pilot-red-700">
              A kiállítás elutasítva maradt. Az okát a bizonylatnál látod.
            </p>
            {link}
          </>
        ) : (
          <>
            <p className="text-sm text-pilot-grey-700">
              Még nincs kiállított számla.
            </p>
            {waiting ? (
              <p className="text-xs text-pilot-grey-500">
                {order.status.code === "pending_processing"
                  ? "A számla a visszaigazolás után állítható ki."
                  : "Erre a rendelésre nem állítunk ki számlát."}
              </p>
            ) : canIssue ? (
              <PilotButton
                size="regular"
                variant="primary"
                disabled={busy}
                onClick={() => setConfirming("invoice")}
              >
                {busy ? "Kiállítás…" : "Számla kiállítása"}
              </PilotButton>
            ) : null}
          </>
        )}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
          >
            {error}
          </p>
        ) : null}
      </div>
      {/* ugyanaz a megerősítés, mint a Számlázás szerkesztőjében (confirmIssue) */}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === "deliveryNote"
            ? "Szállítólevél kiállítása"
            : "Számla kiállítása"
        }
        consequence={
          confirming === "deliveryNote"
            ? "A kiállítással valódi szállítólevél készül a Számlázz.hu-n, saját számmal, a kiállított számla tételeiből."
            : "A kiállítással valódi számla készül a Számlázz.hu-n, saját számmal, a rendelés tételeiből. A számla ezután nem szerkeszthető."
        }
        recovery="Egy kiállított bizonylat nem vonható vissza; javítani csak sztornóval vagy helyesbítő bizonylattal lehet."
        confirmLabel={
          confirming === "deliveryNote"
            ? "Szállítólevél kiállítása"
            : "Számla kiállítása"
        }
        busy={busy}
        onConfirm={() => {
          const work =
            confirming === "deliveryNote" ? onIssueDeliveryNote : onIssue;
          void run(work).finally(() => setConfirming(null));
        }}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}

/** ÉÉÉÉ-HH-NN, budapesti fali óra szerint (a kézi rögzítés napja). */
const BUDAPEST_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Budapest",
});

/** A díjbekérő levelének állapota (`BillingEmailStatus`). */
const PROFORMA_MAIL: Record<string, string> = {
  SENT: "Kiküldve",
  SENDING: "Küldés alatt",
  FAILED: "Nem ment ki",
};

/**
 * A DÍJBEKÉRŐ (kártya bb3a6bd5; Balázs, 2026-10-06: „Leadja a rendelest es
 * mi kuldjuk neki gombbal a dijbekerot”, 8 napos határidő). Az első gomb a
 * Számlázz.hu-n kiállítja és elküldi a vevőnek, a további csak újraküldi.
 * Lejárat után semmi automatikus: „Lejárt díjbekérő”, és újraküldhető. A
 * kiállítás alatti és az elutasított díjbekérő nem kap gombot: ott a
 * Számlázásban kell megnézni, mi történt.
 */
function ProformaSection({
  order,
  now,
  canSend,
  canRecord,
  onSend,
  onRecord,
  onSyncShop,
}: {
  order: WebshopOrderDetail;
  now: number;
  canSend: boolean;
  /** Az „Utalás beérkezett” joga (a rendelés kezelése és a kiállítás joga). */
  canRecord: boolean;
  onSend: () => Promise<void>;
  onRecord: (input: WebshopTransferReceiptInput) => Promise<void>;
  /** A rögzített beérkezés újraküldése a webshopnak (commerce #509). */
  onSyncShop: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // VALÓDI BIZONYLAT ÉS VALÓDI LEVÉL (acrobot 26827): egy kattintás nem elég
  const [confirming, setConfirming] = useState(false);
  const [recording, setRecording] = useState(false);
  const proforma = order.proforma;
  const receipt = order.transferReceipt;
  // a Számlázz.hu számlája a saját kifizetései szerint is mondhatja (bb3a6bd5)
  const paidByInvoice = !receipt && !!order.externalInvoice?.paid;
  const issued = proforma?.status === "ISSUED";
  const sentBefore = issued && proforma.emailStatus !== null;
  const stuck =
    proforma?.status === "ISSUING" || proforma?.status === "ISSUE_FAILED";
  const sending = proforma?.emailStatus === "SENDING";
  const closed = order.status.code === "closed_unsuccessfully";
  const today = BUDAPEST_DAY.format(new Date(now));
  const label = sentBefore ? "Díjbekérő újraküldése" : "Díjbekérő kiküldése";
  const runShop = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSyncShop();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSend();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t border-pilot-grey-100 pt-4">
      {receipt || paidByInvoice ? (
        <span className="inline-block rounded-full bg-pilot-green-50 px-3 py-1 text-xs font-medium text-pilot-green-700">
          Kifizetve
        </span>
      ) : proforma?.expired ? (
        <span className="inline-block rounded-full bg-pilot-red-50 px-3 py-1 text-xs font-medium text-pilot-red-700">
          Lejárt díjbekérő
        </span>
      ) : order.payment?.state === "AWAITING" ? (
        <span className="inline-block rounded-full bg-pilot-amber-50 px-3 py-1 text-xs font-medium text-pilot-amber-700">
          Utalásra vár
        </span>
      ) : null}
      {issued ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Díjbekérő">{proforma.number ?? "—"}</Field>
          <Field label="Fizetési határidő">{proforma.dueDate ?? "—"}</Field>
          <Field label="Levél">
            {(proforma.emailStatus && PROFORMA_MAIL[proforma.emailStatus]) ??
              "Még nem ment ki"}
          </Field>
        </div>
      ) : stuck ? (
        <p
          className={`text-sm ${proforma.status === "ISSUING" ? "text-pilot-amber-700" : "text-pilot-red-700"}`}
        >
          {proforma.status === "ISSUING"
            ? "A díjbekérő kiállítása elindult, és ellenőrzésre vár: nézd meg a Számlázz.hu-n, elkészült-e."
            : "A díjbekérő kiállítása elutasítva maradt. Az okát a bizonylatnál látod."}
        </p>
      ) : (
        <p className="text-sm text-pilot-grey-700">Még nincs díjbekérő.</p>
      )}
      {receipt ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Beérkezett">{receipt.receivedOn}</Field>
          <Field label="Összeg">
            {formatMoney(Number(receipt.amount), receipt.currency)}
          </Field>
          <Field label="Hivatkozás">
            <span className="break-all">{receipt.reference}</span>
          </Field>
          <Field label="Rögzítette">
            {receipt.source === "BANK_PAIRING"
              ? "Banki párosítás"
              : (receipt.recordedBy ?? "—")}
          </Field>
        </div>
      ) : paidByInvoice ? (
        <p className="text-xs text-pilot-grey-500">
          A Számlázz.hu számlája szerint kifizetve
          {order.externalInvoice?.paidOn
            ? ` (${order.externalInvoice.paidOn})`
            : ""}
          .
        </p>
      ) : null}
      {proforma ? (
        <Link
          href={`/penzugy/szamlazas/${encodeURIComponent(proforma.id)}`}
          className="text-sm font-medium text-pilot-aqua-700 underline"
        >
          Megnyitás a Számlázásban
        </Link>
      ) : null}
      {canSend && !stuck && !closed && !receipt && !paidByInvoice ? (
        <PilotButton
          size="regular"
          variant={sentBefore ? "secondary" : "primary"}
          disabled={busy || sending}
          onClick={() => setConfirming(true)}
        >
          {busy ? "Küldés…" : label}
        </PilotButton>
      ) : null}
      {canRecord && issued && !receipt && !paidByInvoice && !closed ? (
        <PilotButton
          size="regular"
          variant="secondary"
          disabled={busy}
          onClick={() => setRecording(true)}
        >
          Utalás beérkezett
        </PilotButton>
      ) : null}
      {canRecord && receipt && order.payment?.state === "AWAITING" ? (
        <div className="space-y-2">
          <p className="text-xs text-pilot-amber-700">
            A beérkezés az OS-ben rögzítve van, de a webshopban a rendelés még
            fizetésre vár.
          </p>
          <PilotButton
            size="regular"
            variant="secondary"
            disabled={busy}
            onClick={() => void runShop()}
          >
            {busy ? "Küldés…" : "Webshop fizetés lezárása"}
          </PilotButton>
        </div>
      ) : null}
      {recording && proforma ? (
        <TransferReceivedDialog
          today={today}
          amount={
            proforma.grossAmount
              ? formatMoney(Number(proforma.grossAmount), order.currency)
              : "—"
          }
          onClose={() => setRecording(false)}
          onSave={onRecord}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={label}
        consequence={
          issued
            ? `A vevő (${order.customer.email}) e-mailben újra megkapja a meglévő díjbekérőt. Új díjbekérő nem készül, a határidő nem változik.`
            : `A kiküldéssel valódi díjbekérő készül a Számlázz.hu-n, saját számmal, ${WEBSHOP_PROFORMA_DUE_DAYS} napos fizetési határidővel, és a vevő (${order.customer.email}) e-mailben megkapja.`
        }
        recovery="A kiment levél nem vonható vissza."
        confirmLabel={label}
        busy={busy}
        onConfirm={() => void send()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** Miből tudjuk, hogy a Számlázz.hu számlája ehhez a rendeléshez tartozik. */
const EXTERNAL_LINK_TEXT: Record<
  NonNullable<WebshopOrderDetail["externalInvoice"]>["link"],
  string
> = {
  ORDER_NUMBER: "A számla rendelésszáma szerint.",
  PROFORMA_NUMBER: "A számla a díjbekérő számára hivatkozik.",
  BUYER_AMOUNT:
    "Csak a vevő és az összeg egyezik: nézd meg, tényleg ehhez a rendeléshez tartozik-e.",
};

/**
 * ELŐRE UTALÁSNÁL A SZÁMLÁT A SZÁMLÁZZ.HU ÁLLÍTJA KI (bb3a6bd5; Balázs,
 * 2026-10-06 18:22 UTC: „be van kapcsolva az automatikus szamlazas ha
 * kifizetik a dijbekerot”). Ezért itt nincs kiállítás-gomb: a kifizetett
 * díjbekérőből készült számla a kimenő továbbítással jön be, és ide kötődik.
 */
function ExternalInvoiceField({
  external,
}: {
  external: WebshopOrderDetail["externalInvoice"];
}) {
  if (!external)
    return (
      <p className="text-sm text-pilot-grey-700">
        A számlát a Számlázz.hu állítja ki, amikor a díjbekérőt kifizetik; ide
        magától bekerül.
      </p>
    );
  return (
    <>
      <Field
        label="Számlaszám"
        action={
          <CopyButton value={external.number} label="Számlaszám másolása" />
        }
      >
        {external.number}
      </Field>
      <p
        className={`text-xs ${external.link === "BUYER_AMOUNT" ? "font-medium text-pilot-amber-700" : "text-pilot-grey-500"}`}
      >
        A Számlázz.hu állította ki. {EXTERNAL_LINK_TEXT[external.link]}
      </p>
      <Link
        href={`/penzugy/szamlazas/kulso/${encodeURIComponent(external.id)}`}
        className="text-sm font-medium text-pilot-aqua-700 underline"
      >
        Megnyitás a Számlázásban
      </Link>
    </>
  );
}

/**
 * A SZÁLLÍTÓLEVÉL (kártya 0a14f739 C/1): a Számlázz.hu szállítólevele, a
 * kiállított számla tételeiből. Ezért a számla kártyáján áll, és csak a
 * kiállított számla alatt. A kiállítás alatti és az elutasított állapot itt
 * sem kap új gombot: a Számlázásban kell megnézni, mi történt.
 */
function DeliveryNoteField({
  note,
  canIssue,
  busy,
  onIssue,
  onOpenPdf,
}: {
  note: WebshopOrderDetail["deliveryNote"];
  canIssue: boolean;
  busy: boolean;
  onIssue: () => void;
  onOpenPdf: (documentId: string) => void;
}) {
  const link = note ? (
    <Link
      href={`/penzugy/szamlazas/${encodeURIComponent(note.id)}`}
      className="text-sm font-medium text-pilot-aqua-700 underline"
    >
      Megnyitás a Számlázásban
    </Link>
  ) : null;
  return (
    <div className="space-y-2 border-t border-pilot-grey-100 pt-3">
      {note?.status === "ISSUED" ? (
        <>
          <Field label="Szállítólevél">{note.number ?? "—"}</Field>
          <div className="flex flex-wrap items-center gap-3">
            <PilotButton
              size="regular"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenPdf(note.id)}
            >
              Szállítólevél PDF
            </PilotButton>
            {link}
          </div>
        </>
      ) : note?.status === "ISSUING" ? (
        <>
          <p className="text-sm text-pilot-amber-700">
            A szállítólevél kiállítása elindult, és ellenőrzésre vár: nézd meg a
            Számlázz.hu-n, elkészült-e.
          </p>
          {link}
        </>
      ) : note?.status === "ISSUE_FAILED" ? (
        <>
          <p className="text-sm text-pilot-red-700">
            A szállítólevél kiállítása elutasítva maradt. Az okát a bizonylatnál
            látod.
          </p>
          {link}
        </>
      ) : canIssue ? (
        <PilotButton
          size="regular"
          variant="secondary"
          disabled={busy}
          onClick={onIssue}
        >
          {busy ? "Kiállítás…" : "Szállítólevél kiállítása"}
        </PilotButton>
      ) : (
        <p className="text-sm text-pilot-grey-700">Nincs szállítólevél.</p>
      )}
    </div>
  );
}

/** Egy előzmény-sor levelének állapota. */
const MAIL_STATE: Record<
  NonNullable<WebshopOrderHistoryEntry["mail"]>["status"],
  { label: string; className: string }
> = {
  sent: { label: "Értesítő elküldve", className: "text-pilot-green-700" },
  failed: { label: "Értesítő nem ment ki", className: "text-pilot-red-700" },
  pending: { label: "Értesítő küldés alatt", className: "text-pilot-grey-500" },
};

/** A státuszlevél sorsa egy mondatban (commerce #479 okai). */
export function statusMailText(mail: WebshopStatusMailOutcome): string {
  if (mail.sent) return "A vevő megkapta a státuszlevelet.";
  switch (mail.reason) {
    case "not_requested":
      return "A vevő nem kapott levelet (nem kérted).";
    case "mail_off":
      return "A webshop levélküldése ki van kapcsolva, a vevő nem kapott levelet.";
    case "no_mail_for_status":
      return "Ehhez az állapothoz nem tartozik levél.";
    case "no_email":
      return "A rendelésen nincs e-mail cím, a vevő nem kapott levelet.";
    case "already_sent":
      return "Ez a levél már korábban kiment.";
    case "shipped_mail_sent":
      return "A „Feladtuk” levél már kiment, ezért státuszlevél nem ment.";
    case "failed":
      return "A levél küldése nem sikerült. Az „Értesítő újraküldése” gombbal megismételheted.";
    default:
      return `A levél nem ment ki (${mail.reason}).`;
  }
}

/** A szállítási mód cseréjének eredménye egy mondatban (kártya 0a14f739 C/2). */
export function methodChangeText(
  change: WebshopOrderMethodResult["change"],
): string {
  if (!change.changed) return "A szállítási mód nem változott.";
  const amount = formatMoney(Math.abs(change.difference), "HUF");
  if (change.difference <= 0)
    return change.difference < 0
      ? `A szállítási mód cserélve, a végösszeg ${amount} összeggel csökkent. Új fizetés nem kell.`
      : "A szállítási mód cserélve, a végösszeg nem változott.";
  if (!change.link)
    return `A szállítási mód cserélve, a végösszeg ${amount} összeggel nőtt.`;
  return change.link.sent
    ? `A szállítási mód cserélve, a végösszeg ${amount} összeggel nőtt. A vevő fizetési linket kapott a különbözetről.`
    : `A szállítási mód cserélve, a végösszeg ${amount} összeggel nőtt, de a fizetési link nem ment ki: a Fizetési link küldése gombbal küldheted.`;
}

/** Az „Értesítő újraküldése”: a legutóbbi státusz levelét küldi újra. */
function ResendStatusMail({ onResend }: { onResend: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-2">
      <PilotButton
        size="regular"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void onResend()
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Az újraküldés nem sikerült.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Értesítő újraküldése
      </PilotButton>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A KÁRTYÁS FIZETÉS ÚTJA A FIZETÉS KÁRTYÁN (lejáró zárolás, Balázs döntése
 * 2026-10-05): az állapot, a zárolás lejáratának jelzése az 5. naptól, a
 * „Csúszik a szállítás” (a zárolás feloldása) és a „Fizetési link küldése”.
 * Mindkét gomb párbeszédet nyit, a „Vevő értesítése” jelölővel.
 */
function CardPaymentSection({
  order,
  card,
  canManage,
  money,
  onRelease,
  onSendLink,
}: {
  order: WebshopOrderDetail;
  card: WebshopOrderCardPayment;
  canManage: boolean;
  money: (value: number) => string;
  onRelease: (notifyCustomer: boolean) => Promise<string>;
  onSendLink: (notifyCustomer: boolean) => Promise<string>;
}) {
  const [open, setOpen] = useState<"release" | "link" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const when = (iso: string) => LONG_DATE.format(new Date(iso));
  return (
    <div className="space-y-3 border-t border-pilot-grey-100 pt-3">
      <Field label="Kártyás fizetés">
        {WEBSHOP_CARD_PAYMENT_STATE_LABELS[card.state]}
      </Field>
      {card.holdWarning && card.holdExpiresAt ? (
        <p
          role="alert"
          className={`rounded-lg p-3 text-sm ${card.holdWarning === "expired" ? "bg-pilot-red-50 text-pilot-red-700" : "bg-pilot-amber-50 text-pilot-amber-700"}`}
        >
          {card.holdWarning === "expired"
            ? `A kártyás zárolás lejárt (${when(card.holdExpiresAt)}). Küldj fizetési linket, ha az áru megérkezett.`
            : `A kártyás zárolás 2 napon belül lejár (${when(card.holdExpiresAt)}). Ha a szállítás csúszik, oldd fel, és áruérkezéskor küldj fizetési linket.`}
        </p>
      ) : card.holdExpiresAt ? (
        <Field label="Zárolás lejár">{when(card.holdExpiresAt)}</Field>
      ) : null}
      {card.link ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Link elküldve">{when(card.link.sentAt)}</Field>
          <Field label="Link lejár">{when(card.link.expiresAt)}</Field>
          <Field label="Link összege">{money(card.link.amount)}</Field>
          {card.link.remindedAt ? (
            <Field label="Emlékeztető">{when(card.link.remindedAt)}</Field>
          ) : null}
          <Field
            label="Fizetési link"
            action={
              <CopyButton
                value={card.link.url}
                label="Fizetési link másolása"
              />
            }
          >
            <span className="break-all text-xs text-pilot-grey-600">
              {card.link.url}
            </span>
          </Field>
        </div>
      ) : null}
      {card.due ? (
        <Field
          label={
            card.due.reason === "difference"
              ? "Különbözet, fizetendő"
              : "Fizetendő linken"
          }
        >
          {money(card.due.amount)}
        </Field>
      ) : null}
      {card.paidAt ? (
        <Field label="Kifizetve">{when(card.paidAt)}</Field>
      ) : null}
      {canManage && (card.canRelease || card.canSendLink) ? (
        <div className="flex flex-wrap gap-2">
          {card.canRelease ? (
            <PilotButton
              size="regular"
              variant="secondary"
              onClick={() => setOpen("release")}
            >
              Csúszik a szállítás
            </PilotButton>
          ) : null}
          {card.canSendLink ? (
            <PilotButton
              size="regular"
              variant="primary"
              onClick={() => setOpen("link")}
            >
              Fizetési link küldése
            </PilotButton>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-pilot-grey-700">
          {notice}
        </p>
      ) : null}
      {open ? (
        <PaymentActionDialog
          title={
            open === "release" ? "Csúszik a szállítás" : "Fizetési link küldése"
          }
          confirmLabel={
            open === "release" ? "Zárolás feloldása" : "Link küldése"
          }
          danger={open === "release"}
          text={
            open === "release"
              ? `A kártyás zárolás (${payment(order, money)}) feloldódik, a vevő kártyáját nem terheljük. Áruérkezéskor fizetési linket küldünk.`
              : card.due?.reason === "difference"
                ? `A link az utólag hozzáadott tétel különbözetére szól: ${money(card.due.amount)}. A kártyás zárolás megmarad, a Kiszállításkor vonódik le.`
                : `A link a rendelés mostani végösszegére szól: ${money(card.due?.amount ?? order.totals.total)}. Ha tétel kiesett, előbb azt módosítsd.`
          }
          onClose={() => setOpen(null)}
          onConfirm={async (notify) => {
            setNotice(
              await (open === "release"
                ? onRelease(notify)
                : onSendLink(notify)),
            );
          }}
        />
      ) : null}
    </div>
  );
}

const payment = (
  order: WebshopOrderDetail,
  money: (value: number) => string,
) =>
  order.payment?.authorized != null
    ? money(order.payment.authorized)
    : "a zárolt összeg";

function PaymentActionDialog({
  title,
  confirmLabel,
  danger,
  text,
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  danger: boolean;
  text: string;
  onClose: () => void;
  onConfirm: (notifyCustomer: boolean) => Promise<void>;
}) {
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <PilotDialog open onClose={busy ? () => undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="space-y-4 p-5"
      >
        <h2 className="text-base font-semibold text-pilot-grey-900">{title}</h2>
        <p className="text-sm text-pilot-grey-700">{text}</p>
        <label className="flex items-center gap-2 text-sm text-pilot-grey-700">
          <input
            type="checkbox"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />
          Vevő értesítése
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
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
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm(notify)
                .then(onClose)
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "A művelet nem sikerült.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}

const EMPTY_ADDRESS: Omit<WebshopOrderAddressInput, "kind"> = {
  lastName: "",
  firstName: "",
  company: null,
  taxNumber: null,
  postalCode: "",
  city: "",
  line1: "",
  line2: null,
  phone: null,
  countryCode: "HU",
};

/** Ezekben az állapotokban adható fel csomag (a szerver is így dönt). */
const PARCEL_STATUSES: readonly (WebshopOrderStatus | null)[] = [
  "confirmed",
  "stocking",
  "out_for_delivery",
];

/** A „Feladtuk” levél sorsa egy mondatban. */
export function noticeText(notice: WebshopShippingNoticeOutcome): string {
  if (notice.sent) return "A vevő megkapta a „Feladtuk a csomagodat” levelet.";
  switch (notice.reason) {
    case "stub":
      return "Teszt-csomag: a vevő nem kap levelet róla.";
    case "mail_off":
      return "A webshop levélküldése ki van kapcsolva, a vevő nem kapott levelet.";
    case "no_email":
      return "A rendelésen nincs e-mail cím, a vevő nem kapott levelet.";
    case "already_sent":
      return "A „Feladtuk” levél már korábban kiment.";
    case "failed":
      return "A csomag létrejött, de a webshop nem volt elérhető, a levél nem ment ki.";
    default:
      return `A levél nem ment ki (${notice.reason}).`;
  }
}

/**
 * A CSOMAG A SZÁLLÍTÁS KÁRTYÁN (Rendelések, 5. PR). Előbb a számla; utána
 * „Csomag feladása” (Foxpostnál mérettel), majd a csomagszám és a címke. Ha a
 * létrehozás kimenete bizonytalan, új csomag csak kifejezett feloldás után
 * indítható, és a gomb megmondja, mit kell előtte megnézni.
 */
/**
 * A CSOMAGKÖVETÉS (a prompt 7. pontja): a szállító utolsó állapota, frissítés,
 * és ha a nyilvános követő oldal címe be van állítva, egy link oda. A cím nincs
 * kitalálva (acrobot 26620): beállítás nélkül nincs link.
 */
function ParcelTrackingField({
  trackingUrl,
  load,
}: {
  trackingUrl: string | null;
  load: () => Promise<WebshopParcelTracking>;
}) {
  const [tracking, setTracking] = useState<WebshopParcelTracking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setBusy(true);
    setError(null);
    void load()
      .then(setTracking)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A szállító állapota most nem kérdezhető le.",
        ),
      )
      .finally(() => setBusy(false));
  }, [load]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const last = tracking?.events[0] ?? null;
  return (
    <Field
      label="Csomagkövetés"
      action={
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Csomagkövetés frissítése"
            title="Csomagkövetés frissítése"
            disabled={busy}
            onClick={refresh}
            className="rounded-md p-1 text-pilot-grey-500 transition-colors hover:text-pilot-accent-warm-text disabled:opacity-40"
          >
            <Icon name="refresh" size={16} />
          </button>
          {trackingUrl ? (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Követés a szállító oldalán"
              title="Követés a szállító oldalán"
              className="rounded-md p-1 text-pilot-grey-500 transition-colors hover:text-pilot-accent-warm-text"
            >
              <Icon name="external-link" size={16} />
            </a>
          ) : null}
        </span>
      }
    >
      {error ? (
        <span className="text-pilot-red-700">{error}</span>
      ) : busy && !tracking ? (
        <span className="text-pilot-grey-500">Lekérdezés…</span>
      ) : last ? (
        <span>
          {last.text || last.status}
          {last.at ? (
            <span className="block text-xs text-pilot-grey-500">
              {TIME.format(new Date(last.at))}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-pilot-grey-500">
          A szállítónál még nincs állapot.
        </span>
      )}
    </Field>
  );
}

function ParcelSection({
  order,
  canManage,
  onCreate,
  onLabel,
  onRelease,
  onTracking,
}: {
  order: WebshopOrderDetail;
  canManage: boolean;
  onTracking: () => Promise<WebshopParcelTracking>;
  onCreate: (
    size: WebshopParcelSize | undefined,
  ) => Promise<WebshopShippingNoticeOutcome>;
  onLabel: () => Promise<void>;
  onRelease: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [size, setSize] = useState("");
  const parcel = order.parcel;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };
  const canCreate =
    canManage &&
    !parcel &&
    !!order.invoiceNumber &&
    PARCEL_STATUSES.includes(order.status.code) &&
    order.dispatchPreview?.ready !== false;
  const codDue = order.dispatchPreview?.codHuf ?? null;
  return (
    <div className="space-y-3">
      {parcel?.parcelNumber ? (
        <>
          <Field
            label="Csomagszám"
            action={
              <CopyButton
                value={parcel.parcelNumber}
                label="Csomagszám másolása"
              />
            }
          >
            {parcel.parcelNumber}
            {parcel.stub ? (
              <span className="ml-2 rounded-full bg-pilot-amber-50 px-2 py-0.5 text-xs font-medium text-pilot-amber-700">
                Teszt-csomag
              </span>
            ) : null}
          </Field>
          {parcel.codHuf ? (
            <Field label="Utánvét">{formatMoney(parcel.codHuf, "HUF")}</Field>
          ) : null}
          <ParcelTrackingField
            trackingUrl={parcel.trackingUrl}
            load={onTracking}
          />
          {canManage ? (
            <PilotButton
              size="regular"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(onLabel)}
            >
              Címke nyomtatása
            </PilotButton>
          ) : null}
        </>
      ) : parcel ? (
        <>
          <p className="text-sm text-pilot-amber-700">
            A csomag létrehozása folyamatban van, vagy az eredménye bizonytalan:
            a szállítónál létrejöhetett. Frissítsd az oldalt egy perc múlva.
          </p>
          {canManage ? (
            <PilotButton
              size="regular"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(onRelease)}
            >
              Létrehozás újraengedése
            </PilotButton>
          ) : null}
          {canManage ? (
            <p className="text-xs text-pilot-grey-500">
              Csak akkor engedd újra, ha a szállító felületén megnézted, hogy
              nem jött létre csomag.
            </p>
          ) : null}
        </>
      ) : !order.invoiceNumber || order.dispatchPreview?.ready === false ? (
        /*
          A GOMB OTT ÁLL, LETILTVA, ÉS MEGMONDJA, MIÉRT (a prompt 6. pontja):
          előbb számla, és a feladáshoz kellő adat (név, telefon, cím, pont)
          a feladás előtt kiderül, nem a szállító hibájából.
        */
        <div className="space-y-2">
          {canManage ? (
            <PilotButton
              size="regular"
              variant="primary"
              disabled
              title={
                !order.invoiceNumber
                  ? "Előbb állítsd ki a számlát"
                  : (order.dispatchPreview?.reason ?? undefined)
              }
            >
              Csomag feladása
            </PilotButton>
          ) : null}
          <p className="text-xs text-pilot-grey-500">
            {!order.invoiceNumber
              ? "Előbb állítsd ki a számlát, utána adható fel a csomag."
              : order.dispatchPreview?.reason}
          </p>
        </div>
      ) : canCreate ? (
        <div className="flex flex-wrap items-end gap-2">
          {order.shipping.carrier === "FOXPOST" ? (
            <label className="text-xs text-pilot-grey-600">
              Méret
              <PilotSelect
                chevron
                aria-label="Csomagméret"
                value={size}
                onChange={setSize}
                className="mt-1 [&_select]:h-10"
              >
                <option value="">Alapértelmezett</option>
                {WEBSHOP_PARCEL_SIZES.map((option) => (
                  <option key={option} value={option}>
                    {option.toUpperCase()}
                  </option>
                ))}
              </PilotSelect>
            </label>
          ) : null}
          {codDue !== null ? (
            <p className="w-full text-sm text-pilot-grey-700">
              Utánvét a csomagon:{" "}
              <span className="font-semibold">
                {formatMoney(codDue, "HUF")}
              </span>
            </p>
          ) : null}
          <PilotButton
            size="regular"
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const outcome = await onCreate(
                  (size || undefined) as WebshopParcelSize | undefined,
                );
                setNotice(noticeText(outcome));
              })
            }
          >
            {busy ? "Feladás…" : "Csomag feladása"}
          </PilotButton>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-pilot-grey-700">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function OrderBody({
  order,
  now,
  canManage,
  canIssue,
  canSendProforma,
  onSendProforma,
  onRecordTransfer,
  onSyncTransferToShop,
  onChangeStatus,
  mailNotice,
  onResendStatusMail,
  onIssueInvoice,
  onIssueDeliveryNote,
  onOpenPdf,
  onCreateParcel,
  onParcelLabel,
  onReleaseParcel,
  onParcelTracking,
  onEditLine,
  onSearchVariants,
  onReleaseHold,
  onSendPaymentLink,
  onUpdateAddress,
  onSaveNote,
  onChangePoint,
  onSplit,
  onLoadShippingOptions,
  onSearchMethodPoints,
  onChangeMethod,
  onSaveNotes,
  onSearchPoints,
}: {
  order: WebshopOrderDetail;
  now: number;
  canManage: boolean;
  canIssue: boolean;
  canSendProforma: boolean;
  onSendProforma: () => Promise<void>;
  onRecordTransfer: (input: WebshopTransferReceiptInput) => Promise<void>;
  onSyncTransferToShop: () => Promise<void>;
  onChangeStatus: (
    status: WebshopOrderStatus,
    notifyCustomer: boolean,
  ) => Promise<void>;
  mailNotice: string | null;
  onResendStatusMail: () => Promise<void>;
  onIssueInvoice: () => Promise<void>;
  onIssueDeliveryNote: () => Promise<void>;
  onOpenPdf: (documentId: string) => Promise<void>;
  onCreateParcel: (
    size: WebshopParcelSize | undefined,
  ) => Promise<WebshopShippingNoticeOutcome>;
  onParcelLabel: () => Promise<void>;
  onReleaseParcel: () => Promise<void>;
  onParcelTracking: () => Promise<WebshopParcelTracking>;
  onEditLine: (itemId: string, edit: WebshopOrderLineEdit) => Promise<void>;
  onSearchVariants: (query: string) => Promise<WebshopVariantOption[]>;
  onReleaseHold: (notifyCustomer: boolean) => Promise<string>;
  onSendPaymentLink: (notifyCustomer: boolean) => Promise<string>;
  onUpdateAddress: (input: WebshopOrderAddressInput) => Promise<void>;
  onSaveNote: (text: string) => Promise<void>;
  onChangePoint: (pointId: string) => Promise<void>;
  onSplit: (
    input: WebshopOrderSplitInput,
  ) => Promise<WebshopOrderSplitResult["created"]>;
  onLoadShippingOptions: () => Promise<WebshopShippingOptions>;
  onSearchMethodPoints: (
    optionId: string,
    query: string,
  ) => Promise<WebshopPickupPointSearch>;
  onChangeMethod: (input: WebshopOrderMethodInput) => Promise<void>;
  onSaveNotes: (input: WebshopOrderNotesInput) => Promise<void>;
  onSearchPoints: (query: string) => Promise<WebshopPickupPointSearch>;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // a sikeres bontás után a kijelölés is kiürül, a megszakított után marad
  const [splitDone, setSplitDone] = useState(false);
  const [editing, setEditing] = useState<
    | "billing"
    | "shipping"
    | "note"
    | "point"
    | "method"
    | "customerNote"
    | "carrierNote"
    | null
  >(null);
  const selection = useLineSelection(order.lines.map((line) => line.id));
  const terminal = !!order.status.code && TERMINAL.includes(order.status.code);
  const tile = order.status.code ? STATUS_TILE[order.status.code] : null;
  const money = (value: number) => formatMoney(value, order.currency);
  const payment = order.payment;
  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
              {orderNumber(order.displayId)}
            </h1>
            <CopyButton
              value={String(order.displayId)}
              label="Rendelésszám másolása"
            />
            {order.status.label ? (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${tile?.className ?? ""}`}
              >
                {order.status.label}
              </span>
            ) : (
              <span className="text-xs text-pilot-grey-500">Nincs státusz</span>
            )}
          </div>
          <p className="text-sm text-pilot-grey-600">
            Leadva: {LONG_DATE.format(new Date(order.createdAt))}
            {order.status.changedAt ? (
              <>
                {" · "}
                <span
                  className={
                    order.status.stale ? "font-medium text-pilot-amber-700" : ""
                  }
                >
                  ebben a státuszban:{" "}
                  {formatStatusAge(order.status.changedAt, now)}
                  {order.status.stale ? " (elavult)" : ""}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {terminal ? (
          <span className="text-sm font-medium text-pilot-grey-600">
            Végállapot
          </span>
        ) : canManage && order.nextStatuses.length ? (
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() => setStatusOpen(true)}
          >
            Státusz módosítása
          </PilotButton>
        ) : null}
      </header>
      {/* csak nyitva van a DOM-ban: a PilotDialog zárva is renderel, és egy
          láthatatlan párbeszéd a képernyőolvasónak ott maradna */}
      {canManage && !terminal && statusOpen ? (
        <StatusDialog
          order={order}
          open={statusOpen}
          onClose={() => setStatusOpen(false)}
          onSubmit={onChangeStatus}
        />
      ) : null}

      <Card title="Feldolgozás">
        <ol
          className="grid gap-3 md:grid-cols-5"
          aria-label="Feldolgozási lépések"
        >
          {order.steps.map((step, index) => (
            <li
              key={step.key}
              aria-label={`${index + 1}. ${step.label}: ${STEP_STATE_LABEL[step.state]}`}
              className="rounded-xl border border-pilot-grey-200 p-3"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${STEP_STYLE[step.state].circle}`}
                >
                  {step.state === "done" ? "✓" : index + 1}
                </span>
                <span className="text-sm font-semibold text-pilot-grey-900">
                  {step.label}
                </span>
              </span>
              <span
                className={`mt-2 block text-xs ${STEP_STYLE[step.state].detail}`}
              >
                {step.detail}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {order.relatedOrder ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-pilot-accent-warm-soft px-5 py-3">
          <p className="text-sm font-medium text-pilot-accent-warm-text">
            Kapcsolódó rendelés:{" "}
            {order.relatedOrder.displayId !== null
              ? orderNumber(order.relatedOrder.displayId)
              : "a pár"}{" "}
            ·{" "}
            {order.relatedOrder.role === "pickup"
              ? "bolti átvétel"
              : "a kiszállítandó fő rendelés"}
          </p>
          <Link
            href={`/webshop/rendelesek/${encodeURIComponent(order.relatedOrder.id)}`}
            className="rounded-lg border border-pilot-grey-200 bg-white px-3 py-1.5 text-sm font-medium text-pilot-grey-900 hover:border-pilot-accent-warm"
          >
            Megnyitás
          </Link>
        </div>
      ) : null}

      {order.split.unfinished ? (
        <UnfinishedSplitNotice
          unfinished={order.split.unfinished}
          allowed={order.splitEdit.allowed}
          onFinish={(unfinished) =>
            onSplit({
              requestId: unfinished.requestId,
              lines: unfinished.lines.map(({ itemId, quantity }) => ({
                itemId,
                quantity,
              })),
            })
          }
        />
      ) : null}

      {order.split.from || order.split.into.length ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-pilot-accent-warm-soft px-5 py-3 text-sm font-medium text-pilot-accent-warm-text">
          {order.split.from ? (
            <span>
              Szétbontva ebből:{" "}
              <Link
                href={`/webshop/rendelesek/${encodeURIComponent(order.split.from.id)}`}
                className="underline"
              >
                {order.split.from.displayId !== null
                  ? orderNumber(order.split.from.displayId)
                  : "az eredeti rendelés"}
              </Link>
            </span>
          ) : null}
          {order.split.into.length ? (
            <span>
              Kibontott rendelés:{" "}
              {order.split.into.map((part, index) => (
                <span key={part.id}>
                  {index ? ", " : null}
                  <Link
                    href={`/webshop/rendelesek/${encodeURIComponent(part.id)}`}
                    className="underline"
                  >
                    {part.displayId !== null
                      ? orderNumber(part.displayId)
                      : "kapcsolt rendelés"}
                  </Link>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Vevő">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Név"
                action={
                  canManage ? (
                    <EditPencil
                      label="Név szerkesztése"
                      reason={order.addressEdit.shipping.reason}
                      onClick={() => setEditing("shipping")}
                    />
                  ) : null
                }
              >
                {order.customer.name ?? "—"}
              </Field>
              <Field
                label="E-mail"
                action={
                  order.customer.email ? (
                    <a
                      href={`mailto:${order.customer.email}`}
                      title="E-mail küldése"
                      aria-label="E-mail küldése"
                      className="text-pilot-grey-500 hover:text-pilot-accent-warm"
                    >
                      <Icon name="mail" size={16} />
                    </a>
                  ) : null
                }
              >
                <span className="break-all">{order.customer.email || "—"}</span>
              </Field>
              <Field
                label="Telefon"
                action={
                  order.customer.phone ? (
                    <a
                      href={`tel:${order.customer.phone.replace(/\s/g, "")}`}
                      title="Hívás"
                      aria-label="Hívás"
                      className="text-pilot-grey-500 hover:text-pilot-accent-warm"
                    >
                      <Icon name="phone" size={16} />
                    </a>
                  ) : null
                }
              >
                {order.customer.phone ?? "—"}
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {order.customer.isNew ? (
                <span className="rounded-full bg-pilot-accent-warm-soft px-3 py-1 text-xs font-medium text-pilot-accent-warm-text">
                  ★ új vásárló
                </span>
              ) : null}
              {order.customer.guest ? (
                <span className="rounded-full bg-pilot-grey-100 px-3 py-1 text-xs font-medium text-pilot-grey-700">
                  ⊘ regisztráció nélkül
                </span>
              ) : null}
              {order.customer.unsuccessfulOrderCount ? (
                <span className="rounded-full bg-pilot-red-50 px-3 py-1 text-xs font-medium text-pilot-red-700">
                  ↓{order.customer.unsuccessfulOrderCount} korábbi sikertelen
                  rendelés
                </span>
              ) : null}
              {order.customer.hasOtherOpenOrder ? (
                <span className="rounded-full bg-pilot-blue-50 px-3 py-1 text-xs font-medium text-pilot-blue-700">
                  + van másik nyitott rendelése
                </span>
              ) : null}
              {order.osCustomer ? (
                <Link
                  href={`/vevok?search=${encodeURIComponent(order.osCustomer.customerNumber)}`}
                  className="ml-auto rounded-lg border border-pilot-grey-200 bg-white px-3 py-1.5 text-sm font-medium text-pilot-grey-900 hover:border-pilot-accent-warm"
                >
                  Vevő adatlapja
                </Link>
              ) : null}
            </div>
          </Card>

          <Card title="Számlázási és szállítási adatok">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Számlázási cím"
                action={
                  canManage ? (
                    <EditPencil
                      label="Számlázási cím szerkesztése"
                      reason={order.addressEdit.billing.reason}
                      onClick={() => setEditing("billing")}
                    />
                  ) : null
                }
              >
                <Address address={order.billingAddress} />
              </Field>
              <Field
                label="Szállítás"
                action={
                  canManage && !order.shipping.storePickup ? (
                    <EditPencil
                      label="Szállítási mód cseréje"
                      reason={order.methodEdit.reason}
                      onClick={() => setEditing("method")}
                    />
                  ) : null
                }
              >
                {glsDeliveryLabel({
                  method: order.shipping.method,
                  pointKind: order.shipping.pickupPoint?.kind ?? null,
                  hasPoint: !!order.shipping.pickupPoint,
                  storePickup: order.shipping.storePickup,
                }) ??
                  order.shipping.method ??
                  "—"}
                {order.shipping.pickupPoint?.type ? (
                  <span className="block text-pilot-grey-600">
                    {order.shipping.pickupPoint.type}
                  </span>
                ) : null}
              </Field>
              {order.shipping.pickupPoint ? (
                <>
                  <Field
                    label="Pont azonosító"
                    action={
                      order.shipping.pickupPoint.id ? (
                        <CopyButton
                          value={order.shipping.pickupPoint.id}
                          label="Pont azonosító másolása"
                        />
                      ) : null
                    }
                  >
                    {order.shipping.pickupPoint.id ?? "—"}
                  </Field>
                  <Field
                    label="Pont címe"
                    action={
                      canManage ? (
                        <EditPencil
                          label="Csomagpont cseréje"
                          reason={order.pointEdit.reason}
                          onClick={() => setEditing("point")}
                        />
                      ) : null
                    }
                  >
                    {order.shipping.pickupPoint.name}
                    {order.shipping.pickupPoint.address ? (
                      <span className="block text-pilot-grey-600">
                        {order.shipping.pickupPoint.address}
                      </span>
                    ) : null}
                  </Field>
                </>
              ) : !order.shipping.storePickup ? (
                <Field
                  label="Szállítási cím"
                  action={
                    canManage ? (
                      <EditPencil
                        label="Szállítási cím szerkesztése"
                        reason={order.addressEdit.shipping.reason}
                        onClick={() => setEditing("shipping")}
                      />
                    ) : null
                  }
                >
                  <Address address={order.shippingAddress} />
                </Field>
              ) : null}
            </div>
          </Card>

          <Card
            title="Tételek"
            action={
              selection.selectedIds.length ? (
                <button
                  type="button"
                  onClick={() => setSplitOpen(true)}
                  className="flex items-center gap-2 rounded-lg border border-pilot-accent-warm px-3 py-1 text-sm font-medium text-pilot-accent-warm-text"
                >
                  <ScissorsIcon />
                  Szétbontás
                </button>
              ) : null
            }
          >
            <OrderLinesTable
              order={order}
              money={money}
              canManage={canManage}
              selection={selection}
              onEdit={onEditLine}
              onSearchVariants={onSearchVariants}
            />
            {splitOpen ? (
              <SplitDialog
                lines={order.lines.filter((line) =>
                  selection.selectedIds.includes(line.id),
                )}
                allLines={order.lines}
                reason={order.splitEdit.reason}
                onSplit={async (input) => {
                  const created = await onSplit(input);
                  setSplitDone(true);
                  return created;
                }}
                onClose={() => {
                  setSplitOpen(false);
                  if (splitDone) selection.clear();
                  setSplitDone(false);
                }}
              />
            ) : null}
            <div className="mt-4 flex flex-col-reverse gap-4 border-t border-pilot-grey-200 pt-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {payment?.authorized != null &&
                payment.state === "AUTHORIZED" ? (
                  <>
                    <span className="rounded-full bg-pilot-blue-50 px-3 py-1 text-xs font-medium text-pilot-blue-700">
                      Zárolva: {money(payment.authorized)}
                    </span>
                    <span className="rounded-full bg-pilot-green-50 px-3 py-1 text-xs font-medium text-pilot-green-700">
                      Levonásra kerül: {money(payment.toCapture)}
                    </span>
                  </>
                ) : null}
              </div>
              <dl className="grid min-w-[240px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                <dt className="text-pilot-grey-500">Részösszeg</dt>
                <dd className="text-right">{money(order.totals.subtotal)}</dd>
                <dt className="text-pilot-grey-500">Kedvezmény</dt>
                <dd className="text-right">{money(order.totals.discount)}</dd>
                <dt className="text-pilot-grey-500">Szállítási díj</dt>
                <dd className="text-right">{money(order.totals.shipping)}</dd>
                <dt className="text-pilot-grey-500">Utánvét kezelési díj</dt>
                <dd className="text-right">{money(order.totals.codFee)}</dd>
                <dt className="pt-2 font-semibold text-pilot-grey-900">
                  Végösszeg
                </dt>
                <dd className="pt-2 text-right text-lg font-semibold text-pilot-grey-900">
                  {money(order.totals.total)}
                </dd>
              </dl>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Fizetés">
            {payment ? (
              <div className="space-y-4">
                <Field label="Mód">{payment.method ?? "—"}</Field>
                {payment.state ? (
                  <span className="inline-block rounded-full bg-pilot-blue-50 px-3 py-1 text-xs font-medium text-pilot-blue-700">
                    {WEBSHOP_ORDER_PAYMENT_STATE_LABELS[payment.state]}
                  </span>
                ) : null}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Zárolt összeg">
                    {payment.authorized != null
                      ? money(payment.authorized)
                      : "—"}
                  </Field>
                  <Field label="Levonandó">{money(payment.toCapture)}</Field>
                  {payment.captured ? (
                    <Field label="Levonva">{money(payment.captured)}</Field>
                  ) : null}
                  {payment.refunded ? (
                    <Field label="Visszatérítve">
                      {money(payment.refunded)}
                    </Field>
                  ) : null}
                </div>
                {payment.stripePaymentIntentId ? (
                  <Field
                    label="Stripe ID"
                    action={
                      <CopyButton
                        value={payment.stripePaymentIntentId}
                        label="Stripe ID másolása"
                      />
                    }
                  >
                    <span className="break-all text-xs text-pilot-grey-600">
                      {payment.stripePaymentIntentId}
                    </span>
                  </Field>
                ) : null}
                {order.cardPayment ? (
                  <CardPaymentSection
                    order={order}
                    card={order.cardPayment}
                    canManage={canManage}
                    money={money}
                    onRelease={onReleaseHold}
                    onSendLink={onSendPaymentLink}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-500">
                A webshop nem rögzített fizetést ehhez a rendeléshez.
              </p>
            )}
            {order.bankTransfer ? (
              <ProformaSection
                order={order}
                now={now}
                canSend={canSendProforma}
                canRecord={canIssue}
                onSend={onSendProforma}
                onRecord={onRecordTransfer}
                onSyncShop={onSyncTransferToShop}
              />
            ) : null}
          </Card>

          <Card title="Szállítás">
            <div className="space-y-4">
              <Field label="Fuvarozó">
                {order.shipping.carrier === "FOXPOST" ? (
                  // a hivatalos logó (FOXPOST - Packeta Group, Balázs döntése 2081), a kirakatéval azonos fájl
                  // eslint-disable-next-line @next/next/no-img-element -- static PNG
                  <img
                    src="/images/foxpost-packeta-group.png"
                    alt="FOXPOST"
                    height={28}
                    className="h-7 w-auto"
                  />
                ) : order.shipping.carrier === "GLS" ? (
                  // a GLS hivatalos logói a csomag fajtájához, a kirakatéval azonos fájlok (commerce #489)
                  // eslint-disable-next-line @next/next/no-img-element -- static PNG
                  <img
                    src={glsLogoOf(order.shipping.pickupPoint).src}
                    alt={glsLogoOf(order.shipping.pickupPoint).alt}
                    height={28}
                    className="h-7 w-auto"
                  />
                ) : order.shipping.storePickup ? (
                  "Bolti átvétel"
                ) : (
                  (order.shipping.carrier ?? order.shipping.method ?? "—")
                )}
              </Field>
              {order.shipping.storePickup ? null : (
                <ParcelSection
                  order={order}
                  canManage={canManage}
                  onCreate={onCreateParcel}
                  onLabel={onParcelLabel}
                  onRelease={onReleaseParcel}
                  onTracking={onParcelTracking}
                />
              )}
            </div>
          </Card>

          <InvoiceCard
            order={order}
            canIssue={canIssue}
            onIssue={onIssueInvoice}
            onIssueDeliveryNote={onIssueDeliveryNote}
            onOpenPdf={onOpenPdf}
          />

          <Card title="Megjegyzések">
            <div className="space-y-4">
              <Field
                label="Vevő megjegyzése"
                action={
                  canManage ? (
                    <EditPencil
                      label="Vevő megjegyzésének szerkesztése"
                      reason={order.notesEdit.customer.reason}
                      onClick={() => setEditing("customerNote")}
                    />
                  ) : null
                }
              >
                {order.notes.customer ? (
                  <span className="whitespace-pre-wrap">
                    {order.notes.customer}
                  </span>
                ) : (
                  <span className="text-pilot-grey-500">Nincs.</span>
                )}
              </Field>
              <Field
                label="Szállítónak"
                action={
                  canManage ? (
                    <EditPencil
                      label="A szállítónak szóló üzenet szerkesztése"
                      reason={order.notesEdit.carrier.reason}
                      onClick={() => setEditing("carrierNote")}
                    />
                  ) : null
                }
              >
                {order.notes.carrier ? (
                  <span className="whitespace-pre-wrap">
                    {order.notes.carrier}
                  </span>
                ) : (
                  <span className="text-pilot-grey-500">Nincs.</span>
                )}
              </Field>
              <Field
                label="Belső megjegyzés"
                action={
                  canManage ? (
                    <EditPencil
                      label="Belső megjegyzés szerkesztése"
                      reason={null}
                      onClick={() => setEditing("note")}
                    />
                  ) : null
                }
              >
                {order.internalNote ? (
                  <span className="whitespace-pre-wrap">
                    {order.internalNote.text}
                  </span>
                ) : (
                  <span className="text-pilot-grey-500">Nincs.</span>
                )}
              </Field>
            </div>
          </Card>
          {editing === "billing" || editing === "shipping" ? (
            <AddressDialog
              kind={editing}
              initial={
                (editing === "billing"
                  ? order.billingAddress
                  : order.shippingAddress
                )?.fields ??
                (editing === "shipping"
                  ? order.billingAddress?.fields
                  : null) ??
                EMPTY_ADDRESS
              }
              onClose={() => setEditing(null)}
              onSave={onUpdateAddress}
            />
          ) : null}
          {editing === "note" ? (
            <NoteDialog
              initial={order.internalNote?.text ?? ""}
              onClose={() => setEditing(null)}
              onSave={onSaveNote}
            />
          ) : null}
          {editing === "customerNote" ? (
            <NoteDialog
              title="Vevő megjegyzése"
              maxLength={WEBSHOP_CUSTOMER_NOTE_MAX}
              hint="A vevő a pénztárban írta; a webshop rendelésén áll. Üresen mentve törlődik."
              initial={order.notes.customer ?? ""}
              onClose={() => setEditing(null)}
              onSave={(text) => onSaveNotes({ customerNote: text })}
            />
          ) : null}
          {editing === "carrierNote" ? (
            <NoteDialog
              title="Szállítónak"
              maxLength={WEBSHOP_CARRIER_NOTE_MAX}
              hint="A csomag feladásakor a futár megkapja (GLS: a címkén, Foxpost: a házhoz szállító futárnak). Üresen mentve törlődik."
              initial={order.notes.carrier ?? ""}
              onClose={() => setEditing(null)}
              onSave={(text) => onSaveNotes({ carrierNote: text })}
            />
          ) : null}
          {editing === "method" ? (
            <MethodDialog
              currentPointId={order.shipping.pickupPoint?.id ?? null}
              loadOptions={onLoadShippingOptions}
              searchPoints={onSearchMethodPoints}
              onClose={() => setEditing(null)}
              onSave={onChangeMethod}
            />
          ) : null}
          {editing === "point" ? (
            <PointDialog
              currentPointId={order.shipping.pickupPoint?.id ?? null}
              search={onSearchPoints}
              onClose={() => setEditing(null)}
              onSave={onChangePoint}
            />
          ) : null}

          <Card title="Hűségpontok">
            <p className="text-sm text-pilot-grey-500">
              Hűségpont-adat még nincs a webshopban.
            </p>
          </Card>
        </div>
      </div>

      <Card title="Előzmények">
        {order.history.length ? (
          <ol className="space-y-3">
            {order.history.map((entry) => (
              <li
                key={`${entry.at}-${entry.text}`}
                className="flex flex-wrap gap-3 text-sm"
              >
                <span className="shrink-0 rounded-md bg-pilot-grey-100 px-2 py-0.5 text-xs text-pilot-grey-600">
                  {TIME.format(new Date(entry.at))}
                </span>
                <span className="text-pilot-grey-800">{entry.text}</span>
                {entry.mail ? (
                  <span
                    className={`text-xs ${MAIL_STATE[entry.mail.status].className}`}
                  >
                    {MAIL_STATE[entry.mail.status].label}
                    {entry.mail.at
                      ? ` · ${TIME.format(new Date(entry.mail.at))}`
                      : ""}
                    {entry.mail.resent
                      ? ` (újraküldve ${entry.mail.resent}×)`
                      : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-pilot-grey-500">
            Nincs rögzített előzmény.
          </p>
        )}
        {mailNotice ? (
          <p role="status" className="mt-3 text-sm text-pilot-grey-700">
            {mailNotice}
          </p>
        ) : null}
        {canManage && order.history.length ? (
          <ResendStatusMail onResend={onResendStatusMail} />
        ) : null}
      </Card>
    </>
  );
}

/**
 * FÉLBEMARADT SZÉTBONTÁS (acrobot 26807, commerce #504): a tételek már
 * kikerültek ebből a rendelésből, az új rendelés még nem jött létre. Amíg ez
 * nem látszik, senki nem tudja, hogy a tétel hiányzik. A gomb a félbemaradt
 * szétbontást fejezi be a rekordjából; új bontást nem indít.
 */
function UnfinishedSplitNotice({
  unfinished,
  allowed,
  onFinish,
}: {
  unfinished: NonNullable<WebshopOrderDetail["split"]["unfinished"]>;
  allowed: boolean;
  onFinish: (
    unfinished: NonNullable<WebshopOrderDetail["split"]["unfinished"]>,
  ) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFinish(unfinished);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A szétbontás befejezése nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      data-testid="unfinished-split"
      className="space-y-2 rounded-2xl border border-pilot-red-700 bg-pilot-red-50 px-5 py-3 text-sm text-pilot-red-700"
    >
      <p className="font-semibold">Félbemaradt szétbontás</p>
      <p>
        Ezek a tételek már kikerültek ebből a rendelésből, de az új rendelés még
        nem jött létre:{" "}
        {unfinished.lines
          .map((line) => `${line.title} (${line.quantity} db)`)
          .join(", ")}
        . A befejezés létrehozza az új rendelést, a tételek nem vesznek el.
      </p>
      {error ? <p className="font-medium">{error}</p> : null}
      {allowed ? (
        <PilotButton
          size="regular"
          variant="primary"
          disabled={busy}
          onClick={() => void finish()}
        >
          {busy ? "Befejezés…" : "Szétbontás befejezése"}
        </PilotButton>
      ) : null}
    </div>
  );
}
