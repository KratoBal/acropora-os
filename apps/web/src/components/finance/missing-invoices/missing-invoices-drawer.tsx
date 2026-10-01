"use client";

import {
  PilotBadge,
  PilotButton,
  PilotDrawer,
  PilotSelect,
} from "@acropora/ui";
import type { MissingInvoicePayeeDocument } from "@acropora/types";
import { useState } from "react";

import {
  CATEGORY_LABELS,
  CHARGE_STATE_LABELS,
  INVOICE_SOURCE_LABELS,
  formatAmount,
  formatDay,
  whatToDo,
  type CandidateInvoice,
  type ChargeCategory,
  type ChargeRow,
  type ItemAction,
} from "./missing-invoices-model";

export type UploadKind = "INVOICE" | "PREMIUM_NOTICE";

/** A drawer második kérésből jövő része (`GET /missing-invoices/items/:id`). */
export interface ChargeDetailExtras {
  candidates: CandidateInvoice[];
  /** A párosított számlák közül a kézzel jelölhető vevőjűek (acrobot 25633). */
  payeeDocuments: MissingInvoicePayeeDocument[];
  /** A többi terhelés ugyanezzel a számlával (Kétszer fizetett számla). */
  doublePaidWith: {
    id: string;
    bookingDate: string;
    amount: string;
    currency: string;
  }[];
  action: ItemAction;
  /** A „Hiányzó számlák” Drive-mappa, ha a szerveren be van állítva. */
  driveFolderUrl: string | null;
}

