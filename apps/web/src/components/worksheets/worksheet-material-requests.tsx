"use client";

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type MaterialRequestDetail,
  type MaterialRequestItemInput,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { materialRequestsApi } from "@/lib/api/material-requests";
import { PilotCard, PilotCardHeader } from "@/components/pilot/pilot-ui";

import {
  MATERIAL_REQUEST_STATUS_BADGE_VARIANT,
  MATERIAL_REQUEST_STATUS_LABEL,
  materialRequestByline,
} from "./worksheet-material-request-presentation";

const URES_SOR: MaterialRequestItemInput = { name: "", quantity: "", unit: "" };

/**
 * ANYAGIGENYLES A MUNKALAPROL, A WEBEN.
 *
 * Balazs kerese, 2026-09-22 12:15:46 UTC: a szervizes munka kozben veszi
 * eszre, hogy kell valami, felviszi a teteleket, kulon "elkuld" gombbal
 * kuldi el. Ugyanaz a szerkezeti minta, mint a `WorksheetEntries`-nel: a
 * felvitel gombra nyilik, nem all allandoan a lapon.
 *
 * === A "BEJEGYZES" MAGA A LISTA, NINCS KULON NAPLO ===
 *
 * acrobot kikotese (msg 22190): "a MaterialRequest sor MAGA a bejegyzes...
 * DE a munkalapon LATSZANIA kell, idorendben, a kerovel es az idoponttal."
 * Ez a lista teljesiti ezt -- nincs kulon esemeny-tabla, a sor onmaga a nyom.
 *
 * === A PISZKOZAT LATHATO, ES UJRA ELKULDHETO ===
 *
 * Ha egy piszkozat (DRAFT) a felvitel utan valamiert nem jutott el a
 * kuldesig (pl. a bongeszo bezarodott a ket hivas kozott), a szervizes
 * LATJA a sajat piszkozatat itt, es a "Kuldes" gombbal ujra probalhatja --
 * lasd a `MaterialRequestStatus` sema-fejlecet a DRAFT allapotrol.
 *
 * === EGY MEZO A KULDESKOR, NEM SOKKAL FELVITELKOR ===
 *
 * Nincs kulon "piszkozat mentese" gomb: a felhasznalo helyileg allitja
 * ossze a tetel-listat (kliens-oldali allapot, meg API-hivas nelkul), es a
 * "Kuldes" gomb egy koron beluli `create` + `submit` part hivja. Igy az
 * "ertesites csak kuldeskor megy" a NORMALIS uton automatikusan igaz.
 */
