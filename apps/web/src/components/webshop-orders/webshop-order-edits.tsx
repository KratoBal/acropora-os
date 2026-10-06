"use client";
import { Icon } from "@acropora/ui";
import type { WebshopOrderAddressInput } from "@acropora/types";
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

export function NoteDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const { busy, error, save } = useSave(onClose);
  return (
    <Shell
      title="Belső megjegyzés"
      busy={busy}
      error={error}
      onClose={onClose}
      saveDisabled={text.length > 2000}
      onSave={() => save(() => onSave(text))}
    >
      <textarea
        aria-label="Belső megjegyzés"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        className="w-full rounded-lg border border-pilot-grey-200 p-2 text-sm"
      />
      <p className="text-xs text-pilot-grey-500">
        Csak az OS-ben látszik, a vevő nem kapja meg. Üresen mentve törlődik.
      </p>
    </Shell>
  );
}
