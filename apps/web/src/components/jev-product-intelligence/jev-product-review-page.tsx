"use client";

import { Alert, PilotPageHeader, PilotSection } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductDetail,
} from "@acropora/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  DESCRIPTION_HTML_CLASS,
  sanitizeDescriptionHtml,
} from "@/components/products/product-detail-page";
import { ApiError } from "@/lib/api/client";
import { productApi } from "@/lib/api/products";

import { conflictHref } from "./jev-conflict";
import { JevDisabledAction } from "./jev-decision-action";
import { JevFieldReviewRow } from "./jev-field-review-row";
import {
  JevHealthChips,
  JevReviewStateMessage,
  JevReviewSummary,
} from "./jev-review-summary";
import {
  currentProductData,
  productReviewSubtitle,
  reviewState,
  type ReviewLoad,
} from "./jev-product-review";

type ProductLoad =
  | { kind: "loading" }
  | { kind: "error"; notFound: boolean }
  | { kind: "ready"; product: ProductDetail };

/**
 * TERMÉKADAT-ELLENŐRZÉS: THE PRODUCT'S JEV REVIEW PAGE (Figma 394:18,
 * `/products/[id]/adatellenorzes`, discovery Q1).
 *
 * Left: what the product holds today, from the product detail (real data).
 * Right: the JEV review. With no persisted run it is honestly "unavailable"
 * (the server's switch is off) or "never checked"; an API failure is an
 * error, never a calm empty state. The review is read separately from the
 * product, so one failing does not hide the other.
 *
 * Every decision and run control is disabled with its reason in words: no
 * write contract and no execution endpoint is authorized (discovery §9.6).
 * No quality percentage (§9.2). Nothing on this page writes.
 */
export function JevProductReviewPage({ productId }: { productId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [product, setProduct] = useState<ProductLoad>({ kind: "loading" });
  const [review, setReview] = useState<ReviewLoad>({ kind: "loading" });

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setProduct({ kind: "loading" });
    setReview({ kind: "loading" });
    productApi
      .detail(token, productId)
      .then(
        (detail) => active && setProduct({ kind: "ready", product: detail }),
      )
      .catch(
        (cause: unknown) =>
          active &&
          setProduct({
            kind: "error",
            notFound: cause instanceof ApiError && cause.status === 404,
          }),
      );
    productApi
      .enrichment(token, productId)
      .then((result) => active && setReview({ kind: "ready", review: result }))
      .catch(() => active && setReview({ kind: "error" }));
    return () => {
      active = false;
    };
    // `token` is read, not watched: the session object changes identity
  }, [canView, productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const descriptionHtml = useMemo(
    () =>
      product.kind === "ready"
        ? sanitizeDescriptionHtml(product.product.description ?? "")
        : "",
    [product],
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );

  const backHref = `/products/${encodeURIComponent(productId)}`;
  const state = reviewState(review);
  const fields = review.kind === "ready" ? review.review.fields : [];
  const lastRun = review.kind === "ready" ? review.review.lastRun : null;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Termékek / JEV"
        title="Termékadat-ellenőrzés"
        description="A termék jelenlegi adatai és a JEV forrásalapú ellenőrzése"
        actions={
          <div className="flex flex-wrap items-start gap-3">
            <JevDisabledAction
              label="Újraellenőrzés"
              canManage={canManage}
              reason="Ellenőrzés indítása még nincs engedélyezve."
            />
            <JevDisabledAction
              label="Kijelölt módosítások alkalmazása"
              canManage={canManage}
              variant="primary"
            />
          </div>
        }
      />

      {product.kind === "error" ? (
        <Alert
          variant="danger"
          title={
            product.notFound
              ? "A termék nem található"
              : "A termék nem tölthető be"
          }
          description={
            product.notFound
              ? "Lehet, hogy archiválták, vagy hibás a hivatkozás."
              : "Próbáld újra később."
          }
        />
      ) : (
        <section
          aria-label="Termék"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-pilot-grey-200 bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        >
          {product.kind === "loading" ? (
            <div
              aria-busy="true"
              className="h-10 w-64 animate-pulse rounded bg-pilot-grey-100"
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-[3px]">
              <Link
                href={backHref}
                className="break-words text-sm font-semibold leading-5 text-pilot-grey-900 hover:underline"
              >
                {product.product.name}
              </Link>
              <p className="text-xs leading-4 text-pilot-grey-500">
                {productReviewSubtitle(product.product)}
              </p>
            </div>
          )}
          {fields.length ? <JevHealthChips fields={fields} /> : null}
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[498px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <PilotSection
            title="Jelenlegi termékadatok"
            subtitle="Az Acropora OS / UNAS jelenlegi értékei"
          >
            {product.kind === "ready" ? (
              <dl className="flex flex-col gap-3">
                {currentProductData(product.product).map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <dt className="shrink-0 text-xs leading-4 text-pilot-grey-500">
                      {row.label}
                    </dt>
                    <dd className="min-w-0 break-words text-right text-sm font-semibold leading-5 text-pilot-grey-900">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : product.kind === "loading" ? (
              <div
                aria-busy="true"
                className="h-32 animate-pulse rounded bg-pilot-grey-100"
              />
            ) : (
              <p className="text-sm text-pilot-grey-500">—</p>
            )}
          </PilotSection>
          <PilotSection
            title="Termékleírás"
            subtitle="Jelenlegi webshop / UNAS szöveg"
          >
            {product.kind === "ready" && descriptionHtml ? (
              <div
                className={DESCRIPTION_HTML_CLASS}
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : (
              <p className="text-sm text-pilot-grey-500">
                {product.kind === "loading"
                  ? "Betöltés…"
                  : "Ehhez a termékhez nincs leírás."}
              </p>
            )}
          </PilotSection>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {state === null && lastRun ? (
            <>
              <JevReviewSummary lastRun={lastRun} fields={fields} />
              {fields.map((field) => (
                <JevFieldReviewRow
                  key={field.field}
                  review={field}
                  conflictHref={conflictHref(productId, field.field)}
                />
              ))}
            </>
          ) : (
            <section
              aria-label="JEV termékadat-ellenőrzés"
              className="flex flex-col gap-3 rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
            >
              <h2 className="text-sm font-semibold leading-5 text-pilot-grey-900">
                JEV termékadat-ellenőrzés
              </h2>
              <JevReviewStateMessage state={state ?? "loading"} />
            </section>
          )}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
