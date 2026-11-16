"use client";

import type {
  ReefClubWaterHintRow,
  ReefClubWaterHints,
  ReefClubWaterHintStatus,
} from "@acropora/types";
import { Alert, Badge } from "@acropora/ui";

import { rc } from "@/lib/api";
import { formatMoment } from "@/lib/labels";
import type { ReefClubAquarium } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const STATUS_LABEL: Record<
  ReefClubWaterHintStatus,
  { text: string; variant: "success" | "warning" | "danger" | "neutral" }
> = {
  ALATTA: { text: "Alatta", variant: "warning" },
  FELETTE: { text: "Felette", variant: "warning" },
  TARTOMANYBAN: { text: "Rendben", variant: "success" },
  TUL_REGI: { text: "Régi mérés", variant: "neutral" },
};

/**
 * A "MI LÓG KI" PANEL (card ce6c5cc9, V3.4 S3; the API is `GET .../water-hints`). The page reads and shows: every sentence, band and
 * disclaimer comes from the server, which is rule-based and has no AI; the page adds nothing of its own to a value or to a product.
 *
 * WHAT IT DOES NOT SHOW: nothing while loading or when the server says `OFF` (the feature is switched off by default, and the customer
 * text template is Balázs's: a switched-off panel is not an empty box); a failed load is hidden too, because a hint that cannot be
 * read is no hint (the rest of the page does not depend on it). For a deviation without a product, the page says so in plain words:
 * the empty list is not a recommendation. THE MAKER'S REFERENCE is the link a customer gets about a product (no dosing sentence of ours),
 * and the shop page is a second link; both open in a new tab without handing the page over (`noopener noreferrer`).
 */
export function WaterHintsPanel({ aquarium }: { aquarium: ReefClubAquarium }) {
  const hints = useLoad(() =>
    rc<ReefClubWaterHints>(
      "GET",
      `/aquariums/${encodeURIComponent(aquarium.id)}/water-hints`,
    ),
  );
  if (hints.state.status !== "ready") return null;
  const data = hints.state.data;
  if (data.state === "OFF") return null;

  return (
    <section aria-labelledby="water-hints-title" className="space-y-3">
      <h2 id="water-hints-title" className="text-lg font-semibold">
        Mi lóg ki?
      </h2>

      {data.state === "NOT_AVAILABLE" ? (
        <p className="text-sm text-pilot-grey-600">
          Ehhez az akváriumhoz most nincs ajánlott tartomány: ezt csak tengeri
          vízre tudjuk megmondani.
        </p>
      ) : null}
      {data.state === "NO_MEASUREMENT" ? (
        <p className="text-sm text-pilot-grey-600">
          Még nincs mérésed KH-ra, kalciumra, magnéziumra vagy nitrátra.
        </p>
      ) : null}

      {data.state === "OK" ? (
        <>
          {data.productsState === "STALE" ? (
            <Alert
              variant="info"
              title="A termékajánló most nem elérhető"
              description="A termékek listája nem friss, ezért most nem nevezünk meg terméket."
            />
          ) : null}
          <ul className="space-y-3">
            {data.rows.map((row) => (
              <HintRow
                key={row.parameterCode}
                row={row}
                productsState={data.productsState}
              />
            ))}
          </ul>
          {data.disclaimer ? (
            <p className="text-xs text-pilot-grey-500">{data.disclaimer}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function HintRow({
  row,
  productsState,
}: {
  row: ReefClubWaterHintRow;
  productsState: ReefClubWaterHints["productsState"];
}) {
  const status = STATUS_LABEL[row.status];
  const deviating = row.status === "ALATTA" || row.status === "FELETTE";
  return (
    <li
      data-testid="water-hint"
      className="space-y-2 rounded-xl border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{row.label}</span>
        <Badge variant={status.variant}>{status.text}</Badge>
        <span className="text-xs text-pilot-grey-500">
          Mérve: {formatMoment(row.measuredAt)}
        </span>
      </div>
      <p className="text-sm">{row.text}</p>

      {deviating && row.products.length > 0 ? (
        <ul className="space-y-2" aria-label={`${row.label}: termékek`}>
          {row.products.map((product) => (
            <li
              key={product.productId}
              className="rounded-lg bg-pilot-grey-50 p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {product.shopUrl ? (
                  <a
                    href={product.shopUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    {product.name}
                  </a>
                ) : (
                  <span className="font-medium">{product.name}</span>
                )}
                <a
                  href={product.referenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                >
                  {product.referenceKind === "SHOP_TEXT"
                    ? "Termékleírás a boltban"
                    : "Gyártói leírás"}
                </a>
              </div>
              {product.sideEffectsText ? (
                <p className="text-xs text-pilot-grey-600">
                  {product.sideEffectsText}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {deviating && row.products.length === 0 && productsState !== "STALE" ? (
        <p className="text-xs text-pilot-grey-500">
          Ehhez az értékhez most nincs ajánlott termék a listánkban.
        </p>
      ) : null}
    </li>
  );
}
