"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ExpectedArrivalListItem,
  type ExpectedArrivalSource,
  type SupplierInvoiceMailSyncStatus,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { expectedArrivalsApi } from "@/lib/api/expected-arrivals";

function formatAmount(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("hu-HU") : "—";
}

/** A levél-behúzás állapota egy mondatban, a lap tetején. */
function mailPullSentence(status: SupplierInvoiceMailSyncStatus): string {
  switch (status.state) {
    case "ENABLED":
      return `A beszállítói levelek behúzása ${status.intervalMinutes} percenként fut magától.`;
    case "NO_KEY":
      return "A beszállítói levelek behúzása be van kapcsolva, de nincs hozzá Gmail-kulcs.";
    case "NO_SENDERS":
      return "A beszállítói levelek behúzása be van kapcsolva, de egy feladó sincs megadva.";
    default:
      return "A beszállítói levelek behúzása nem fut magától; a „Levelek ellenőrzése” gomb kézzel indítja.";
  }
}

/**
 * VÁRHATÓ BEÉRKEZÉSEK (Balázs, 2026-09-30): "a Beszerzés alatt található
 * Várható beérkezések menüpontban ott van a lista, miből kiválasztja, melyik
 * számlát akarja bevételezni, és utána megcsinálja a beszerzést".
 *
 * Egy lista, forrás szerint jelölve: a levélből jött rendelések (a proformáé
 * még nem bevételezhető) és a NAV-ból jött, még be nem vételezett számlák. Egy
 * sorra kattintva a szerkesztő előtöltve nyílik; a mentés után a tétel lekerül.
 */
export function ExpectedArrivalListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ExpectedArrivalListItem[] | null>(null);
  const [mailStatus, setMailStatus] =
    useState<SupplierInvoiceMailSyncStatus | null>(null);
  const [source, setSource] = useState<"" | ExpectedArrivalSource>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, status] = await Promise.all([
        expectedArrivalsApi.list(token),
        expectedArrivalsApi.syncStatus(token).catch(() => null),
      ]);
      setItems(list.items);
      setMailStatus(status);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A lista nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const run = await expectedArrivalsApi.sync(token);
      setSyncNotice(
        run.documentsRead > 0
          ? `${run.documentsRead} új dokumentum beolvasva.`
          : "Nincs új beszállítói levél.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A levelek ellenőrzése nem sikerült.",
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a listához"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  const shown = (items ?? []).filter(
    (item) => !source || item.source === source,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Várható beérkezések"
        description="A beérkezett, de még be nem vételezett beszállítói számlák. Válassz egyet a bevételezéshez: a szerkesztő előtöltve nyílik."
        actions={
          canManage && mailStatus?.canRunNow ? (
            <Button onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? "Ellenőrzés..." : "Levelek ellenőrzése"}
            </Button>
          ) : undefined
        }
      />
      {mailStatus ? (
        <p className="text-sm text-dusk-500" data-testid="levelbehuzas-allapot">
          {mailPullSentence(mailStatus)}
        </p>
      ) : null}
      {syncNotice ? (
        <Alert
          variant="info"
          title="Ellenőrzés kész"
          description={syncNotice}
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      <Card className="flex flex-wrap gap-2 p-4">
        {(
          [
            ["", "Összes"],
            ["MAIL", "Levélből"],
            ["NAV", "NAV"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value || "all"}
            variant={source === value ? "primary" : "secondary"}
            onClick={() => setSource(value)}
          >
            {label}
          </Button>
        ))}
      </Card>
      {loading && !items ? (
        <div aria-label="Várható beérkezések betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {items ? (
        shown.length ? (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                <tr>
                  <th className="p-3">Forrás</th>
                  <th>Beszállító</th>
                  <th>Rendelés / számla</th>
                  <th>Érkezett</th>
                  <th>Nettó összeg</th>
                  <th>Sorok</th>
                  <th>Állapot</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const bookable = item.editorPath !== null;
                  return (
                    <tr
                      key={`${item.source}-${item.id}`}
                      data-testid="varhato-sor"
                      className={
                        bookable
                          ? "cursor-pointer border-b last:border-0 hover:bg-dusk-50"
                          : "border-b last:border-0 text-dusk-500"
                      }
                      onClick={
                        bookable
                          ? () => router.push(item.editorPath!)
                          : undefined
                      }
                    >
                      <td className="p-3">
                        <Badge
                          variant={item.source === "MAIL" ? "info" : "neutral"}
                        >
                          {item.source === "MAIL" ? "Levél" : "NAV"}
                        </Badge>
                      </td>
                      <td className="font-semibold text-dusk-900">
                        {item.supplierName}
                      </td>
                      <td className="font-mono text-xs text-dusk-600">
                        {[
                          item.orderReference
                            ? `rendelés ${item.orderReference}`
                            : null,
                          item.invoiceNumber,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td>{formatDate(item.arrivedAt)}</td>
                      <td>{formatAmount(item.netTotal, item.currency)}</td>
                      <td>
                        {item.lineCount === null
                          ? "—"
                          : item.suggestedLineCount
                            ? `${item.lineCount} (${item.suggestedLineCount} javaslattal)`
                            : String(item.lineCount)}
                      </td>
                      <td>
                        {item.stage === "INVOICE" ? (
                          <Badge variant="success">Bevételezhető</Badge>
                        ) : item.stage === "LATE_CORRECTION" ? (
                          <Badge variant="danger">
                            Bevételezés után javított számla érkezett
                          </Badge>
                        ) : (
                          <Badge variant="warning">
                            Csak proforma, a számla még nem érkezett meg
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptyState
            title="Nincs várható beérkezés"
            description="Minden beérkezett számla be van vételezve."
          />
        )
      ) : null}
    </div>
  );
}
