"use client";
import { Icon } from "@acropora/ui";
import type {
  WebshopOrderAddressInput,
  WebshopOrderMethodInput,
  WebshopPickupPointSearch,
  WebshopShippingOptions,
} from "@acropora/types";
import { useEffect, useState, type ReactNode } from "react";
import {
  PilotButton,
  PilotDialog,
  PilotInput,
} from "@/components/pilot/pilot-ui";
import { formatMoney } from "./webshop-orders-list-page";

/**
 * AZ ADATLAP CERUZÁI (Figma 494:386; acrobot 26502): a cím (számlázási és
 * szállítási, a név a szállítási címen) és a belső megjegyzés szerkesztése.
 * Ha a szerkesztés most nem megy (kiállított számla, feladott csomag), a
 * ceruza tiltott, és a tooltip megmondja, miért.
 */
export function EditPencil({
  label,
  reason,
  onClick,
}: {
  label: string;
  /** Ha nem `null`, a ceruza tiltott, és ez a tooltip. */
  reason: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={reason ?? label}
      disabled={reason !== null}
      onClick={onClick}
      className="rounded-md p-1 text-pilot-grey-500 transition-colors hover:text-pilot-accent-warm-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-pilot-grey-500"
    >
      <Icon name="pencil" size={16} />
    </button>
  );
}

function Shell({
  title,
  busy,
  error,
  onClose,
  onSave,
  saveDisabled,
  children,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  children: ReactNode;
}) {
  return (
    <PilotDialog open onClose={busy ? () => undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="space-y-3 p-5"
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
            variant="primary"
            disabled={busy || saveDisabled}
            onClick={onSave}
          >
            Mentés
          </PilotButton>
        </div>
      </div>
    </PilotDialog>
  );
}

function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(onClose)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "A mentés nem sikerült.",
        ),
      )
      .finally(() => setBusy(false));
  };
  return { busy, error, save };
}

const FIELD_LABELS: [keyof Omit<WebshopOrderAddressInput, "kind">, string][] = [
  ["lastName", "Vezetéknév"],
  ["firstName", "Keresztnév"],
  ["company", "Cégnév"],
  ["taxNumber", "Adószám"],
  ["postalCode", "Irányítószám"],
  ["city", "Város"],
  ["line1", "Utca, házszám"],
  ["line2", "Emelet, ajtó"],
  ["phone", "Telefon"],
];

const REQUIRED: (keyof WebshopOrderAddressInput)[] = [
  "lastName",
  "firstName",
  "postalCode",
  "city",
  "line1",
];

export function AddressDialog({
  kind,
  initial,
  onClose,
  onSave,
}: {
  kind: "billing" | "shipping";
  initial: Omit<WebshopOrderAddressInput, "kind">;
  onClose: () => void;
  onSave: (input: WebshopOrderAddressInput) => Promise<void>;
}) {
  const [form, setForm] = useState({ ...initial });
  const { busy, error, save } = useSave(onClose);
  const missing = REQUIRED.some(
    (key) => !String(form[key as keyof typeof form] ?? "").trim(),
  );
  return (
    <Shell
      title={kind === "billing" ? "Számlázási cím" : "Szállítási cím és név"}
      busy={busy}
      error={error}
      onClose={onClose}
      saveDisabled={missing}
      onSave={() => save(() => onSave({ kind, ...form }))}
    >
      <div className="grid grid-cols-2 gap-2">
        {FIELD_LABELS.filter(
          ([key]) => kind === "billing" || key !== "taxNumber",
        ).map(([key, label]) => (
          <label key={key} className="block text-xs text-pilot-grey-500">
            {label}
            <PilotInput
              aria-label={label}
              value={String(form[key] ?? "")}
              onChange={(value) =>
                setForm((current) => ({ ...current, [key]: value }))
              }
              className="mt-1"
            />
          </label>
        ))}
      </div>
      {kind === "billing" ? (
        <p className="text-xs text-pilot-grey-500">
          A számla az OS-partner adataival készül: ha a partner régi címmel áll,
          a kiállítás megnevezi az eltérést.
        </p>
      ) : null}
    </Shell>
  );
}

/**
 * EGY MEGJEGYZÉS SZERKESZTÉSE: a belső (csak OS), a vevőé és a szállítónak
 * szóló (commerce #493). A határ a mező saját határa: a szállítónak szóló
 * üzenet 50 karakter, mert a Foxpost mezője ekkora.
 */
