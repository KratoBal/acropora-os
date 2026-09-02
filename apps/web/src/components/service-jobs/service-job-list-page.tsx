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
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
// A dátumformázó a munkalapoknál él. Nem másolom ide: két formázó egy
// felületen előbb-utóbb két különböző alakot ad ugyanarra az időpontra.
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import {
  serviceJobStatusLabel,
  serviceJobStatusVariant,
} from "./service-job-labels";

/**
 * A HIBAJEGYEK LISTÁJA.
 *
 * KERESŐMEZŐ NINCS, ÉS EZ NEM HIÁNY: a szerver ma csak a `scope` szűrőt
 * ismeri. Egy kliensoldali kereső azt ígérné, hogy az egész halmazban keres,
 * holott csak a betöltött kétszáz soron - egy szűrő, ami csendben mást
 * jelent, rosszabb, mint a hiánya.
 */
export function ServiceJobListPage() {
  const { session } = useAuth();
  const [scope, setScope] = useState<"open" | "all">("open");
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await serviceJobsApi.list(token, scope, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegyek nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, scope, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz"
        title="Hibajegyek"
        description="A hibajegy a lánc első eleme: mögötte állnak a munkalapok. Egy jegyhez több lap tartozhat, és a lap keletkezhet előbb is, mint a jegy."
      />
      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      <Card className="p-4">
        <Button
          variant={scope === "all" ? "primary" : "secondary"}
          onClick={() => setScope(scope === "all" ? "open" : "all")}
        >
          {scope === "all" ? "Csak a nyitottak" : "A lezártak is"}
        </Button>
      </Card>
      {loading && !data ? (
        <div className="space-y-3" aria-label="Hibajegyek betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data?.items.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Hibajegy</th>
                <th>Partner</th>
                <th>Állapot</th>
                <th>Munkalap</th>
                <th className="p-3">Létrehozva</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((job) => (
                <tr key={job.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/szerviz/hibajegyek/${job.id}`}
                      className="font-semibold text-slate-950 hover:text-teal-700"
                    >
                      {job.jobNumber}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {job.title}
                    </div>
                  </td>
                  <td>{job.customerName ?? "Nincs megadva"}</td>
                  <td>
                    <Badge variant={serviceJobStatusVariant(job.partnerStatus)}>
                      {serviceJobStatusLabel[job.status]}
                    </Badge>
                    {/* A PARTNER MÁST LÁT, és ez itt is látszik: a belső
                        állapot a jelvényen, a partneré alatta. Enélkül a
                        kezelő nem tudja, mit olvas a másik fél. */}
                    <div className="mt-0.5 text-xs text-slate-500">
                      A partner ezt látja: {job.partnerStatusLabel}
                    </div>
                  </td>
                  <td className="tabular-nums">{job.worksheetCount}</td>
                  <td className="p-3 text-xs text-slate-500">
                    {formatDateTime(job.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : data ? (
        <EmptyState
          title="Nincs hibajegy"
          description={
            scope === "open"
              ? "Nyitott hibajegy jelenleg nincs. A lezártakat a fenti gombbal nézheted meg."
              : "Még egy hibajegy sem keletkezett."
          }
        />
      ) : null}
    </div>
  );
}