/**
 * EGY TERHELÉS RÉSZLETEI (Figma 343:435, brief 11-12. pont; a szerződés
 * nautilusé: agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md).
 *
 * A PÁROSÍTÁS KIFEJEZETT FELHASZNÁLÓI LÉPÉS: jelöltenként egy gomb, és a
 * felület soha nem párosít magától, akármilyen valószínű a jelölt. A KÉZI
 * párosítás visszavonható; a szabály szerinti nem (azt a szabály adja).
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
  extras,
  onPair,
  onUnpair,
  onCategory,
  busy,
  onUpload,
  onPaperOriginal,
  onPayee,
  note,
  onNote,
  onSave,
  saving,
  error,
  canManage,
}: {
  row: ChargeRow | null;
  onClose: () => void;
  /** A szerver konfigurációjából; `null`, amíg a szerződés nem adja. */
  companyName: string | null;
  /** `null`: töltés. */
  extras: ChargeDetailExtras | null;
  onPair: (candidate: CandidateInvoice) => void;
  onUnpair: () => void;
  /** `null`: vissza az automatikus besorolásra. */
  onCategory: (category: ChargeCategory | null) => void;
  /** A futó módosítás: `pair:<dokumentum>`, `unpair`, `category`, `upload`. */
  busy: string | null;
  /**
   * A számla feltöltése; ha nincs megadva, a rész nem jelenik meg (a
   * feltöltés végpontja nautilus 4b szeletével jön).
   */
  onUpload?: (file: File, kind: UploadKind) => void;
  /**
   * AZ EREDETI PAPÍRON MEGVAN (nautilus #1303, `PUT …/paper-original`): az
   * Eredeti hiányzik így Megvan lesz. Csak párosított számlánál kérdés.
   */
  onPaperOriginal?: (marked: boolean) => void;
  /**
   * A VEVŐ KÉZI JELÖLÉSE (acrobot 25633, `PUT …/documents/:id/payee`): a
   * beszkennelt számla vevője nem olvasható, a kezelő mondja meg.
   */
  onPayee?: (documentId: string, payee: "COMPANY" | "NOT_COMPANY") => void;
  note: string;
  onNote: (note: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  /** Párosítás, átsorolás, feltöltés, megjegyzés (`finance.manage`). */
  canManage: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [kind, setKind] = useState<UploadKind>("INVOICE");

  const takeFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setFileError("Csak PDF tölthető fel.");
      return;
    }
    setFileError(null);
    onUpload?.(file, kind);
  };

  const amountLine = row
    ? [
        formatAmount(row.amount, row.currency),
        ...(row.original
          ? [formatAmount(row.original.amount, row.original.currency)]
          : []),
      ].join(" · ")
    : "";
  const todo = extras ? whatToDo(extras.action, companyName) : null;
  const title = row ? (row.partner ?? "Ismeretlen partner") : "";

  return (
    <PilotDrawer
      open={row !== null}
      onClose={onClose}
      width="xl"
      title={title}
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
                  {row.partner ?? "—"}
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
                <dd className="text-pilot-grey-900">{row.account.name}</dd>
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
            <label
              htmlFor="missing-invoice-category"
              className="text-sm font-semibold text-pilot-grey-900"
            >
              Kategória
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="w-60">
                <PilotSelect
                  id="missing-invoice-category"
                  value={row.categoryOverridden ? row.category : ""}
                  disabled={!canManage || busy !== null}
                  onChange={(value) =>
                    onCategory(value === "" ? null : (value as ChargeCategory))
                  }
                >
                  <option value="">
                    Automatikus: {CATEGORY_LABELS[row.category]}
                  </option>
                  {(Object.keys(CATEGORY_LABELS) as ChargeCategory[]).map(
                    (category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </option>
                    ),
                  )}
                </PilotSelect>
              </div>
              {row.categoryOverridden ? (
                <PilotBadge variant="blue">Kézzel átsorolva</PilotBadge>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-pilot-grey-500">
              {row.categoryRule}
            </p>
          </section>

          {row.document ? (
            <section className="rounded-xl px-4 py-3 text-sm ring-1 ring-pilot-grey-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-pilot-grey-500">
                    Párosított számla
                    {row.matchedBy === "MANUAL" ? " (kézi)" : ""}
                  </p>
                  <p className="font-semibold text-pilot-grey-900">
                    {row.document.number}{" "}
                    <span className="font-normal text-pilot-grey-500">
                      · {INVOICE_SOURCE_LABELS[row.document.source]}
                    </span>
                  </p>
                  {row.documentNumbers.length > 1 ? (
                    <p className="mt-1 text-xs text-pilot-grey-600">
                      Mind a {row.documentNumbers.length} számla:{" "}
                      {row.documentNumbers.join(", ")}
                    </p>
                  ) : null}
                </div>
                {canManage && row.matchedBy === "MANUAL" ? (
                  <PilotButton
                    variant="secondary"
                    size="action"
                    disabled={busy !== null}
                    onClick={onUnpair}
                  >
                    {busy === "unpair"
                      ? "Visszavonás…"
                      : "Párosítás visszavonása"}
                  </PilotButton>
                ) : null}

                {row.document &&
                onPaperOriginal &&
                (row.state === "ORIGINAL_MISSING" || row.paperOriginal) ? (
                  <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
                    <input
                      type="checkbox"
                      checked={row.paperOriginal}
                      disabled={!canManage || busy !== null}
                      onChange={(event) =>
                        onPaperOriginal(event.target.checked)
                      }
                    />
                    Az eredeti papíron megvan
                    {busy === "paper" ? (
                      <span className="text-xs text-pilot-grey-500">
                        Mentés…
                      </span>
                    ) : null}
                  </label>
                ) : null}
              </div>
              {extras && extras.doublePaidWith.length > 0 ? (
                <p className="mt-2 text-sm text-pilot-red-700">
                  Ugyanez a számla ehhez is párosítva:{" "}
                  {extras.doublePaidWith
                    .map(
                      (other) =>
                        `${formatDay(other.bookingDate)}, ${formatAmount(other.amount, other.currency)}`,
                    )
                    .join("; ")}
                </p>
              ) : null}
              {extras?.payeeDocuments.map((document) => (
                <div
                  key={document.documentId}
                  className="mt-3 flex flex-wrap items-center gap-3 border-t border-pilot-grey-100 pt-3"
                >
                  <p className="min-w-0 flex-1 text-sm text-pilot-grey-700">
                    {document.marked ? (
                      <>
                        {document.number}: kézzel jelölve,{" "}
                        <strong>
                          {document.payee === "COMPANY"
                            ? "a cégre szól"
                            : "nem a cégre szól"}
                        </strong>
                        .
                      </>
                    ) : (
                      <>
                        {document.number}: a vevő a számlából nem olvasható
                        (képként jött). Kinek szól?
                      </>
                    )}
                  </p>
                  {canManage && onPayee ? (
                    <div className="flex gap-2">
                      {document.payee !== "COMPANY" ? (
                        <PilotButton
                          variant="secondary"
                          size="action"
                          disabled={busy !== null}
                          onClick={() =>
                            onPayee(document.documentId, "COMPANY")
                          }
                        >
                          {busy === `payee:${document.documentId}`
                            ? "Mentés…"
                            : "A cégre szól"}
                        </PilotButton>
                      ) : null}
                      {document.payee !== "NOT_COMPANY" ? (
                        <PilotButton
                          variant="secondary"
                          size="action"
                          disabled={busy !== null}
                          onClick={() =>
                            onPayee(document.documentId, "NOT_COMPANY")
                          }
                        >
                          Nem a cégre szól
                        </PilotButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {row.missingNumbers.length > 0 ? (
                <p className="mt-2 text-sm text-pilot-red-700">
                  Hiányzik: {row.missingNumbers.join(", ")}
                </p>
              ) : null}
              {row.amountDifference ? (
                <p className="mt-1 text-sm text-pilot-grey-700">
                  Összeg-eltérés a számlákhoz képest:{" "}
                  {formatAmount(
                    row.amountDifference.amount,
                    row.amountDifference.currency,
                  )}
                </p>
              ) : null}
            </section>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-pilot-grey-900">
              Javasolt számlák
            </h3>
            <p className="mt-1 text-xs text-pilot-grey-500">
              Azonos szállítóhoz talált lehetséges bizonylatok.
            </p>
            {extras === null ? (
              <p role="status" className="mt-3 text-sm text-pilot-grey-500">
                A jelöltek betöltése…
              </p>
            ) : extras.candidates.length === 0 ? (
              <p className="mt-3 text-sm text-pilot-grey-500">
                Ehhez a partnerhez nincs jelölt számla.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {extras.candidates.map((candidate) => (
                  <li
                    key={candidate.documentId}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-pilot-grey-200"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 gap-y-1 text-sm">
                      <span className="truncate font-semibold text-pilot-grey-900">
                        {candidate.number}
                      </span>
                      <span className="whitespace-nowrap text-xs text-pilot-grey-600">
                        {formatDay(candidate.date)}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900">
                        {candidate.gross === null
                          ? "—"
                          : formatAmount(candidate.gross, candidate.currency)}
                      </span>
                      <span className="text-xs text-pilot-grey-500">
                        {INVOICE_SOURCE_LABELS[candidate.source]}
                      </span>
                      {candidate.payee === "NOT_COMPANY" ? (
                        <span className="col-span-2">
                          <PilotBadge variant="danger">
                            Nem a cégre szól
                          </PilotBadge>
                        </span>
                      ) : null}
                      {candidate.hasOriginal ? null : (
                        <span className="col-span-2 text-xs text-pilot-amber-700">
                          Csak NAV-adat, eredeti nincs a rendszerben
                        </span>
                      )}
                      {candidate.payee === "UNKNOWN" ? (
                        <span className="col-span-2 text-xs text-pilot-grey-500">
                          A vevő nem ellenőrizhető
                        </span>
                      ) : null}
                    </div>
                    {canManage ? (
                      <PilotButton
                        variant="secondary"
                        size="action"
                        disabled={busy !== null}
                        onClick={() => onPair(candidate)}
                      >
                        {busy === `pair:${candidate.documentId}`
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

          {canManage && onUpload ? (
            <section>
              <h3 className="text-sm font-semibold text-pilot-grey-900">
                Számla feltöltése
              </h3>
              <div
                role="radiogroup"
                aria-label="A feltöltött dokumentum"
                className="mt-2 flex gap-4 text-sm text-pilot-grey-700"
              >
                {(
                  [
                    ["INVOICE", "Számla"],
                    ["PREMIUM_NOTICE", "Díjértesítő"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="missing-invoice-upload-kind"
                      value={value}
                      checked={kind === value}
                      onChange={() => setKind(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
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
                {busy === "upload"
                  ? "Feltöltés…"
                  : "Húzd ide a PDF-et, vagy kattints a tallózáshoz"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Számla PDF"
                  className="sr-only"
                  disabled={busy !== null}
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

          {extras?.driveFolderUrl ? (
            <a
              href={extras.driveFolderUrl}
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
