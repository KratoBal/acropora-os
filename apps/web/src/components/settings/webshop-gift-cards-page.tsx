"use client";

import {
  ConfirmDialog,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotPageHeader,
  PilotThemeRoot,
} from "@acropora/ui";
import {
  hasPermission,
  parseWebshopGiftCardIssueInput,
  PERMISSIONS,
  WEBSHOP_GIFT_CARD_TRANSACTION_LABELS,
  type WebshopGiftCard,
  type WebshopGiftCardDetail,
  type WebshopGiftCardIssued,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { webshopGiftCardsApi } from "@/lib/api/webshop-gift-cards";

/**
 * A WEBSHOP AJÁNDÉKKÁRTYÁI (kártya 495c0007). Kiadás, lista, napló, kikapcsolás. A kód titok: a webshop csak az utolsó
 * négy jelét tartja, a teljes kódot EGYSZER mutatja, a kiadás után, itt. Lejárat nincs az első változatban (Balázs
 * nyitott kérdése). Csak a teszt OS-en látszik.
 */

const forint = (amount: number) =>
  `${new Intl.NumberFormat("hu-HU", { useGrouping: true }).format(amount).replace(/ /g, " ")} Ft`;

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function WebshopGiftCardsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
  );
  const [cards, setCards] = useState<WebshopGiftCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<WebshopGiftCardIssued | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<WebshopGiftCardDetail | null>(null);
  const [disabling, setDisabling] = useState<WebshopGiftCard | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError(null);
    try {
      setCards((await webshopGiftCardsApi.list(token)).giftCards);
    } catch (cause) {
      setError(message(cause, "Az ajándékkártyák nem tölthetők be."));
    }
  }, [canManage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    const parsed = parseWebshopGiftCardIssueInput({
      amount: amount.trim() === "" ? Number.NaN : Number(amount),
      recipientEmail,
      note,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      const answer = await webshopGiftCardsApi.issue(token, parsed.value);
      setIssued(answer);
      setCopied(false);
      setCards((current) => [answer.giftCard, ...(current ?? [])]);
      setAmount("");
      setRecipientEmail("");
      setNote("");
    } catch (cause) {
      setError(message(cause, "A kiadás nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const toggleLedger = async (card: WebshopGiftCard) => {
    if (open?.id === card.id) {
      setOpen(null);
      return;
    }
    setError(null);
    try {
      setOpen(await webshopGiftCardsApi.get(token, card.id));
    } catch (cause) {
      setError(message(cause, "A napló nem tölthető be."));
    }
  };

  const disable = async (card: WebshopGiftCard) => {
    setDisabling(null);
    setBusy(true);
    setError(null);
    try {
      const updated = await webshopGiftCardsApi.disable(token, card.id);
      setCards((current) =>
        (current ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
    } catch (cause) {
      setError(message(cause, "A kikapcsolás nem sikerült."));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <span className="text-xs text-pilot-red-700">{fieldErrors[key]}</span>
    ) : null;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Ajándékkártyák"
        description="Ajándékkártya kiadása a webshopba. A vevő a pénztárban váltja be; a kártya a termékárat, a szállítást és a díjakat is fizeti."
      />
      {!canManage ? (
        <p
          role="status"
          className="rounded-lg bg-pilot-blue-50 p-3 text-sm text-pilot-blue-700"
        >
          Nincs hozzáférésed az ajándékkártyákhoz
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

      {issued ? (
        <PilotCard
          className="space-y-3 border-pilot-blue-200 bg-pilot-blue-50 p-5"
          data-testid="issued-code"
        >
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Az új kártya kódja ({forint(issued.giftCard.initialAmount)})
          </h2>
          <p className="font-mono text-lg tracking-wider text-pilot-grey-900">
            {issued.code}
          </p>
          <p className="text-sm text-pilot-grey-700">
            A teljes kód csak most látszik: a webshop és az OS sem tárolja,
            később csak az utolsó négy jele látható.
          </p>
          <div className="flex items-center gap-3">
            <PilotButton variant="secondary" onClick={() => void copy()}>
              Kód másolása
            </PilotButton>
            {copied ? (
              <span className="text-sm text-pilot-grey-600">Kimásolva.</span>
            ) : null}
            <PilotButton variant="ghost" onClick={() => setIssued(null)}>
              Kész
            </PilotButton>
          </div>
        </PilotCard>
      ) : null}

      {canManage ? (
        <PilotCard className="space-y-4 p-5">
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Új ajándékkártya
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Összeg (Ft)
              <PilotInput
                type="number"
                min={1}
                aria-label="Az ajándékkártya összege"
                value={amount}
                onChange={(value) => setAmount(value)}
              />
              {fieldError("amount")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Címzett e-mail (nem kötelező)
              <PilotInput
                aria-label="A címzett e-mail-címe"
                value={recipientEmail}
                onChange={(value) => setRecipientEmail(value)}
              />
              {fieldError("recipientEmail")}
            </label>
            <label className="flex flex-col gap-1 text-sm text-pilot-grey-700">
              Megjegyzés (nem kötelező)
              <PilotInput
                aria-label="Megjegyzés"
                value={note}
                onChange={(value) => setNote(value)}
              />
              {fieldError("note")}
            </label>
          </div>
          <PilotButton disabled={busy} onClick={() => void issue()}>
            Kártya kiadása
          </PilotButton>
        </PilotCard>
      ) : null}

      {canManage && !cards && !error ? (
        <div
          aria-busy="true"
          className="h-48 animate-pulse rounded-xl bg-pilot-grey-100"
        />
      ) : null}
      {cards ? (
        <PilotCard className="space-y-3 p-5">
          {cards.length === 0 ? (
            <p className="text-sm text-pilot-grey-600">
              Még nincs ajándékkártya.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-pilot-grey-500">
                  <th className="py-2 pr-3 font-medium">Kód vége</th>
                  <th className="py-2 pr-3 font-medium">Kiadva</th>
                  <th className="py-2 pr-3 font-medium">Egyenleg</th>
                  <th className="py-2 pr-3 font-medium">Állapot</th>
                  <th className="py-2 pr-3 font-medium">Címzett</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.id} className="align-top">
                    <td className="py-2 pr-3 font-mono">…{card.codeLast4}</td>
                    <td className="py-2 pr-3">{forint(card.initialAmount)}</td>
                    <td className="py-2 pr-3">{forint(card.balance)}</td>
                    <td className="py-2 pr-3">
                      {card.status === "active" ? "Aktív" : "Kikapcsolva"}
                    </td>
                    <td className="py-2 pr-3">
                      {card.recipientEmail ?? "–"}
                      {card.note ? (
                        <div className="text-xs text-pilot-grey-500">
                          {card.note}
                        </div>
                      ) : null}
                      {open?.id === card.id ? (
                        <ul
                          className="mt-2 space-y-1 text-xs text-pilot-grey-600"
                          data-testid="gift-card-ledger"
                        >
                          {open.transactions.map((t) => (
                            <li key={t.id}>
                              {WEBSHOP_GIFT_CARD_TRANSACTION_LABELS[t.kind]}:{" "}
                              {t.amount > 0 ? "+" : ""}
                              {forint(t.amount)} → {forint(t.balanceAfter)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <PilotButton
                          variant="ghost"
                          aria-label={`…${card.codeLast4}: napló`}
                          onClick={() => void toggleLedger(card)}
                        >
                          Napló
                        </PilotButton>
                        {card.status === "active" ? (
                          <PilotButton
                            variant="secondary"
                            disabled={busy}
                            aria-label={`…${card.codeLast4}: kikapcsolás`}
                            onClick={() => setDisabling(card)}
                          >
                            Kikapcsolás
                          </PilotButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PilotCard>
      ) : null}
      <ConfirmDialog
        open={disabling !== null}
        title={`Kikapcsolod a …${disabling?.codeLast4 ?? ""} kártyát?`}
        consequence={`A kártyával ezután nem lehet fizetni. A rajta lévő ${disabling ? forint(disabling.balance) : ""} egyenleg megmarad, de nem használható.`}
        recovery="Az OS-ből nem kapcsolható vissza. Ha tévedés volt, adj ki egy új kártyát ugyanakkora összegre."
        confirmLabel="Kikapcsolom"
        busy={busy}
        onConfirm={() => disabling && void disable(disabling)}
        onCancel={() => setDisabling(null)}
      />
    </PilotThemeRoot>
  );
}
