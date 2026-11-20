"use client";

import { Alert } from "@acropora/ui";
import type {
  AcceptWithRuleResult,
  AutoAcceptedView,
  InvoiceCollectionSuggestion,
  SupplierRuleKind,
  SupplierRulePreview,
  SupplierRuleView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { PilotButton, PilotInput } from "@/components/pilot/pilot-ui";
import { missingInvoicesApi } from "@/lib/api/missing-invoices";
import { formatAmount, formatDay } from "./missing-invoices-model";

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Centből a lapon látszó összeg (`4950` + EUR -> 49,50 EUR). */
const centsText = (cents: number, currency: string) =>
  formatAmount((cents / 100).toFixed(2), currency);

/**
 * ELFOGADÁS ÉS ISMERT SZÁLLÍTÓ SZABÁLY (acrobot 57881, 57884). Az ember elfogadja a PDF-et, és a szállítóból szabály lesz: a
 * szállító következő PDF-jét a begyűjtés magától elfogadja. A kulcs az adószám (ha olvasható), vagy a szállító neve a PDF-en
 * (a szerver ellenőrzi, hogy szerepel benne). Ha ugyanattól a külső feladótól a függő PDF-ek KÜLÖNBÖZŐ adószámot hordoznak, a lap
 * névszabályt javasol (olvasó-hiba: a GLS számlaszáma adószámnak látszott). A többi, a szabály alá eső függő PDF-et is
 * elfogadhatja, az ember megerősítésével.
 */
export function SupplierRulePanel({
  token,
  item,
  onAccepted,
  onClose,
}: {
  token: string;
  item: InvoiceCollectionSuggestion;
  onAccepted: (result: AcceptWithRuleResult) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<SupplierRulePreview | null>(null);
  const [kind, setKind] = useState<SupplierRuleKind | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [alsoPending, setAlsoPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (name?: string) => {
      try {
        const next = await missingInvoicesApi.supplierRulePreview(
          token,
          item.documentId,
          name,
        );
        setPreview(next);
        setError(null);
        setKind(
          (current) =>
            current ?? (next.taxKey && !next.taxLooksUnstable ? "TAX" : "NAME"),
        );
      } catch (cause) {
        setError(errorText(cause, "Az előnézet nem tölthető be."));
      }
    },
    [token, item.documentId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // a beírt névre a lap újraszámolja, hány függő PDF viszi a névszabály (rövid késleltetéssel, hogy ne minden betűnél kérdezzen)
  useEffect(() => {
    if (kind !== "NAME" || vendorName.trim() === "") return;
    const timer = setTimeout(() => void load(vendorName), 400);
    return () => clearTimeout(timer);
  }, [kind, vendorName, load]);

  const submit = async () => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      onAccepted(
        await missingInvoicesApi.acceptWithRule(token, item.documentId, {
          kind,
          alsoPending,
          ...(kind === "NAME" || vendorName.trim()
            ? { vendorName: vendorName.trim() }
            : {}),
        }),
      );
    } catch (cause) {
      setError(errorText(cause, "A szabály létrehozása nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const count = preview && kind ? preview.pendingCount[kind] : 0;
  const nameMissing = kind === "NAME" && vendorName.trim() === "";

  return (
    <section
      aria-label="Elfogadás és szállítói szabály"
      className="space-y-3 rounded-xl bg-pilot-grey-50 p-4 ring-1 ring-pilot-grey-200"
    >
      <p className="text-sm font-semibold text-pilot-grey-900">
        Elfogadás és szállítói szabály: {item.fileName}
      </p>
      <p className="text-xs text-pilot-grey-600">
        Ettől a szállítótól a következő PDF-et a rendszer magától elfogadja, ha
        a feladó, a szállító azonosítója és az összeg illik. Háromszoros
        összegnél nagyobb tételnél, új pénznemnél és olvashatatlan összegnél a
        PDF emberre vár. Az automatikus elfogadás naplózott és visszavonható, a
        szabály egy gombbal kikapcsolható.
      </p>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {preview === null ? (
        error ? null : (
          <p role="status" className="text-sm text-pilot-grey-500">
            Előnézet betöltése…
          </p>
        )
      ) : (
        <>
          {preview.taxLooksUnstable ? (
            <Alert
              variant="info"
              title="Valószínűleg olvasó-hiba az adószámnál"
              description="Ugyanettől a feladótól a függő PDF-eken különböző adószámok állnak (például egy számlaszám adószámnak látszik). Név alapú szabályt javaslok."
            />
          ) : null}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-pilot-grey-800">
              A szabály kulcsa
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="rule-kind"
                checked={kind === "TAX"}
                disabled={!preview.taxKey}
                onChange={() => setKind("TAX")}
              />
              <span>
                {preview.taxKey
                  ? `Adószám: ${preview.taxKey}`
                  : "Adószám (ebben a PDF-ben nincs olvasható)"}
                <span className="block text-xs text-pilot-grey-500">
                  {preview.externalSender
                    ? `és a feladó tartománya: ${preview.senderDomain}`
                    : "saját továbbítótól érkezett: a feladó nem kulcs"}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="rule-kind"
                checked={kind === "NAME"}
                disabled={!preview.externalSender}
                onChange={() => setKind("NAME")}
              />
              <span>
                A szállító neve a PDF-en
                <span className="block text-xs text-pilot-grey-500">
                  {preview.externalSender
                    ? `a feladó tartományával együtt (${preview.senderDomain}); a szerver ellenőrzi, hogy a név szerepel a PDF-ben`
                    : "csak külső feladóval él (saját továbbítótól érkezett PDF-hez adószám kell)"}
                </span>
              </span>
            </label>
          </fieldset>
          {kind === "NAME" ? (
            <div className="max-w-sm">
              <PilotInput
                aria-label="A szállító neve a számlán"
                placeholder="A szállító neve, ahogy a PDF-en áll (pl. GLS)"
                value={vendorName}
                onChange={setVendorName}
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alsoPending}
              disabled={count === 0}
              onChange={(event) => setAlsoPending(event.target.checked)}
            />
            <span>
              A többi, a szabály alá eső függő PDF-et is elfogadom ({count} db)
            </span>
          </label>
        </>
      )}
      <div className="flex gap-2">
        <PilotButton
          size="action"
          disabled={busy || preview === null || kind === null || nameMissing}
          onClick={() => void submit()}
        >
          {busy ? "Mentés…" : "Elfogad és szabályt hoz létre"}
        </PilotButton>
        <PilotButton size="action" variant="secondary" onClick={onClose}>
          Mégsem
        </PilotButton>
      </div>
    </section>
  );
}

/**
 * A SZÁLLÍTÓI SZABÁLYOK ÉS AZ AUTOMATIKUSAN ELFOGADOTT PDF-EK (utolsó 14 nap) a Javasolt számlák lapján: a szabály egy gombbal
 * kikapcsolható, az automatikus elfogadás visszavonható (ha közben nem párosult vagy nem csatolták).
 */
export function SupplierRulesSection({
  token,
  canManage,
  reloadKey,
  onChanged,
}: {
  token: string;
  canManage: boolean;
  /** nő, ha a lapon szabály jött létre: a lista újratölt */
  reloadKey: number;
  /** egy visszavonás után a függő lista is újratölt */
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<SupplierRuleView[] | null>(null);
  const [auto, setAuto] = useState<AutoAcceptedView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextRules, nextAuto] = await Promise.all([
        missingInvoicesApi.supplierRules(token),
        missingInvoicesApi.autoAccepted(token),
      ]);
      setRules(nextRules);
      setAuto(nextAuto);
      setError(null);
    } catch (cause) {
      setError(errorText(cause, "A szabályok nem tölthetők be."));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const disable = async (rule: SupplierRuleView) => {
    setBusy(rule.id);
    setNotice(null);
    try {
      await missingInvoicesApi.disableSupplierRule(token, rule.id);
      await load();
    } catch (cause) {
      setError(errorText(cause, "A szabály kikapcsolása nem sikerült."));
    } finally {
      setBusy(null);
    }
  };

  const undo = async (row: AutoAcceptedView) => {
    setBusy(row.documentId);
    setNotice(null);
    try {
      const result = await missingInvoicesApi.undoAutoAccepted(
        token,
        row.documentId,
      );
      setNotice(
        result === "IN_USE"
          ? "Közben párosult vagy csatolták ezt a PDF-et: előbb azt kell visszavonni, a PDF elfogadva marad."
          : `${row.fileName}: visszavonva, újra döntésre vár.`,
      );
      await load();
      if (result === "UNDONE") onChanged();
    } catch (cause) {
      setError(errorText(cause, "A visszavonás nem sikerült."));
    } finally {
      setBusy(null);
    }
  };

  const active = (rules ?? []).filter((rule) => rule.disabledAt === null);
  if (rules === null && error === null) return null;
  if (error === null && active.length === 0 && (auto ?? []).length === 0)
    return null;

  return (
    <section aria-label="Szállítói szabályok" className="space-y-4">
      <h2 className="text-base font-semibold text-pilot-grey-900">
        Ismert szállítók
      </h2>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {notice ? (
        <Alert variant="info" title="Visszavonás" description={notice} />
      ) : null}
      {active.length > 0 ? (
        <ul
          aria-label="Aktív szállítói szabályok"
          className="divide-y divide-pilot-grey-200 rounded-xl ring-1 ring-pilot-grey-200"
        >
          {active.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-pilot-grey-900">
                  {rule.label}
                </span>
                <span className="truncate text-xs text-pilot-grey-500">
                  {[
                    rule.kind === "TAX"
                      ? `adószám ${rule.key}`
                      : `név ${rule.key}`,
                    rule.senderDomain
                      ? `feladó ${rule.senderDomain}`
                      : "saját továbbítótól is",
                    `${rule.acceptedCount} automatikus elfogadás`,
                    Object.entries(rule.grossCeilings)
                      .map(
                        ([currency, cents]) =>
                          `legnagyobb ${centsText(cents, currency)}`,
                      )
                      .join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {canManage ? (
                <PilotButton
                  size="action"
                  variant="secondary"
                  disabled={busy !== null}
                  aria-label={`${rule.label} szabály kikapcsolása`}
                  onClick={() => void disable(rule)}
                >
                  Kikapcsol
                </PilotButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {auto && auto.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-pilot-grey-800">
            Automatikusan elfogadva (utolsó 14 nap)
          </h3>
          <ul
            aria-label="Automatikusan elfogadott PDF-ek"
            className="divide-y divide-pilot-grey-200 rounded-xl ring-1 ring-pilot-grey-200"
          >
            {auto.map((row) => (
              <li
                key={row.documentId}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-pilot-grey-900">
                    {row.fileName}
                  </span>
                  <span className="truncate text-xs text-pilot-grey-500">
                    {[
                      row.sender,
                      row.invoiceNumber,
                      row.gross && row.currency
                        ? formatAmount(row.gross, row.currency)
                        : "összeg nélkül",
                      formatDay(row.acceptedAt.slice(0, 10)),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {canManage ? (
                  <PilotButton
                    size="action"
                    variant="secondary"
                    disabled={busy !== null}
                    aria-label={`${row.fileName} visszavonása`}
                    onClick={() => void undo(row)}
                  >
                    Visszavon
                  </PilotButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