export function NoteDialog({
  initial,
  onClose,
  onSave,
  title = "Belső megjegyzés",
  maxLength = 2000,
  hint = "Csak az OS-ben látszik, a vevő nem kapja meg. Üresen mentve törlődik.",
}: {
  initial: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
  title?: string;
  maxLength?: number;
  hint?: string;
}) {
  const [text, setText] = useState(initial);
  const { busy, error, save } = useSave(onClose);
  const tooLong = Array.from(text).length > maxLength;
  return (
    <Shell
      title={title}
      busy={busy}
      error={error}
      onClose={onClose}
      saveDisabled={tooLong}
      onSave={() => save(() => onSave(text))}
    >
      <textarea
        aria-label={title}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={maxLength <= 100 ? 2 : 5}
        className="w-full rounded-lg border border-pilot-grey-200 p-2 text-sm"
      />
      <p
        className={`text-xs ${tooLong ? "text-pilot-red-700" : "text-pilot-grey-500"}`}
      >
        {Array.from(text).length} / {maxLength} karakter. {hint}
      </p>
    </Shell>
  );
}

/**
 * A CSOMAGPONT KERESŐ: a webshop listája (a pénztáré), az üzemen kívüli
 * automata nem választható. A pont cseréje és a szállítási mód cseréje is
 * ezt használja; a lista forrása a hívóé.
 */