export function WorksheetMaterialRequests({
  worksheetId,
  canWrite,
}: {
  worksheetId: string;
  canWrite: boolean;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const [requests, setRequests] = useState<MaterialRequestDetail[] | null>(
    null,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [rows, setRows] = useState<MaterialRequestItemInput[]>([URES_SOR]);
  const [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * A `submit()` VALASZANAK `warning` MEZOJE -- KULON A HIBATOL.
   *
   * Nem hiba: a kuldes SIKERES volt, csak arrol szol, hogy ma senki nem
   * tudja jelolni a beerkezest (lasd a szerver `submit` fejleceit). Ha az
   * `error` dobozba kerulne, a szervizes azt hinne, hogy a kuldes nem
   * sikerult, es ujra probalna -- holott az igeny mar letrejott.
   */
  const [notice, setNotice] = useState<string | null>(null);

  // Lasd a `WorksheetEntries` fejleceben: a kapu a munkamenetre es a jogra
  // megy, soha nem a kliens-oldalon olvashato tokenre.
  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const response = await materialRequestsApi.listForWorksheet(
        token,
        worksheetId,
      );
      setRequests(response.items);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az anyagigények nem tölthetők be.",
      );
    }
  }, [canView, token, worksheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addRow = () => setRows((sorok) => [...sorok, { ...URES_SOR }]);
  const removeRow = (index: number) =>
    setRows((sorok) => sorok.filter((_, i) => i !== index));
  const updateRow = (
    index: number,
    field: keyof MaterialRequestItemInput,
    value: string,
  ) =>
    setRows((sorok) =>
      sorok.map((sor, i) => (i === index ? { ...sor, [field]: value } : sor)),
    );

  const sendNew = async () => {
    /*
      A HAROM MEZO SZABAD SZOVEG, VALIDALATLAN -- lasd a DTO fejleceit. Az
      EGYETLEN kovetelmeny, hogy egyik se maradjon URES: az ures nev/
      mennyiseg/egyseg ugyanugy ertelmezhetetlen sort adna, mint egy ures
      munkanaplo-bejegyzes.
    */
    const tisztitott = rows
      .map((sor) => ({
        name: sor.name.trim(),
        quantity: sor.quantity.trim(),
        unit: sor.unit.trim(),
      }))
      .filter((sor) => sor.name || sor.quantity || sor.unit);

    if (tisztitott.length === 0) {
      setError("Adj meg legalább egy tételt.");
      return;
    }
    const hianyos = tisztitott.find(
      (sor) => !sor.name || !sor.quantity || !sor.unit,
    );
    if (hianyos) {
      setError(
        "Minden felvitt tételnél töltsd ki a nevet, a mennyiséget és az egységet.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const draft = await materialRequestsApi.create(token, worksheetId, {
        items: tisztitott,
      });
      const response = await materialRequestsApi.submit(token, draft.id);
      setRequests(response.items);
      setNotice(response.warning ?? null);
      setRows([{ ...URES_SOR }]);
      setFormOpen(false);
    } catch (cause) {
      /*
        HA A `create` LEFUTOTT, DE A `submit` NEM: a piszkozat a szerveren
        MEGVAN, es a lista frissitese (lent) felszinre hozza -- a "Kuldes"
        gomb onnan probalhato ujra. Ezert `load()`-ot hivunk a hiba agaban
        is, ne csak hibauzenetet mutassunk egy eltunt allapotra.
      */
      setError(
        cause instanceof Error
          ? cause.message
          : "Az anyagigény nem küldhető el.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const sendDraft = async (id: string) => {
    setSendingId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await materialRequestsApi.submit(token, id);
      setRequests(response.items);
      setNotice(response.warning ?? null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az anyagigény nem küldhető el.",
      );
    } finally {
      setSendingId(null);
    }
  };

  return (
    <PilotCard>
      <PilotCardHeader
        title={`Anyagigények${requests ? ` (${requests.length})` : ""}`}
      />
      <div className="space-y-3 p-4">
        {error ? <Alert variant="danger" title={error} /> : null}
        {notice ? <Alert variant="info" title={notice} /> : null}

        {canWrite ? (
          formOpen ? (
            <div className="space-y-3 rounded border border-dusk-200 p-3">
              {rows.map((sor, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Input
                    aria-label="Tétel neve"
                    placeholder="Pl. 40mm PVC nyomócső"
                    value={sor.name}
                    onChange={(event) =>
                      updateRow(index, "name", event.target.value)
                    }
                    className="flex-1"
                  />
                  <Input
                    aria-label="Mennyiség"
                    placeholder="Pl. 10 méter"
                    value={sor.quantity}
                    onChange={(event) =>
                      updateRow(index, "quantity", event.target.value)
                    }
                    className="w-28"
                  />
                  <Input
                    aria-label="Egység"
                    placeholder="Pl. db"
                    value={sor.unit}
                    onChange={(event) =>
                      updateRow(index, "unit", event.target.value)
                    }
                    className="w-20"
                  />
                  {rows.length > 1 ? (
                    <Button
                      variant="secondary"
                      onClick={() => removeRow(index)}
                      aria-label="Tétel törlése"
                    >
                      Törlés
                    </Button>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={addRow}>
                  Új tétel
                </Button>
                <Button disabled={busy} onClick={() => void sendNew()}>
                  {busy ? "Küldés…" : "Küldés"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setFormOpen(false);
                    setRows([{ ...URES_SOR }]);
                    setError(null);
                  }}
                >
                  Mégse
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              Anyagigénylés
            </Button>
          )
        ) : null}

        {requests === null ? <Skeleton className="h-16" /> : null}

        {requests && requests.length === 0 ? (
          <EmptyState
            title="Ezen a munkalapon még nincs anyagigény"
            description={
              canWrite
                ? "Az Anyagigénylés gombbal viheted fel, mire van szükséged."
                : "Az anyagigényeket a lapon dolgozó kollégák viszik fel."
            }
          />
        ) : null}

        <ul className="space-y-2">
          {requests?.map((request) => (
            <li key={request.id} className="rounded border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-dusk-500">
                  {materialRequestByline(request)}
                </p>
                <Badge
                  variant={
                    MATERIAL_REQUEST_STATUS_BADGE_VARIANT[request.status]
                  }
                >
                  {MATERIAL_REQUEST_STATUS_LABEL[request.status]}
                </Badge>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm text-dusk-800">
                {request.items.map((item) => (
                  <li key={item.id}>
                    {item.name} — {item.quantity} {item.unit}
                  </li>
                ))}
              </ul>
              {request.status === "DRAFT" ? (
                <Button
                  className="mt-2"
                  disabled={sendingId === request.id}
                  onClick={() => void sendDraft(request.id)}
                >
                  {sendingId === request.id ? "Küldés…" : "Küldés"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </PilotCard>
  );
}
