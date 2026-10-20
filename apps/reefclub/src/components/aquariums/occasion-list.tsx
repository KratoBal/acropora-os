"use client";

import { Badge, Button } from "@acropora/ui";
import { useState } from "react";

import { formatMoment } from "@/lib/labels";
import {
  DIRECTION_LABEL,
  formatValue,
  parameterLabel,
  STATUS_LABEL,
  TREND_LABEL,
} from "@/lib/series";
import type { ReefClubMeasurementValue, ReefClubOccasion } from "@/lib/types";

const STATUS_VARIANT = {
  OK: "success",
  WARN: "warning",
  ALERT: "danger",
} as const;

/**
 * The occasions, newest first, one card each: a table would scroll sideways on
 * a phone. Status, direction and trend are the server's words for the value
 * (the shared rule of the OS), shown as they are.
 */
export function OccasionList({
  occasions,
  canDelete,
  onDelete,
}: {
  occasions: ReefClubOccasion[];
  /** Only the account's own manual occasions (the server refuses the rest with 404). */
  canDelete: boolean;
  onDelete(occasion: ReefClubOccasion): Promise<void>;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (occasions.length === 0)
    return (
      <p className="text-sm text-pilot-grey-600">
        Még nincs mérés ennél az akváriumnál.
      </p>
    );

  return (
    <ul className="space-y-3">
      {occasions.map((occasion) => (
        <li
          key={occasion.id}
          className="rounded-xl border border-line bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {formatMoment(occasion.measuredAt)}{" "}
              <Badge variant={occasion.source === "SHOP" ? "info" : "neutral"}>
                {occasion.source === "SHOP" ? "Bolti mérés" : "Saját mérés"}
              </Badge>
            </p>
            {canDelete && occasion.source === "MANUAL" ? (
              asking === occasion.id ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-pilot-grey-600">
                    Törlöd ezt a mérést?
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void onDelete(occasion).finally(() => {
                        setBusy(false);
                        setAsking(null);
                      });
                    }}
                  >
                    Igen, törlöm
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAsking(null)}
                  >
                    Mégse
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setAsking(occasion.id)}
                >
                  Törlés
                </Button>
              )
            ) : null}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {occasion.values.map((value) => (
              <ValueRow key={value.parameterCode} value={value} />
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function ValueRow({ value }: { value: ReefClubMeasurementValue }) {
  const range =
    value.target && (value.target.min !== null || value.target.max !== null)
      ? `${value.target.min !== null ? formatValue(value.target.min) : "…"} – ${value.target.max !== null ? formatValue(value.target.max) : "…"}`
      : null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-line/60 pb-1 text-sm">
      <dt className="text-pilot-grey-600">
        {parameterLabel(value.parameterCode)}
      </dt>
      <dd className="flex flex-wrap items-center gap-2">
        <strong>
          {formatValue(value.value)} {value.unit}
        </strong>
        {value.status ? (
          <Badge variant={STATUS_VARIANT[value.status]}>
            {STATUS_LABEL[value.status]}
          </Badge>
        ) : null}
        {value.direction ? (
          <span className="text-xs text-pilot-grey-500">
            {DIRECTION_LABEL[value.direction]}
          </span>
        ) : null}
        {value.trend ? (
          <span className="text-xs text-pilot-grey-500">
            {TREND_LABEL[value.trend]}
          </span>
        ) : null}
        {range ? (
          <span className="text-xs text-pilot-grey-500">sáv: {range}</span>
        ) : null}
      </dd>
    </div>
  );
}
