"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AssetListResponse } from "@acropora/types";
import {
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotSelect,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";

/**
 * "ESZKÖZÖK A MEDENCÉBEN" -- 3. kör (Balázs sorrendje, emlék 1847, acrobot
 * msg_id 23638/23673/23679), a portál akvárium-adatlapjának utolsó
 * hiányzó kártyája.
 *
 * === A HOZZÁRENDELŐ FELÜLET NEM `hasPermission`-EN ÁLL, HANEM A SZERVER
 *     SZÁMOLT `canAssignAssets` MEZŐN ===
 *
 * A korábbi (később visszavont) kör -- lásd `git show f32acca0` -- ezt
 * kliens-oldali `hasPermission(user, PERMISSIONS.SERVICE_ASSET_AQUARIUM_
 * ASSIGN)`-nal döntötte el, mert akkor a jog SZEREP-SZINTŰ volt. Balázs
 * pontosítása (emlék 1847) óta a jog FELHASZNÁLÓNKÉNTI `ServiceCapability`
 * (`AQUARIUM_ASSET_ASSIGN`), és ez a session-ben (`useAuth`) SEHOL nem
 * érhető el -- a session csak a szerep-szintű jogokat hordozza. A szerver
 * ezért az akvárium-adatlap SAJÁT válaszába teszi bele a kiszámolt
 * `canAssignAssets` mezőt (lásd `AquariumsService.withCanAssignAssets`
 * fejlécét) -- ez a kártya csak azt a mezőt olvassa, nem dönt önállóan.
 *
 * === MIÉRT NEM "PRÓBÁLD MEG, MAJD 403-RA MUTASS ÜZENETET" ===
 *
 * A `MATERIAL_REQUEST_MARK_RECEIVED` mintája (lásd
 * `material-request-pending-page.tsx` az `apps/web`-ben) egy EGÉSZ
 * LISTÁT rejt el a 403 mögé, és ez biztonságos próbálkozás, mert a listA
 * LEKÉRDEZÉSE olvasás, nincs mellékhatása. Egy hozzárendelés/levétel
 * VISSZAFORDÍTHATÓ ÍRÁS -- ide nem "próbáljuk meg" mintát kell tenni,
 * hanem a gombot eleve el kell rejteni attól, akinél nincs bejelölve a
 * képesség. Ezért nem a `PATCH` hívás hibájából következtetünk vissza,
 * hanem a MÁR BETÖLTÖTT `aquarium.canAssignAssets`-ből döntünk előre.
 *
 * === A JELÖLTEK A HELYSZÍN MÉG SEHOVA NEM CSATOLT ESZKÖZEI ===
 *
 * `partnerApi.assets({ departmentId })` az akvárium saját helyszínének
 * MINDEN eszközét adja -- ebből a `!item.aquarium` szűri ki azokat, amik
 * MÁR valamelyik (akár egy MÁSIK) akváriumhoz vannak csatolva. Egy már
 * csatolt eszköz átvétele a levétel a MÁSIK akvárium adatlapjáról menne,
 * nem innen -- ugyanaz a döntés, mint a visszavont körben.
 */
export function AquariumAssets({
  aquariumId,
  departmentId,
  canAssignAssets,
}: {
  aquariumId: string;
  departmentId?: string;
  canAssignAssets: boolean;
}) {
  const [assets, setAssets] = useState<AssetListResponse["items"]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<AssetListResponse["items"]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await partnerApi.assets({
        aquariumId,
        status: "ALL",
        pageSize: 100,
      });
      setAssets(result.items);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az eszközök nem tölthetők be.",
      );
    } finally {
      setLoaded(true);
    }
  }, [aquariumId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadCandidates = useCallback(async () => {
    if (!canAssignAssets || !departmentId) {
      setCandidates([]);
      return;
    }
    try {
      const result = await partnerApi.assets({
        departmentId,
        status: "ALL",
        pageSize: 100,
      });
      // CSAK A MÉG SEHOVA NEM CSATOLT ESZKÖZÖK -- lásd a fájl fejlécét.
      setCandidates(result.items.filter((item) => !item.aquarium));
    } catch {
      // A JELÖLT-LISTA HIBÁJA NEM TÖRLI A KÁRTYÁT -- a már csatolt eszközök
      // enélkül is látszanak, a hozzárendelő rész üres választóval marad.
      setCandidates([]);
    }
  }, [canAssignAssets, departmentId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  async function removeAsset(asset: AssetListResponse["items"][number]) {
    setAssignBusy(true);
    setAssignError(null);
    try {
      await partnerApi.assignAssetAquarium(asset.id, {
        aquariumId: null,
        expectedUpdatedAt: asset.updatedAt,
      });
      await load();
      await loadCandidates();
    } catch (cause) {
      setAssignError(
        cause instanceof Error
          ? cause.message
          : "Az eszköz nem vehető le az akváriumról.",
      );
    } finally {
      setAssignBusy(false);
    }
  }

  async function assignSelected() {
    const candidate = candidates.find(
      (item) => item.id === selectedCandidateId,
    );
    if (!candidate) return;
    setAssignBusy(true);
    setAssignError(null);
    try {
      await partnerApi.assignAssetAquarium(candidate.id, {
        aquariumId,
        expectedUpdatedAt: candidate.updatedAt,
      });
      setSelectedCandidateId("");
      await load();
      await loadCandidates();
    } catch (cause) {
      setAssignError(
        cause instanceof Error
          ? cause.message
          : "Az eszköz nem rendelhető hozzá.",
      );
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <PilotCard>
      <PilotCardHeader title="Eszközök a medencében" />
      <div className="px-5 py-3">
        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
        {assignError ? (
          <p className="mb-2 text-sm text-red-600">{assignError}</p>
        ) : null}
        {!loaded ? (
          <p className="text-sm text-pilot-grey-400">Betöltés…</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-pilot-grey-400">
            Nincs ehhez az akváriumhoz csatolt eszköz.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-2 border-b border-pilot-grey-100 pb-2 last:border-0 last:pb-0"
              >
                <Link
                  href={`/eszkozok/${asset.id}`}
                  className="text-sm font-medium text-pilot-grey-900 no-underline hover:underline"
                >
                  {asset.name}
                </Link>
                {canAssignAssets ? (
                  <button
                    type="button"
                    disabled={assignBusy}
                    onClick={() => void removeAsset(asset)}
                    className="shrink-0 cursor-pointer bg-transparent text-xs text-red-500 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Eltávolítás
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/*
          A HOZZÁRENDELŐ RÉSZ CSAK AKKOR RENDERELŐDIK, HA `canAssignAssets`
          IGAZ -- nem csak elrejtve CSS-sel, ténylegesen hiányzik a DOM-ból.
          Lásd a fájl fejlécét: ez a szerver által kiszámolt tény, nem
          kliens-oldali jog-ellenőrzés.
        */}
        {canAssignAssets ? (
          <div className="mt-3 border-t border-pilot-grey-100 pt-3">
            {!departmentId ? (
              <p className="text-sm text-pilot-grey-400">
                Az akváriumnak nincs megadva helyszíne, ezért nem lehet eszközt
                hozzárendelni.
              </p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-pilot-grey-400">
                A helyszínen nincs hozzárendelhető (még sehova nem csatolt)
                eszköz.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <PilotSelect
                  value={selectedCandidateId}
                  onChange={setSelectedCandidateId}
                  aria-label="Hozzárendelhető eszköz"
                  disabled={assignBusy}
                >
                  <option value="">Válasszon eszközt</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </PilotSelect>
                <PilotButton
                  variant="secondary"
                  disabled={!selectedCandidateId || assignBusy}
                  onClick={() => void assignSelected()}
                >
                  Hozzárendelés
                </PilotButton>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </PilotCard>
  );
}
