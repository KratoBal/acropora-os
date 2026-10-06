"use client";
import { Icon } from "@acropora/ui";
import type {
  WebshopOrderAddressInput,
  WebshopPickupPointSearch,
} from "@acropora/types";
import { useState, type ReactNode } from "react";
import {
  PilotButton,
  PilotDialog,
  PilotInput,
} from "@/components/pilot/pilot-ui";

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
      className="rounded-md p-1 text-pilot-grey-500 hover:bg-pilot-grey-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name="pencil" size={14} />
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
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WebshopPickupPointSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const { busy, error, save } = useSave(onClose);
  const current = result?.currentPointId ?? currentPointId;

  const find = () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    void search(query.trim())
      .then((found) => {
        setResult(found);
        setChosen(null);
      })
      .catch((cause: unknown) =>
        setSearchError(
          cause instanceof Error ? cause.message : "A keresés nem sikerült.",
        ),
      )
      .finally(() => setSearching(false));
  };

  return (
    <Shell
      title="Csomagpont cseréje"
      busy={busy}
      error={error ?? searchError}
      onClose={onClose}
      saveDisabled={!chosen || chosen === current}
      onSave={() => {
        if (chosen) save(() => onSave(chosen));
      }}
    >
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
                  onChange={() => setChosen(point.id)}
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
        <p className="text-xs text-pilot-grey-500">
          A lista ugyanaz, mint a pénztárban, ehhez a szállítási módhoz.
        </p>
      )}
    </Shell>
  );
}
