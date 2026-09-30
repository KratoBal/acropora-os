"use client";

import { PilotButton, PilotDrawer } from "@acropora/ui";
import { useRef, useState } from "react";

import {
  CHARGE_STATE_LABELS,
  INVOICE_SOURCE_LABELS,
  formatAmount,
  formatDay,
  whatToDo,
  type CandidateInvoice,
  type ChargeRow,
} from "./missing-invoices-model";

/**
 * EGY TERHELÉS RÉSZLETEI (Figma 343:435, brief 11-12. pont).
 *
 * A PÁROSÍTÁS KIFEJEZETT FELHASZNÁLÓI LÉPÉS: jelöltenként egy gomb, és a
 * felület soha nem párosít magától, akármilyen valószínű a jelölt.
 *
 * A FIGMA-KERETBEN a Partner értéke és a Közlemény egymásra csúszik; ez a keret
 * hibája, nem terv (acrobot 25261), ezért itt két külön sor.
 *
 * A DRIVE-LINK CSAK VALÓDI CÍMMEL látszik (a szerver adja, a konfigurációból):
 * a brief szerint fiktív link nem lehet.
 */
export function MissingInvoicesDrawer({
  row,
  onClose,
  companyName,
  candidates,
  onPair,
  pairingId,
  driveUrl,
  onUpload,
  uploading,
  note,
  onNote,
  onSave,
  saving,
  error,
  canManage,
}: {
  row: ChargeRow | null;
  onClose: () => void;
  companyName: string;
  /** `null`: töltés. */
  candidates: CandidateInvoice[] | null;
  onPair: (candidate: CandidateInvoice) => void;
  /** A jelölt, amelyiknek a párosítása épp fut. */
  pairingId: string | null;
  driveUrl: string | null;
  onUpload: (file: File) => void;
  uploading: boolean;
  note: string;
  onNote: (note: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  /** Párosítás, feltöltés, megjegyzés (`finance.manage`). */
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setFileError("Csak PDF tölthető fel.");
      return;
    }
    setFileError(null);
    onUpload(file);
  };

  const amountLine = row
    ? [
        formatAmount(row.amountHuf, "HUF"),
        ...(row.original
          ? [formatAmount(row.original.amount, row.original.currency)]
          : []),
      ].join(" · ")
    : "";
  const todo = row ? whatToDo(row.state, companyName) : null;

  return (
    <PilotDrawer
      open={row !== null}
      onClose={onClose}
      width="xl"
      title={row?.partner ?? ""}
      subtitle={row ? `${formatDay(row.date)} · ${amountLine}` : undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <PilotButton variant="secondary" size="regular" onClick={onClose}>
            Bezárás
          </PilotButton>
          {canManage ? (
            <PilotButton
              variant="primary"
              size="regular"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? "Mentés…" : "Mentés"}
            </PilotButton>
          ) : null}
        </div>
      }
    >
      {row ? (
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="rounded-xl bg-pilot-grey-100 px-4 py-4 text-sm">
            <h3 className="font-semibold text-pilot-grey-900">
              Banki terhelés
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <dt className="text-xs text-pilot-grey-500">Dátum</dt>
                <dd className="text-pilot-grey-900">{formatDay(row.date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-pilot-grey-500">Összeg</dt>
                <dd className="text-pilot-grey-900">{amountLine}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-pilot-grey-500">Partner</dt>
                <dd className="break-words text-pilot-grey-900">
                  {row.partner}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-pilot-grey-500">Közlemény</dt>
                <dd className="break-words text-pilot-grey-900">
                  {row.narrative || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-pilot-grey-500">Bankszámla</dt>
                <dd className="text-pilot-grey-900">{row.bankAccount}</dd>
              </div>
              <div>
                <dt className="text-xs text-pilot-grey-500">Állapot</dt>
                <dd className="text-pilot-grey-900">
                  {CHARGE_STATE_LABELS[row.state]}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-pilot-grey-900">
              Javasolt számlák
            </h3>
            <p className="mt-1 text-xs text-pilot-grey-500">
              Azonos szállítóhoz talált lehetséges bizonylatok.
            </p>
            {candidates === null ? (
              <p role="status" className="mt-3 text-sm text-pilot-grey-500">
                A jelöltek betöltése…
              </p>
            ) : candidates.length === 0 ? (
              <p className="mt-3 text-sm text-pilot-grey-500">
                Ehhez a partnerhez nincs jelölt számla.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-pilot-grey-200"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 text-sm">
                      <span className="truncate font-semibold text-pilot-grey-900">
                        {candidate.number}
                      </span>
                      <span className="whitespace-nowrap text-xs text-pilot-grey-600">
                        {formatDay(candidate.date)}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900">
                        {formatAmount(
                          candidate.grossAmount,
                          candidate.currency,
                        )}
                      </span>
                      <span className="text-xs text-pilot-grey-500">
                        {INVOICE_SOURCE_LABELS[candidate.source]}
                      </span>
                    </div>
                    {canManage ? (
                      <PilotButton
                        variant="secondary"
                        size="action"
                        disabled={pairingId !== null}
                        onClick={() => onPair(candidate)}
                      >
                        {pairingId === candidate.id
                          ? "Párosítás…"
                          : "Párosítás"}
                      </PilotButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {todo ? (
            <section
              aria-label="Mit kell tenni"
              className="rounded-xl bg-pilot-red-50 px-4 py-4 text-sm ring-1 ring-pilot-red-100"
            >
              <h3 className="font-semibold text-pilot-red-700">
                Mit kell tenni
              </h3>
              <p className="mt-1 text-pilot-red-700">{todo}</p>
            </section>
          ) : null}

          {canManage ? (
            <section>
              <h3 className="text-sm font-semibold text-pilot-grey-900">
                Számla feltöltése
              </h3>
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  takeFile(event.dataTransfer.files[0]);
                }}
                className={`mt-3 flex min-h-24 cursor-pointer items-center justify-center rounded-xl px-4 py-6 text-center text-sm text-pilot-grey-600 ring-1 ${
                  dragging
                    ? "bg-pilot-aqua-50 ring-pilot-aqua-600"
                    : "bg-pilot-grey-100 ring-pilot-grey-200"
                }`}
              >
                {uploading
                  ? "Feltöltés…"
                  : "Húzd ide a PDF-et, vagy kattints a tallózáshoz"}
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Számla PDF"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    takeFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {fileError ? (
                <p role="alert" className="mt-2 text-xs text-pilot-red-700">
                  {fileError}
                </p>
              ) : null}
            </section>
          ) : null}

          {driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm font-medium text-pilot-aqua-700 hover:underline"
            >
              Drive mappa megnyitása →
            </a>
          ) : null}

          <section>
            <label
              htmlFor="missing-invoice-note"
              className="text-sm font-semibold text-pilot-grey-900"
            >
              Megjegyzés
            </label>
            <textarea
              id="missing-invoice-note"
              value={note}
              onChange={(event) => onNote(event.target.value)}
              readOnly={!canManage}
              placeholder="Belső megjegyzés ehhez a terheléshez…"
              rows={5}
              className="mt-3 w-full rounded-xl bg-white px-4 py-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-600"
            />
          </section>

          {error ? (
            <p role="alert" className="text-sm text-pilot-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </PilotDrawer>
  );
}
