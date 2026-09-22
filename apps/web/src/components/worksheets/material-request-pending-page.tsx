"use client";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import type { PendingMaterialRequest } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { materialRequestsApi } from "@/lib/api/material-requests";

import { materialRequestByline } from "./worksheet-material-request-presentation";

/**
 * A BESZERZO SAJAT LISTAJA -- "RAM VARO ANYAGIGENYEK".
 *
 * Balazs kerese, 2026-09-22 12:15:46 UTC: "beszerzi az anyagot, majd ha
 * megvan, akkor a sajat feluleten ranyom az anyag beerkezett gombra".
 *
 * === A MENUPONTOT MINDENKI LATJA, AKI MUNKALAPRA IRHAT -- A TARTALMAT NEM ===
 *
 * A `MATERIAL_REQUEST_MARK_RECEIVED` per-felhasznalo kepesseg, nem szerep
 * (lasd `navigation.ts` jegyzetet). Aki nincs bejelolve, 403-at kap a
 * lekerdezesre -- ezt a lapon KULON, ertelmezheto uzenettel kell kimondani,
 * nem altalanos hibakent, mert ez NEM hiba, hanem varhato allapot annak,
 * akinek nincs bejelolve ez a jog.
 *
 * A KLIENS AZ ApiError 403-AT ALTALANOS SZOVEGGEL CSERELI (lasd
 * `client.ts`), tehat a szerver sajat, pontos uzenete idaig nem is ér el --
 * a sajat, pontos szoveget itt, a STATUS KOD alapjan adjuk, nem a
 * `cause.message`-bol.
 */
export function MaterialRequestPendingPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [requests, setRequests] = useState<PendingMaterialRequest[] | null>(
    null,
  );
  const [forbidden, setForbidden] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const response = await materialRequestsApi.listPending(token);
      setRequests(response.items);
      setForbidden(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setForbidden(true);
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "A lista nem tölthető be.",
      );
    }
  }, [session, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const receive = async (id: string) => {
    setReceivingId(id);
    setError(null);
    try {
      const response = await materialRequestsApi.receive(token, id);
      setRequests(response.items);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A beérkezés nem jelölhető meg.",
      );
    } finally {
      setReceivingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Anyagigények"
        description="A rád váró, beszerzésre elküldött anyagigények."
      />

      {forbidden ? (
        <Alert
          variant="info"
          title="Ehhez a listához nincs jogosultságod"
          description={
            'Csak azok a kollégák látják, akiknél be van jelölve az "anyag beérkezett" jelölés joga a felhasználói profilon.'
          }
        />
      ) : (
        <>
          {error ? <Alert variant="danger" title={error} /> : null}

          {requests === null ? <Skeleton className="h-32" /> : null}

          {requests && requests.length === 0 ? (
            <EmptyState
              title="Nincs rád váró anyagigény"
              description="Amint egy szervizes elküld egy igényt, itt jelenik meg."
            />
          ) : null}

          <ul className="space-y-3">
            {requests?.map((request) => (
              <li key={request.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-dusk-800">
                        {request.customerDisplayName} · {request.departmentName}
                      </p>
                      <p className="text-xs text-dusk-500">
                        {request.worksheetNumber
                          ? `Munkalap: ${request.worksheetNumber}`
                          : "Munkalap: még piszkozat"}
                      </p>
                    </div>
                    <Link
                      className="text-xs font-semibold text-brand-700 underline"
                      href={`/szerviz/munkalapok/${request.worksheetId}`}
                    >
                      Munkalap megnyitása
                    </Link>
                  </div>
                  <p className="text-xs text-dusk-500">
                    {materialRequestByline(request)}
                  </p>
                  <ul className="space-y-0.5 text-sm text-dusk-800">
                    {request.items.map((item) => (
                      <li key={item.id}>
                        {item.name} — {item.quantity} {item.unit}
                      </li>
                    ))}
                  </ul>
                  <Button
                    disabled={receivingId === request.id}
                    onClick={() => void receive(request.id)}
                  >
                    {receivingId === request.id
                      ? "Jelölés…"
                      : "Anyag beérkezett"}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
