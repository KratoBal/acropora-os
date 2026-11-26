"use client";
import {
  aquariumMeasurementParameter,
  formatNumber,
  type AquariumDetail,
} from "@acropora/types";
import type { ReactNode } from "react";

import { formatDayHu } from "@/lib/format/date";
import {
  PilotAvatar,
  PilotCard,
  PilotCardHeader,
  pilotAvatarColor,
  pilotInitials,
} from "@/components/pilot/pilot-ui";
import {
  EQUIPMENT_KIND_LABEL,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "../aquarium-labels";

/**
 * AZ AKVÁRIUM ADATLAPJA OLVASVA (Picasso 3.22). Eddig a meglévő akvárium szerkesztő űrlapként nyílt, a jobb oszlopban tizennégy
 * (tengerinél) üres céltartomány-mezővel. Most olvasva nyílik: az adatok kártyákban, a berendezések és a karbantartók listaként, a
 * céltartományokból csak a beállítottak. A szerkesztés a fejléc "Szerkesztés" gombjára nyílik (a szülő, `PilotAquariumEditorPage`).
 *
 * A bal oldali kártyák ez a komponens; a fejléc és a jobb oszlop vízérték-kártyája a szülőé, mert az a szerkesztésben is ugyanaz.
 */
export function PilotAquariumReadView({
  detail,
  ownerExtra,
}: {
  detail: AquariumDetail;
  /** the ReefClub code panel of a customer's aquarium, when the server runs the ReefClub (the parent decides) */
  ownerExtra?: ReactNode;
}) {
  const dimensions = [detail.lengthCm, detail.widthCm, detail.heightCm];
  return (
    <div className="flex flex-col gap-5">
      <PilotCard>
        <PilotCardHeader title="Alapadatok" />
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
          <ReadField
            label="Tulajdon"
            value={OWNERSHIP_LABEL[detail.ownershipType]}
          />
          {detail.ownershipType === "CUSTOMER" ? (
            <>
              <ReadField label="Ügyfél" value={detail.customerName} />
              <ReadField label="Helyszín" value={detail.departmentName} />
            </>
          ) : null}
          <ReadField
            label="Akvárium vagy tó"
            value={WATER_BODY_LABEL[detail.waterBodyType]}
          />
          <ReadField
            label="Víztípus"
            value={
              detail.waterType ? WATER_TYPE_LABEL[detail.waterType] : undefined
            }
          />
          <ReadField
            label="Indítás dátuma"
            value={
              detail.startedAt
                ? formatDayHu(detail.startedAt.slice(0, 10))
                : undefined
            }
          />
          <ReadField label="Megjegyzés" value={detail.notes} wide />
        </dl>
        {ownerExtra ? <div className="px-5 pb-5">{ownerExtra}</div> : null}
      </PilotCard>

      <PilotCard>
        <PilotCardHeader title="Méretek" />
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
          <ReadField
            label="Hossz × szélesség × magasság"
            value={
              dimensions.every((d) => d != null)
                ? `${dimensions.map((d) => formatNumber(d!)).join(" × ")} cm`
                : undefined
            }
          />
          <ReadField
            label="Térfogat"
            value={
              detail.systemVolumeLiters != null
                ? `${formatNumber(detail.systemVolumeLiters, 1)} l (${
                    detail.systemVolumeIsManual
                      ? "kézzel megadva"
                      : "a méretekből számolva"
                  })`
                : undefined
            }
          />
        </dl>
      </PilotCard>

      <PilotCard>
        <PilotCardHeader title="Karbantartók" />
        <div className="p-5">
          {detail.maintainers.length ? (
            <ul className="flex flex-wrap gap-3">
              {detail.maintainers.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-2 text-sm text-pilot-grey-800"
                >
                  <PilotAvatar
                    initials={pilotInitials(m.displayName || "?")}
                    color={pilotAvatarColor(m.userId)}
                    size="sm"
                  />
                  {m.displayName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pilot-grey-500">
              Nincs kijelölt karbantartó.
            </p>
          )}
        </div>
      </PilotCard>

      <PilotCard>
        <PilotCardHeader title="Berendezések" />
        <div className="divide-y divide-pilot-grey-100 px-5 py-2">
          {detail.equipment.length ? (
            detail.equipment.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-4 py-2.5"
              >
                <span className="text-xs font-medium text-pilot-grey-400">
                  {EQUIPMENT_KIND_LABEL[row.kind]}
                </span>
                <span className="text-sm text-pilot-grey-700">
                  {row.manufacturer ?? "—"}
                  {row.model ? ` · ${row.model}` : ""}
                </span>
                <span className="font-mono text-xs text-pilot-grey-400">
                  {row.quantity} db
                  {row.channelCount ? ` · ${row.channelCount} csat.` : ""}
                </span>
              </div>
            ))
          ) : (
            <p className="py-3 text-sm text-pilot-grey-500">
              Nincs felvitt berendezés.
            </p>
          )}
        </div>
      </PilotCard>
    </div>
  );
}

/**
 * A BEÁLLÍTOTT CÉLTARTOMÁNYOK OLVASVA (Picasso 3.22): csak az akvárium saját, tárolt tartományai, nem a tizennégy üres mező. Egy csak
 * alsó vagy csak felső határ is sor (`AquariumMeasurementTarget`).
 */
export function PilotAquariumTargetRangesRead({
  detail,
}: {
  detail: AquariumDetail;
}) {
  return (
    <PilotCard>
      <PilotCardHeader title="Vízérték céltartományok" />
      {detail.targets.length ? (
        <dl className="flex flex-col divide-y divide-pilot-grey-50 px-5 py-2">
          {detail.targets.map((target) => {
            const param = aquariumMeasurementParameter(target.parameterCode);
            const range =
              target.min !== undefined && target.max !== undefined
                ? `${formatNumber(target.min)} – ${formatNumber(target.max)}`
                : target.min !== undefined
                  ? `legalább ${formatNumber(target.min)}`
                  : `legfeljebb ${formatNumber(target.max!)}`;
            return (
              <div
                key={target.parameterCode}
                className="flex items-center gap-2 py-2 text-sm"
              >
                <dt className="min-w-0 flex-1 text-pilot-grey-600">
                  {param.label}
                </dt>
                <dd className="text-pilot-grey-900">
                  {range}{" "}
                  <span className="text-xs text-pilot-grey-400">
                    {param.unit}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="p-5 text-sm text-pilot-grey-500">
          Nincs saját céltartomány beállítva; a Szerkesztésben adható meg.
        </p>
      )}
    </PilotCard>
  );
}

function ReadField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs text-pilot-grey-400">{label}</dt>
      <dd
        className={`mt-0.5 text-sm ${value ? "text-pilot-grey-900" : "text-pilot-grey-400"}`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
