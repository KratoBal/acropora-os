"use client";

import {
  Alert,
  Icon,
  PilotButton,
  PilotDataTable,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type InvoiceCollectionSuggestion,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MISSING_INVOICES_PATH } from "@/components/navigation";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { missingInvoicesApi } from "@/lib/api/missing-invoices";
import { AssignToIncomingPanel } from "./missing-invoices-assign-incoming";
import { CollectionItemsSection } from "./missing-invoices-collection-items";
import { formatAmount, formatDay } from "./missing-invoices-model";

/**
 * A JEV JAVASLATAI A BEGYŰJTÉSBŐL (levél-válogatás terv, 4. szelet; acrobot
 * 25803). Balázs keretdöntése: a Jev csak javasol, ember hagyja jóvá. Egy
 * javaslat egy illesztő nélküli levél PDF-je, amit a Jev bejövő számlának látott;
 * amíg itt senki nem dönt róla, NEM jelölt a Hiányzó számlák között.
 *
 *   Elfogad  a dokumentum jelölt lesz (a párosító látja)
 *   Elvet    a dokumentum törlődik; a levél többé nem jön elő
 */
export function MissingInvoicesSuggestionsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [items, setItems] = useState<InvoiceCollectionSuggestion[] | null>(
    null,
  );
  const [staleAfterDays, setStaleAfterDays] = useState(60);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        const response = await missingInvoicesApi.suggestions(token, signal);
        setItems(response.items);
        setStaleAfterDays(response.staleAfterDays);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A javaslatok nem tölthetők be.",
          );
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = async (
    item: InvoiceCollectionSuggestion,
    decision: "ACCEPT" | "REJECT",
  ) => {
    setBusy(item.documentId);
    setActionError(null);
    try {
      if (decision === "ACCEPT")
        await missingInvoicesApi.acceptSuggestion(token, item.documentId);
      else await missingInvoicesApi.rejectSuggestion(token, item.documentId);
      setItems(
        (current) =>
          current?.filter((row) => row.documentId !== item.documentId) ?? null,
      );
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A döntés nem ment át.",
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const openPdf = async (item: InvoiceCollectionSuggestion) => {
    setActionError(null);
    try {
      const { blob } = await missingInvoicesApi.suggestionFile(
        token,
        item.documentId,
      );
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető be.",
      );
    }
  };

  const columns: PilotTableColumn<InvoiceCollectionSuggestion>[] = [
    {
      id: "file",
      header: "Fájl",
      cell: (item) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-pilot-grey-900">
            {item.fileName}
          </span>
          <span className="truncate text-xs text-pilot-grey-500">
            {[item.sender, item.subject].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Olvasott adatok",
      width: "220px",
      cell: (item) => (
        <span className="flex flex-col text-sm">
          <span>{item.invoiceNumber ?? "—"}</span>
          <span className="text-xs text-pilot-grey-500">
            {[
              item.supplierName,
              item.gross && item.currency
                ? formatAmount(item.gross, item.currency)
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    {
      id: "received",
      header: "Érkezett",
      width: "120px",
      cell: (item) =>
        item.receivedAt ? formatDay(item.receivedAt.slice(0, 10)) : "—",
    },
    {
      id: "state",
      header: "Állapot",
      width: "150px",
      cell: (item) =>
        item.state === "UNASSIGNED" ? (
          <span className="flex flex-col">
            <span>Nem párosodott</span>
            {item.stale ? (
              <span className="text-xs font-medium text-pilot-amber-700">
                {staleAfterDays} napnál régebben vár
              </span>
            ) : null}
          </span>
        ) : (
          "A Jev javasolta"
        ),
    },
    {
      id: "confidence",
      header: "Bizonyosság",
      width: "110px",
      align: "right",
      cell: (item) =>
        item.confidence === null
          ? "—"
          : `${Math.round(item.confidence * 100)}%`,
    },
    {
      id: "actions",
      header: <span className="sr-only">Döntés</span>,
      width: "420px",
      align: "right",
      cell: (item) => (
        <span className="flex justify-end gap-2">
          <PilotButton
            variant="secondary"
            size="action"
            onClick={() => void openPdf(item)}
          >
            PDF
          </PilotButton>
          {canManage ? (
            <>
              {item.state === "UNASSIGNED" ? (
                <PilotButton
                  variant="secondary"
                  size="action"
                  disabled={busy !== null}
                  aria-label={`${item.fileName} bejövő számlához`}
                  onClick={() =>
                    setAssigning((current) =>
                      current === item.documentId ? null : item.documentId,
                    )
                  }
                >
                  Bejövő számlához
                </PilotButton>
              ) : null}
              <PilotButton
                variant="secondary"
                size="action"
                disabled={busy !== null}
                onClick={() => void decide(item, "REJECT")}
              >
                Elvet
              </PilotButton>
              <PilotButton
                size="action"
                disabled={busy !== null}
                onClick={() => void decide(item, "ACCEPT")}
              >
                Elfogad
              </PilotButton>
            </>
          ) : null}
        </span>
      ),
    },
  ];

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <p className="text-sm text-pilot-grey-600">
          A Hiányzó számlákhoz finance.view jog kell.
        </p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <Link
        href={MISSING_INVOICES_PATH}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a Hiányzó számlákhoz
      </Link>
      <header>
        <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
          Javasolt számlák
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-pilot-grey-600">
          A begyűjtés olyan PDF-jei, amelyeket semmi nem kötött egy számlához
          vagy terheléshez, de számlának látszanak: vagy a Jev látta bejövő
          számlának (van bizonyossága), vagy nem párosodtak (a fájlnév, a tárgy
          vagy a szöveg szerint számla, de a szám, a szállító vagy a fizetés nem
          egyezik semmivel). Amíg nem döntesz róluk, nem kerülnek a párosítás
          jelöltjei közé, de a PDF megvan. Elfogadva jelöltek lesznek, elvetve
          törlődnek. Ha később összekötheti őket egy új adat, a begyűjtés maga
          köti.
        </p>
      </header>
      {items && items.some((item) => item.stale) ? (
        <Alert
          variant="info"
          title="Régóta döntésre váró fájlok"
          description={`${items.filter((item) => item.stale).length} nem párosodott fájl ${staleAfterDays} napnál régebben vár döntésre. Automatikusan nem törlődnek: elfogadva jelöltek lesznek, elvetve törlődik a tartalmuk.`}
        />
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          title="Nem sikerült"
          description={actionError}
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A javaslatok nem tölthetők be"
          description={error}
        />
      ) : items === null ? (
        <p role="status" className="text-sm text-pilot-grey-500">
          Betöltés…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          Nincs döntésre váró javaslat.
        </p>
      ) : (
        <PilotDataTable
          columns={columns}
          rows={items}
          rowKey={(item) => item.documentId}
          minWidth={1080}
        />
      )}
      {assigning ? (
        <AssignToIncomingPanel
          token={token}
          documentId={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setItems(
              (current) =>
                current?.filter((row) => row.documentId !== assigning) ?? null,
            );
            setAssigning(null);
          }}
        />
      ) : null}
      <CollectionItemsSection token={token} />
    </PilotThemeRoot>
  );
}