function PointPicker({
  currentPointId,
  search,
  chosen,
  onChoose,
  hint,
}: {
  currentPointId: string | null;
  search: (query: string) => Promise<WebshopPickupPointSearch>;
  chosen: string | null;
  onChoose: (pointId: string | null) => void;
  hint: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WebshopPickupPointSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const current = result?.currentPointId ?? currentPointId;

  const find = () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    void search(query.trim())
      .then((found) => {
        setResult(found);
        onChoose(null);
      })
      .catch((cause: unknown) =>
        setSearchError(
          cause instanceof Error ? cause.message : "A keresés nem sikerült.",
        ),
      )
      .finally(() => setSearching(false));
  };

  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        <PilotInput
          aria-label="Csomagpont keresése"
          placeholder="Város, irányítószám vagy név"
          value={query}
          onChange={setQuery}
        />
        <PilotButton
          type="submit"
          size="regular"
          variant="secondary"
          disabled={searching || !query.trim()}
        >
          {searching ? "Keresés…" : "Keresés"}
        </PilotButton>
      </form>
      {searchError ? (
        <p
          role="alert"
          className="rounded-lg bg-pilot-red-50 p-3 text-sm text-pilot-red-700"
        >
          {searchError}
        </p>
      ) : null}
      {result ? (
        result.points.length ? (
          <div
            role="radiogroup"
            aria-label="Választható csomagpontok"
            className="max-h-72 space-y-1 overflow-y-auto"
          >
            {result.points.map((point) => (
              <label
                key={point.id}
                className={`flex gap-2 rounded-lg border p-2 text-sm ${
                  point.outOfOrder
                    ? "border-pilot-grey-100 text-pilot-grey-400"
                    : "border-pilot-grey-200"
                }`}
              >
                <input
                  type="radio"
                  name="pickup-point"
                  value={point.id}
                  disabled={point.outOfOrder}
                  checked={chosen === point.id}
                  onChange={() => onChoose(point.id)}
                />
                <span>
                  <span className="font-medium">{point.name}</span>
                  {point.id === current ? (
                    <span className="ml-2 text-xs text-pilot-grey-500">
                      (a mostani)
                    </span>
                  ) : null}
                  <span className="block text-xs text-pilot-grey-600">
                    {[
                      point.address,
                      point.variant ??
                        (point.kind === "parcel-locker"
                          ? "Automata"
                          : point.kind === "parcel-shop"
                            ? "Csomagpont"
                            : null),
                      point.outOfOrder ? "üzemen kívül" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            ))}
            {result.count > result.points.length ? (
              <p className="text-xs text-pilot-grey-500">
                {result.count} találatból az első {result.points.length}:
                szűkítsd a keresést.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-pilot-grey-500">Nincs találat.</p>
        )
      ) : (
        <p className="text-xs text-pilot-grey-500">{hint}</p>
      )}
    </>
  );
}

/**
 * A CSOMAGPONT CSERÉJE (commerce #494). A lista a rendelés saját módjához
 * tartozik (a webshop dönti el a fuvarozót és a GLS nehézáru-szabályát), a
 * keresés a pénztáré. Az üzemen kívüli automata nem választható.
 */
export function PointDialog({
  currentPointId,
  search,
  onClose,
  onSave,
}: {
  currentPointId: string | null;
  search: (query: string) => Promise<WebshopPickupPointSearch>;
  onClose: () => void;
  onSave: (pointId: string) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const { busy, error, save } = useSave(onClose);
  return (
    <Shell
      title="Csomagpont cseréje"
      busy={busy}
      error={error}
      onClose={onClose}
      saveDisabled={!chosen || chosen === currentPointId}
      onSave={() => {
        if (chosen) save(() => onSave(chosen));
      }}
    >
      <PointPicker
        currentPointId={currentPointId}
        search={search}
        chosen={chosen}
        onChoose={setChosen}
        hint="A lista ugyanaz, mint a pénztárban, ehhez a szállítási módhoz."
      />
    </Shell>
  );
}

/**
 * A SZÁLLÍTÁSI MÓD CSERÉJE (kártya 0a14f739 C/2): a webshop futáros módjai az
 * új díjjal (a pénztár számítása), csomagpontos módnál a cél mód pontjai. A
 * mód és a pont egy lépésben cserél. Drágulásnál a vevő fizetési linket kap a
 * különbözetről (Balázs), csökkenésnél nincs új fizetés.
 */
export function MethodDialog({
  currentPointId,
  loadOptions,
  searchPoints,
  onClose,
  onSave,
}: {
  currentPointId: string | null;
  loadOptions: () => Promise<WebshopShippingOptions>;
  searchPoints: (
    optionId: string,
    query: string,
  ) => Promise<WebshopPickupPointSearch>;
  onClose: () => void;
  onSave: (input: WebshopOrderMethodInput) => Promise<void>;
}) {
  const [options, setOptions] = useState<WebshopShippingOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const { busy, error, save } = useSave(onClose);

  useEffect(() => {
    let alive = true;
    loadOptions()
      .then((loaded) => {
        if (alive) setOptions(loaded);
      })
      .catch((cause: unknown) => {
        if (alive)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "A szállítási módok listája nem érhető el.",
          );
      });
    return () => {
      alive = false;
    };
  }, [loadOptions]);

  const current = options?.options.find(
    (option) => option.id === options.currentOptionId,
  );
  const chosen = options?.options.find((option) => option.id === optionId);
  const difference = chosen && current ? chosen.amount - current.amount : null;
  const unchanged =
    !chosen ||
    (chosen.id === options?.currentOptionId &&
      (!chosen.needsPoint || !pointId || pointId === currentPointId));

  return (
    <Shell
      title="Szállítási mód cseréje"
      busy={busy}
      error={error ?? loadError}
      onClose={onClose}
      saveDisabled={unchanged || (!!chosen?.needsPoint && !pointId)}
      onSave={() => {
        if (chosen)
          save(() =>
            onSave({
              optionId: chosen.id,
              ...(chosen.needsPoint && pointId ? { pointId } : {}),
            }),
          );
      }}
    >
      {options ? (
        <div
          role="radiogroup"
          aria-label="Választható szállítási módok"
          className="space-y-1"
        >
          {options.options.map((option) => (
            <label
              key={option.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-pilot-grey-200 p-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="shipping-option"
                  value={option.id}
                  checked={optionId === option.id}
                  onChange={() => {
                    setOptionId(option.id);
                    setPointId(null);
                  }}
                />
                <span>
                  {option.name}
                  {option.id === options.currentOptionId ? (
                    <span className="ml-2 text-xs text-pilot-grey-500">
                      (a mostani)
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="text-pilot-grey-700">
                {formatMoney(option.amount, "HUF")}
              </span>
            </label>
          ))}
        </div>
      ) : loadError ? null : (
        <p className="text-sm text-pilot-grey-500">A módok betöltése…</p>
      )}
      {chosen?.needsPoint ? (
        <PointPicker
          key={chosen.id}
          currentPointId={
            chosen.id === options?.currentOptionId ? currentPointId : null
          }
          search={(query) => searchPoints(chosen.id, query)}
          chosen={pointId}
          onChoose={setPointId}
          hint="Ehhez a módhoz csomagpont kell: keresd ki a listából."
        />
      ) : null}
      {difference !== null && difference !== 0 ? (
        <p className="text-xs text-pilot-grey-600">
          {difference > 0
            ? `A szállítási díj ${formatMoney(difference, "HUF")} összeggel nő. Kártyás fizetésnél a vevő fizetési linket kap a különbözetről, és a csomag a fizetés után adható fel.`
            : `A szállítási díj ${formatMoney(-difference, "HUF")} összeggel csökken. Új fizetés nem kell: a levonás a kisebb összeget veszi.`}
        </p>
      ) : null}
    </Shell>
  );
}
