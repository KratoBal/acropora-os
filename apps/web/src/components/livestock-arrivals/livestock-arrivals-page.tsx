"use client";

import {
  Alert,
  EmptyState,
  PilotDateField,
  PilotDrawer,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  isLivestockArrivalOpen,
  LIVESTOCK_ARRIVAL_KINDS,
  LIVESTOCK_ARRIVAL_KIND_LABELS,
  LIVESTOCK_ARRIVAL_LIMITS,
  LIVESTOCK_ARRIVAL_STATUSES,
  LIVESTOCK_ARRIVAL_STATUS_LABELS,
  PERMISSIONS,
  type LivestockArrival,
  type LivestockArrivalKind,
  type LivestockArrivalStatus,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  MortalitySearchPicker,
  type PickerOption,
} from "@/components/mortality/mortality-search-picker";
import {
  PilotBadge,
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import {
  livestockArrivalsApi,
  type LivestockArrivalFilters,
  type LivestockArrivalInput,
} from "@/lib/api/livestock-arrivals";
import { ApiError } from "@/lib/api/client";
import { formatDayHu } from "@/lib/format/date";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Ismeretlen hiba";

const STATUS_BADGE: Record<
  LivestockArrivalStatus,
  "grey" | "amber" | "success" | "danger"
> = {
  ORDERED: "grey",
  IN_TRANSIT: "amber",
  ARRIVED: "success",
  CANCELLED: "danger",
};

/** Az űrlap mezői szövegként (a mennyiség és a dátum is): a mentés alakítja át. */
interface FormState {
  kind: LivestockArrivalKind;
  label: string;
  product: PickerOption | null;
  expectedOn: string;
  quantity: string;
  status: LivestockArrivalStatus;
  preorderable: boolean;
  note: string;
}

const EMPTY_FORM: FormState = {
  kind: "FISH",
  label: "",
  product: null,
  expectedOn: "",
  quantity: "",
  status: "ORDERED",
  preorderable: false,
  note: "",
};

function formOf(row: LivestockArrival | null): FormState {
  if (!row) return EMPTY_FORM;
  return {
    kind: row.kind,
    label: row.label,
    product: row.productId
      ? { id: row.productId, title: row.productName ?? row.productId }
      : null,
    expectedOn: row.expectedOn,
    quantity: row.quantity === null ? "" : String(row.quantity),
    status: row.status,
    preorderable: row.preorderable,
    note: row.note ?? "",
  };
}

/**
 * A FORM -> AZ API ALAKJA. Üres mennyiség és üres megjegyzés `null` (a módosításnál ez TÖRLI az értéket); a megnevezést
 * levágjuk. Hibát nem dob: aki a mezőket ellenőrzi, az a szerver (valódi nap, megnevezés, előjegyzés csak úton lévőre).
 */
export function inputOfForm(form: FormState): LivestockArrivalInput {
  const quantity = form.quantity.trim();
  return {
    kind: form.kind,
    label: form.label.trim(),
    // a kiürített választó `null`: a módosításnál ez törli a kötést
    productId: form.product?.id ?? null,
    expectedOn: form.expectedOn,
    quantity: quantity === "" ? null : Number(quantity),
    status: form.status,
    // egy lezárt érkezés nem előjegyezhető: a pipa nem megy ki bekapcsolva
    preorderable: form.preorderable && isLivestockArrivalOpen(form.status),
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
}

function ArrivalDrawer({
  token,
  row,
  onClose,
  onSaved,
  onStale,
}: {
  token: string;
  row: LivestockArrival | null;
  onClose: () => void;
  onSaved: () => void;
  /** Az érkezést közben más módosította (409): a lista frissüljön, hogy az újranyitott sor már az új értékekkel jöjjön. */
  onStale: () => void;
}) {
  const [form, setForm] = useState<FormState>(formOf(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ütközés után a mentés zárva: ez az űrlap a régi verzióból jött, minden mentése újra ütközne. */
  const [stale, setStale] = useState(false);
  const open = isLivestockArrivalOpen(form.status);
  /** A találatok fajtája azonosító szerint: a választó csak az azonosítót és a nevet adja vissza. */
  const productKinds = useRef(new Map<string, LivestockArrivalKind | null>());
  /** Ha a termék kategóriái egyértelműen megmondják a fajtát, a szerver más fajtát nem fogad el: a mező zárva. */
  const lockedKind = form.product
    ? (productKinds.current.get(form.product.id) ?? null)
    : null;
  const searchProducts = useCallback(
    async (term: string, signal: AbortSignal) =>
      (await livestockArrivalsApi.productOptions(token, term, signal)).map(
        (option) => {
          productKinds.current.set(option.id, option.kind);
          return {
            id: option.id,
            title: option.name,
            subtitle: option.commonName,
          };
        },
      ),
    [token],
  );
  const chooseProduct = (option: PickerOption | null) =>
    setForm((current) => {
      if (!option) return { ...current, product: null };
      const kind = productKinds.current.get(option.id) ?? null;
      return {
        ...current,
        product: option,
        // a fajta a termékből jön, ha egyértelmű; a megnevezés csak üresen töltődik ki
        kind: kind ?? current.kind,
        label: current.label.trim() === "" ? option.title : current.label,
      };
    });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = inputOfForm(form);
      if (row)
        await livestockArrivalsApi.update(token, row.id, input, row.updatedAt);
      else await livestockArrivalsApi.create(token, input);
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        setStale(true);
        onStale();
      }
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    form.label.trim().length > 0 && form.expectedOn !== "" && !busy && !stale;

  return (
    <PilotDrawer
      open
      onClose={onClose}
      title={row ? "Érkezés szerkesztése" : "Új érkezés"}
      subtitle={row ? row.label : "Mi jön, mikor, és előjegyezhető-e."}
      footer={
        <div className="flex justify-end gap-2">
          <PilotButton variant="secondary" onClick={onClose}>
            Mégse
          </PilotButton>
          <PilotButton disabled={!canSave} onClick={() => void save()}>
            Mentés
          </PilotButton>
        </div>
      }
    >
      <div
        className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        data-testid="livestock-arrival-form"
      >
        {error ? (
          <Alert variant="danger" title="Nem sikerült" description={error} />
        ) : null}
        <PilotFormField
          label="Termék"
          help="Nem kötelező. Ha az érkező állat egy termék a boltban, válaszd ki: a fajta a termék kategóriájából jön, és az üres megnevezés kitöltődik."
        >
          <MortalitySearchPicker
            label="Termék"
            placeholder="Keresés név alapján…"
            value={form.product}
            onChange={chooseProduct}
            search={searchProducts}
            emptyText="Nincs ilyen nevű élő állat."
          />
        </PilotFormField>
        <PilotFormField
          label="Fajta"
          required
          help={
            lockedKind ? "A kiválasztott termék kategóriájából jön." : undefined
          }
        >
          <PilotSelect
            value={form.kind}
            disabled={lockedKind !== null}
            onChange={(value) => set("kind", value as LivestockArrivalKind)}
            aria-label="Fajta"
          >
            {LIVESTOCK_ARRIVAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LIVESTOCK_ARRIVAL_KIND_LABELS[kind]}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField
          label="Megnevezés"
          required
          help="Amit a vevő olvasni fog: a faj, a csoport (például Zoanthus) vagy az egyedi darab neve."
        >
          <PilotInput
            value={form.label}
            onChange={(value) => set("label", value)}
            maxLength={LIVESTOCK_ARRIVAL_LIMITS.label.max}
            aria-label="Megnevezés"
          />
        </PilotFormField>
        <PilotFormField label="Várható érkezés napja" required>
          <PilotDateField
            value={form.expectedOn}
            onChange={(value) => set("expectedOn", value)}
            aria-label="Várható érkezés napja"
          />
        </PilotFormField>
        <PilotFormField label="Darabszám" help="Üresen hagyható.">
          <PilotInput
            value={form.quantity}
            onChange={(value) => set("quantity", value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            aria-label="Darabszám"
          />
        </PilotFormField>
        <PilotFormField label="Állapot" required>
          <PilotSelect
            value={form.status}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                status: value as LivestockArrivalStatus,
                // a lezárás leveszi a pipát (a szerver is így tesz)
                preorderable:
                  current.preorderable &&
                  isLivestockArrivalOpen(value as LivestockArrivalStatus),
              }))
            }
            aria-label="Állapot"
          >
            {LIVESTOCK_ARRIVAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LIVESTOCK_ARRIVAL_STATUS_LABELS[status]}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.preorderable && open}
            disabled={!open}
            onChange={(event) => set("preorderable", event.target.checked)}
          />
          <span>
            Előjegyezhető
            {open ? (
              ""
            ) : (
              <span className="block text-xs text-pilot-grey-600">
                Csak megrendelt vagy úton lévő érkezésre lehet előjegyezni.
              </span>
            )}
          </span>
        </label>
        <PilotFormField label="Megjegyzés (belső)" help="A vevő ezt nem látja.">
          <PilotInput
            value={form.note}
            onChange={(value) => set("note", value)}
            maxLength={LIVESTOCK_ARRIVAL_LIMITS.note.max}
            aria-label="Megjegyzés"
          />
        </PilotFormField>
      </div>
    </PilotDrawer>
  );
}

