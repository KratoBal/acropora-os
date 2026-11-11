"use client";

import {
  Alert,
  PilotButton,
  PilotDataTable,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  INVOICE_COLLECTION_ITEM_VERDICTS,
  type InvoiceCollectionItemRow,
  type InvoiceCollectionItemSource,
  type InvoiceCollectionItemVerdict,
  type InvoiceCollectionItemsResponse,
  type InvoiceCollectionReason,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { missingInvoicesApi } from "@/lib/api/missing-invoices";
import { formatDay } from "./missing-invoices-model";

/**
 * A GYŰJTŐ ÍTÉLETEI (acrobot 35522, J55388): Balázs maga láthassa, mi lett egy
 * levél PDF-jéből. A tartalom nem látszik, és a nem tárolt fájloké nincs is
 * meg: csak az ítélet marad, a fájlnévvel és a forrással.
 */
export const VERDICT_LABELS: Record<InvoiceCollectionItemVerdict, string> = {
  STORED: "Tárolva",
  SUGGESTED: "Döntésre vár",
  UNMATCHED: "Nem párosodott",
  NOT_INVOICE: "Nem számla",
  OWN_INVOICE: "Saját számla",
  DUPLICATE: "Már megvolt",
  TOO_LARGE: "Túl nagy",
  UNREADABLE: "Nem olvasható",
};

/** Egy mondat arról, mit jelent az ítélet és mi történik vele. */
/** Az ítélet OKA (a begyűjtő jegyzi fel, `InvoiceCollectionItemRow.reason`): hogy ne kelljen a kódot ismerni. */
export const REASON_LABELS: Record<InvoiceCollectionReason, string> = {
  NO_TEXT_LAYER: "szkennelt PDF, nincs szövegrétege",
  NO_NUMBER_READ: "a számlaszám nem olvasható ki",
  NUMBER_NOT_KNOWN:
    "a szám nem ismert (nincs hozzá NAV-, feed- vagy beszerzés-sor, banki hivatkozás vagy kártyás fizetés)",
  NUMBER_NOT_CORROBORATED:
    "az ismert szám áll benne, de az összeg, a szállító neve és a feladó sem erősíti meg",
  NOT_PDF_FILE: "a fájl nem PDF",
  PDF_TEXT_FAILED: "a PDF szövege nem olvasható",
  NO_INVOICE_WORDS: "nincs benne számla-szó",
  REMINDER: "fizetési emlékeztető",
  OTHER_DOCUMENT: "szerződés, ajánlat vagy más dokumentum",
  OWN_ACCOUNT_IN_TEXT: "a saját bankszámlánk áll benne",
  SAME_CONTENT: "ugyanez a fájl már megvan",
};

export const VERDICT_HELP: Record<InvoiceCollectionItemVerdict, string> = {
  STORED: "Tárolva van, és jelölt a párosításhoz.",
  SUGGESTED:
    "Tárolva van; a Jev bejövő számlának látta, a Javasolt számlák lapon vár döntésre.",
  UNMATCHED:
    "Számlának látszik, de semmi nem kötötte egy számlához vagy terheléshez. Nincs tárolva; naponta egyszer, vagy új adatnál újraolvasódik.",
  NOT_INVOICE:
    "Nincs benne számla-szó, vagy emlékeztető, szerződés, ajánlat, vagy nincs szövege. Végleges, nincs tárolva.",
  OWN_INVOICE: "A saját kimenő számlánk, nem bejövő. Nincs tárolva.",
  DUPLICATE: "Azonos tartalom már tárolva van.",
  TOO_LARGE: "A melléklet a méretkorlát felett van. Nincs tárolva.",
  UNREADABLE: "Nem PDF, vagy a szövege nem olvasható ki. Nincs tárolva.",
};

const SOURCE_LABELS: Record<InvoiceCollectionItemSource, string> = {
  INFO_MAIL: "info@ levelek",
  BALAZS_MAIL: "balazs@ levelek",
  DRIVE: "Drive mappa",
};

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const time = date.toLocaleTimeString("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
  });
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest",
  }).format(date);
  return `${formatDay(day)} ${time}`;
}

export function CollectionItemsSection({ token }: { token: string }) {
  const [verdict, setVerdict] = useState<InvoiceCollectionItemVerdict | "">("");
  const [data, setData] = useState<InvoiceCollectionItemsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        setData(
          await missingInvoicesApi.collectionItems(token, { verdict }, signal),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A gyűjtő ítéletei nem tölthetők be.",
          );
      }
    },
    [token, verdict],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const columns: PilotTableColumn<InvoiceCollectionItemRow>[] = [
    {
      id: "file",
      header: "Fájl",
      cell: (item) =>
        item.fileName === null ? (
          <span className="text-sm italic text-pilot-grey-500">
            A fájlnév nem látszik (a balazs@ postafiók magánlevelezés)
          </span>
        ) : (
          <span className="truncate font-semibold text-pilot-grey-900">
            {item.fileName}
          </span>
        ),
    },
    {
      id: "source",
      header: "Forrás",
      width: "130px",
      cell: (item) => SOURCE_LABELS[item.source] ?? item.source,
    },
    {
      id: "verdict",
      header: "Ítélet",
      width: "260px",
      cell: (item) => (
        <span className="flex flex-col">
          <span className="font-medium text-pilot-grey-900">
            {VERDICT_LABELS[item.verdict] ?? item.verdict}
          </span>
          <span className="text-xs text-pilot-grey-500">
            {VERDICT_HELP[item.verdict] ?? ""}
          </span>
          {item.reason ? (
            <span className="text-xs text-pilot-amber-700">
              Ok: {REASON_LABELS[item.reason] ?? item.reason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "decided",
      header: "Mikor",
      width: "150px",
      cell: (item) => formatStamp(item.createdAt),
    },
  ];

  return (
    <section aria-label="A gyűjtő ítéletei" className="space-y-3">
      <header>
        <h2 className="text-xl font-semibold text-pilot-grey-900">
          A gyűjtő ítéletei
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-pilot-grey-600">
          Mit döntött a levélgyűjtő a talált PDF-ekről. A fájl tartalma nem
          látszik, és ami nincs tárolva, annak csak az ítélete marad meg. A
          legutóbbiak vannak elöl.
        </p>
      </header>
      <div
        role="group"
        aria-label="Ítélet szerint"
        className="flex flex-wrap gap-2"
      >
        <PilotButton
          size="action"
          variant={verdict === "" ? "primary" : "secondary"}
          aria-pressed={verdict === ""}
          onClick={() => setVerdict("")}
        >
          Mind
        </PilotButton>
        {INVOICE_COLLECTION_ITEM_VERDICTS.map((name) => (
          <PilotButton
            key={name}
            size="action"
            variant={verdict === name ? "primary" : "secondary"}
            aria-pressed={verdict === name}
            onClick={() => setVerdict(name)}
          >
            {`${VERDICT_LABELS[name]} (${data?.counts[name] ?? "…"})`}
          </PilotButton>
        ))}
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="A gyűjtő ítéletei nem tölthetők be"
          description={error}
        />
      ) : data === null ? (
        <p role="status" className="text-sm text-pilot-grey-500">
          Betöltés…
        </p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">Nincs ilyen ítéletű fájl.</p>
      ) : (
        <>
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(item) => item.id}
            minWidth={820}
          />
          {data.truncated ? (
            <p className="text-xs text-pilot-grey-500">
              Csak a legutóbbi {data.limit} sor látszik.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
