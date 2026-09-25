"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  PilotAvatar,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotThemeRoot,
  pilotAvatarColor,
  pilotInitials,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { WATER_TYPE_LABEL } from "@/lib/aquarium-labels";
import { AquariumWaterValues } from "./aquarium-water-values";
import { Message } from "./ticket-list";

/**
 * AZ AKVÁRIUM ADATLAPJA A PORTÁLON -- PILOT-STÍLUS
 * (Balázs döntése, emlék 1847, 2026-09-25 16:04 UTC).
 *
 * === MI VÁLTOZOTT A KORÁBBI KÖRHÖZ KÉPEST ===
 *
 * Az előző kör (#1121) a belső `app.acropora.hu` RÉGI, violet
 * `ServiceDetailHeader`/`ServicePanel`/`ServiceDataItem` keretét vette át,
 * és EGYBEN tartalmazta a vízérték-kártyát és az "Új mérés" űrlapot is.
 * Ez a kör a belső web PILOT akvárium-adatlapjának
 * (`pilot-aquarium-editor-page.tsx`) vizuális nyelvére vált --
 * `PilotCard`/`PilotDataRow`/`PilotAvatar` (`packages/ui/src/pilot-ui.tsx`),
 * ugyanaz a család, amit az `asset-detail.tsx`/`ticket-detail.tsx` már
 * használ.
 *
 * === A VÍZÉRTÉK-KÁRTYA ÉS AZ "ÚJ MÉRÉS" ŰRLAP A 2. KÖRBEN VISSZAKERÜLT ===
 *
 * Az 1. kör (fent, `247b8201`) ezt a kártyát szándékosan hagyta ki --
 * acrobot sorrendje (msg_id 23638): "1) lista + adatlap + uj a pilot-
 * alakban, 2) meres + elozmeny grafikonnal, 3) eszkoz-hozzarendeles
 * joggal". Ez a kör (2.) pótolja: `AquariumWaterValues`
 * (`./aquarium-water-values.tsx`) a belső `pilot-aquarium-water-values.tsx`
 * másolata, PARTNER hatókörre szűkítve -- lásd a saját fejlécét arról,
 * mi maradt ki (törlés, e-mail küldés, Excel-export -- mindhárom
 * `requireInternalWriter`-rel zárt a szerveren) és mi nem (az "Új mérés"
 * felvitel, mert a `POST /aquariums/:id/measurements` nyitott).
 *
 * Az "Eszközök a medencében" kártya (eszköz-hozzárendelés, 3. kör) TOVÁBBRA
 * IS HIÁNYZIK -- az külön jogosultsághoz kötött (emlék 1843), és a szerver
 * oldala (`feat/portal-asset-aquarium-assign`) ekkor még külön ágon fut.
 *
 * === TOVÁBBRA IS CSAK-OLVASÓ, NEM ŰRLAP (AZ AKVÁRIUM SAJÁT MEZŐIRE) ===
 *
 * A belső `pilot-aquarium-editor-page.tsx` MINDIG szerkeszthető űrlap
 * (staff bármikor átírhatja az akvárium saját mezőit). A PARTNER viszont
 * NEM -- `aquariums.service.ts` `update()` `requireInternalWriter(user,
 * "Akvárium szerkesztése")`-t hív, ami minden nem-belsős hívóra dob. A
 * "pilot komponensek másolata" tehát a VIZUÁLIS családra vonatkozik
 * (`PilotCard`/`PilotDataRow`), nem a szerkeszthetőségre -- ez a lap ezért
 * `PilotDataRow`-okkal (olvasó sor), NEM `PilotFormField`/`PilotInput`-tal
 * (szerkesztő mező) épül. Egy szerkeszthető űrlap, ami a szerverre 403-at
 * kapna minden mentésnél, rosszabb a hiányánál.
 *
 * === A HATÓKÖRT A SZERVER SZABJA, IDEGEN AKVÁRIUMRA 404 JÖN ===
 *
 * Ugyanaz a minta, mint az `AssetDetail`-nél: a kliens nem szűr, a
 * `partnerApi.aquarium(id)` egyenesen a szerver válaszát adja vissza.
 */
export function AquariumDetail({ id }: { id: string }) {
  const [aquarium, setAquarium] = useState<Awaited<
    ReturnType<typeof partnerApi.aquarium>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAquarium(await partnerApi.aquarium(id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az akvárium nem tölthető be.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!aquarium)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">Akvárium betöltése…</p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          AKVÁRIUM
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          {aquarium.name}
        </h1>
        <p className="mt-1 font-mono text-xs text-pilot-grey-400">
          {aquarium.aquariumNumber}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Alapadatok" />
            <div className="px-5 py-2">
              <PilotDataRow label="Helyszín" value={aquarium.departmentName} />
              <PilotDataRow
                label="Víztípus"
                value={
                  aquarium.waterType
                    ? WATER_TYPE_LABEL[aquarium.waterType]
                    : undefined
                }
              />
              <PilotDataRow
                label="Víztérfogat"
                value={
                  aquarium.systemVolumeLiters !== undefined
                    ? `${aquarium.systemVolumeLiters.toLocaleString("hu-HU")} l`
                    : undefined
                }
              />
              <PilotDataRow
                label="Indítás dátuma"
                value={datum(aquarium.startedAt)}
              />
              <PilotDataRow label="Megjegyzés" value={aquarium.notes} />
            </div>
          </PilotCard>

          <AquariumWaterValues
            aquariumId={aquarium.id}
            waterType={aquarium.waterType}
            targets={aquarium.targets}
          />
        </div>

        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Karbantartók" />
            <div className="px-5 py-3">
              {aquarium.maintainers.length === 0 ? (
                <p className="text-sm text-pilot-grey-400">
                  Nincs hozzárendelt karbantartó.
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {aquarium.maintainers.map((maintainer) => (
                    <li
                      key={maintainer.userId}
                      className="flex items-center gap-2"
                    >
                      <PilotAvatar
                        initials={pilotInitials(maintainer.displayName)}
                        color={pilotAvatarColor(maintainer.userId)}
                        size="sm"
                      />
                      <span className="text-sm text-pilot-grey-700">
                        {maintainer.displayName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
  );
}

/** A HIÁNYZÓ DÁTUM KIMONDVA ÁLL, nem üres cellaként -- ugyanaz a minta,
 * mint az `asset-detail.tsx` `datum()`-ja. */
function datum(ertek?: string): string {
  return ertek ? new Date(ertek).toLocaleDateString("hu-HU") : "Nincs megadva";
}

/** A VISSZAFELE VEZETO UT -- ugyanaz a minta, mint az `asset-detail.tsx`
 * `VisszaLink()`-je. */
function VisszaLink() {
  return (
    <Link
      href="/akvariumok"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 no-underline hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
      Akváriumok
    </Link>
  );
}
