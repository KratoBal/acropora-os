"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoment } from "@/lib/labels";
import { formatValue, type SeriesPoint } from "@/lib/series";
import type { ReefClubMeasurementValue } from "@/lib/types";

/**
 * One parameter over time, with the range its newest value was judged against
 * as a band. The numbers are in the table beside it: the chart is a picture
 * of the same data, so it carries a text description for a reader without it.
 */
export function MeasurementChart({
  label,
  unit,
  points,
  target,
}: {
  label: string;
  unit: string;
  points: SeriesPoint[];
  target: ReefClubMeasurementValue["target"];
}) {
  if (points.length < 2)
    return (
      <p className="text-sm text-pilot-grey-600">
        A grafikonhoz legalább két mérés kell ennél a paraméternél ({label}).
      </p>
    );
  return (
    <figure>
      <div
        className="h-64 w-full"
        role="img"
        aria-label={`${label} alakulása: ${points.length} mérés`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(at: number) =>
                new Intl.DateTimeFormat("hu-HU", {
                  month: "numeric",
                  day: "numeric",
                }).format(new Date(at))
              }
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => formatValue(v)}
              width={48}
            />
            {target && (target.min !== null || target.max !== null) ? (
              <ReferenceArea
                y1={target.min ?? undefined}
                y2={target.max ?? undefined}
                fill="#34b0a4"
                fillOpacity={0.15}
                ifOverflow="extendDomain"
              />
            ) : null}
            <Tooltip
              labelFormatter={(at) =>
                formatMoment(new Date(Number(at)).toISOString())
              }
              formatter={(v) => [
                `${formatValue(Number(v))} ${unit}`.trim(),
                label,
              ]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#0b9487"
              strokeWidth={2}
              dot
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-pilot-grey-500">
        {label}
        {unit ? ` (${unit})` : ""}
        {target && (target.min !== null || target.max !== null)
          ? ` · sáv: ${target.min !== null ? formatValue(target.min) : "…"} – ${target.max !== null ? formatValue(target.max) : "…"}`
          : ""}
      </figcaption>
    </figure>
  );
}
