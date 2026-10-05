"use client";
import { Alert, Button, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  WEBSHOP_ORDER_PAYMENT_STATE_LABELS,
  type WebshopOrderAddress,
  type WebshopOrderDetail,
  type WebshopOrderStatus,
  type WebshopOrderStep,
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
import { webshopOrdersApi } from "@/lib/api/webshop-orders";
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
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-2xl border border-pilot-grey-200 bg-white p-5 ${className}`}
    >
      <h2 className="mb-4 text-base font-semibold text-pilot-grey-900">
        {title}
      </h2>
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
  onSubmit: (status: WebshopOrderStatus) => Promise<void>;
}) {
  const [next, setNext] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setNext(order.nextStatuses[0]?.status ?? "");
      setError(null);
    }
  }, [open, order.nextStatuses]);
  const submit = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(next as WebshopOrderStatus);
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
  const token = session?.token ?? "";
  const changeStatus = async (status: WebshopOrderStatus) => {
    setOrder(await webshopOrdersApi.changeStatus(token, id, status));
    setNow(Date.now());
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
          onChangeStatus={changeStatus}
        />
      ) : null}
    </PilotThemeRoot>
  );
}

function OrderBody({
  order,
  now,
  canManage,
  onChangeStatus,
}: {
  order: WebshopOrderDetail;
  now: number;
  canManage: boolean;
  onChangeStatus: (status: WebshopOrderStatus) => Promise<void>;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Vevő">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Név">{order.customer.name ?? "—"}</Field>
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
            </div>
          </Card>

          <Card title="Számlázási és szállítási adatok">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Számlázási cím">
                <Address address={order.billingAddress} />
              </Field>
              <Field label="Szállítás">{order.shipping.method ?? "—"}</Field>
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
                  <Field label="Pont címe">
                    {order.shipping.pickupPoint.name}
                    {order.shipping.pickupPoint.address ? (
                      <span className="block text-pilot-grey-600">
                        {order.shipping.pickupPoint.address}
                      </span>
                    ) : null}
                  </Field>
                </>
              ) : !order.shipping.storePickup ? (
                <Field label="Szállítási cím">
                  <Address address={order.shippingAddress} />
                </Field>
              ) : null}
            </div>
          </Card>

          <Card title="Tételek">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-pilot-grey-200 text-[11px] uppercase tracking-[0.05em] text-pilot-grey-500">
                    <th className="py-2 pr-3 font-semibold">Termék</th>
                    <th className="py-2 pr-3 font-semibold">Cikkszám</th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      Menny.
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      Egységár
                    </th>
                    <th className="py-2 text-right font-semibold">Összesen</th>
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
                      <td className="py-3 text-right font-semibold">
                        {money(line.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-500">
                A webshop nem rögzített fizetést ehhez a rendeléshez.
              </p>
            )}
          </Card>

          <Card title="Szállítás">
            <div className="space-y-4">
              <Field label="Fuvarozó">
                {order.shipping.storePickup
                  ? "Bolti átvétel"
                  : (order.shipping.carrier ?? order.shipping.method ?? "—")}
              </Field>
              {order.shipping.storePickup ? null : (
                <p className="text-xs text-pilot-grey-500">
                  {order.invoiceNumber
                    ? "A csomagfeladás a következő körben kerül ide."
                    : "Előbb állítsd ki a számlát, utána adható fel a csomag."}
                </p>
              )}
            </div>
          </Card>

          <Card title="Számla">
            <p className="text-sm text-pilot-grey-700">
              {order.invoiceNumber ?? "Még nincs kiállított számla."}
            </p>
          </Card>

          <Card title="Megjegyzések">
            <p className="text-sm text-pilot-grey-500">
              A webshop pénztára ma nem kér be megjegyzést (sem a vevőtől, sem a
              szállítónak). A belső megjegyzés a következő körben kerül ide.
            </p>
          </Card>

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
                className="flex gap-3 text-sm"
              >
                <span className="shrink-0 rounded-md bg-pilot-grey-100 px-2 py-0.5 text-xs text-pilot-grey-600">
                  {TIME.format(new Date(entry.at))}
                </span>
                <span className="text-pilot-grey-800">{entry.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-pilot-grey-500">
            Nincs rögzített előzmény.
          </p>
        )}
      </Card>
    </>
  );
}