/**
 * AZ ÉLŐ ÁLLAT ÉRKEZÉSEK (kártya f4e4832b, V2.6 S2; acrobot, 2026-11-06). Mi jön, mikor, hány darab, és előjegyezhető-e: kézzel
 * vezetjük, pénz nincs benne, vevői felület még nincs. Olvasni az inventory.view, felvenni és módosítani az inventory.manage
 * joga. Törlés nincs: a lemondott érkezés Lemondva állapotú, a sor az előzmény. A termék-kapcsoló választó a következő szelet
 * (az API tudja a kötést; ha van, a lista a termék nevét mutatja).
 */
export function LivestockArrivalsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_MANAGE),
  );
  const [rows, setRows] = useState<LivestockArrival[] | null>(null);
  /** A szerver levágta a listát: több érkezés felel meg a szűrőnek, mint amennyit mutat. */
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | LivestockArrivalStatus>("");
  const [kind, setKind] = useState<"" | LivestockArrivalKind>("");
  const [onlyPreorderable, setOnlyPreorderable] = useState(false);
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [editing, setEditing] = useState<
    { row: LivestockArrival | null } | undefined
  >(undefined);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      const filters: LivestockArrivalFilters = {
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(onlyPreorderable ? { preorderable: true } : {}),
        ...(onlyUpcoming ? { upcoming: true } : {}),
      };
      try {
        const response = await livestockArrivalsApi.list(
          token,
          filters,
          signal,
        );
        setRows(response.items);
        setTruncated(response.truncated);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(errorText(cause));
        setRows((current) => current ?? []);
      }
    },
    [token, canView, status, kind, onlyPreorderable, onlyUpcoming],
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
        title="Nincs hozzáférésed az élő állat érkezésekhez"
        description="A megtekintéshez készlet-megtekintési jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Élő állat érkezések"
        description="Mi érkezik, mikor, és előjegyezhető-e. Kézzel vezetjük; vevői felület még nincs rá."
        actions={
          canManage ? (
            <PilotButton onClick={() => setEditing({ row: null })}>
              Új érkezés
            </PilotButton>
          ) : undefined
        }
      />
      <section
        className="flex flex-wrap items-end gap-3"
        aria-label="Szűrők"
        data-testid="livestock-arrival-filters"
      >
        <PilotFormField label="Állapot">
          <PilotSelect
            value={status}
            onChange={(value) =>
              setStatus(value as "" | LivestockArrivalStatus)
            }
            aria-label="Állapot szűrő"
          >
            <option value="">Minden állapot</option>
            {LIVESTOCK_ARRIVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LIVESTOCK_ARRIVAL_STATUS_LABELS[s]}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Fajta">
          <PilotSelect
            value={kind}
            onChange={(value) => setKind(value as "" | LivestockArrivalKind)}
            aria-label="Fajta szűrő"
          >
            <option value="">Minden fajta</option>
            {LIVESTOCK_ARRIVAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {LIVESTOCK_ARRIVAL_KIND_LABELS[k]}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={onlyUpcoming}
            onChange={(event) => setOnlyUpcoming(event.target.checked)}
          />
          Csak a közelgők
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={onlyPreorderable}
            onChange={(event) => setOnlyPreorderable(event.target.checked)}
          />
          Csak az előjegyezhetők
        </label>
      </section>
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {truncated ? (
        <Alert
          title={`Csak az első ${LIVESTOCK_ARRIVAL_LIMITS.list.max} érkezést mutatjuk`}
          description="Ennél több érkezés felel meg a szűrőnek, a lista a legközelebbiekkel kezdődik. Szűkítsd állapotra vagy fajtára, vagy kapcsold be a Csak a közelgők szűrőt."
        />
      ) : null}
      {rows === null ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nincs ilyen érkezés"
          description={
            canManage
              ? "Az első érkezést az Új érkezés gombbal veheted fel, vagy lazíts a szűrőkön."
              : "Lazíts a szűrőkön."
          }
        />
      ) : (
        <ul
          className="divide-y divide-pilot-grey-100 rounded-xl border border-pilot-grey-200 bg-white text-sm"
          data-testid="livestock-arrival-list"
        >
          {rows.map((row) => (
            <li key={row.id}>
              {/* a sor gombként nyílik szerkesztésre, csak aki módosíthat */}
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEditing({ row })}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left disabled:cursor-default"
              >
                <span className="w-28 font-medium tabular-nums">
                  {formatDayHu(row.expectedOn)}
                </span>
                <span className="w-28 text-pilot-grey-600">
                  {LIVESTOCK_ARRIVAL_KIND_LABELS[row.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.label}</span>
                  {row.productName ? (
                    <span className="block truncate text-xs text-pilot-grey-600">
                      Termék: {row.productName}
                    </span>
                  ) : null}
                </span>
                <span className="w-20 text-right tabular-nums">
                  {row.quantity === null ? "–" : `${row.quantity} db`}
                </span>
                <PilotBadge variant={STATUS_BADGE[row.status]}>
                  {LIVESTOCK_ARRIVAL_STATUS_LABELS[row.status]}
                </PilotBadge>
                {row.preorderable ? (
                  <PilotBadge variant="success">Előjegyezhető</PilotBadge>
                ) : null}
              </button>
              {row.note ? (
                <p className="px-4 pb-3 text-xs text-pilot-grey-600">
                  {row.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ArrivalDrawer
          key={editing.row?.id ?? "new"}
          token={token}
          row={editing.row}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
          onStale={() => void load()}
        />
      ) : null}
    </PilotThemeRoot>
  );
}
