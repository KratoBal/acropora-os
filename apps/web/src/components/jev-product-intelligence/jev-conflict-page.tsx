"use client";

import { Alert, PilotPageHeader, PilotSection } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductEnrichmentFieldKey,
} from "@acropora/types";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotButton, PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { ApiError } from "@/lib/api/client";
import { productApi } from "@/lib/api/products";

import {
  CONFLICT_RULE,
  CONFLICT_STATE_MESSAGE,
  conflictState,
  decisionLabels,
  explanationLines,
  isEnrichmentField,
} from "./jev-conflict";
import { disabledDecisionReason } from "./jev-decision-action";
import { JevStatusBadge } from "./jev-pill";
import { FIELD_LABEL } from "./jev-presentation";
import { reviewHref, type ReviewLoad } from "./jev-product-review";
import { JevReviewStateMessage } from "./jev-review-summary";
import { JevSourceCard } from "./jev-source-card";

/**
 * FORRÁSÜTKÖZÉS FELOLDÁSA: ONE FIELD'S CONFLICT (Figma 394:196,
 * `/products/[id]/adatellenorzes/[field]`, discovery Q1 and §9).
 *
 * The sources side by side, why JEV did not decide, and the decisions a
 * person could take, every one disabled with its reason: no write contract
 * is authorized, nothing is written. Read from `GET /products/:id/enrichment`
 * like the review page; with no persisted run the honest state stands in
 * place of the cards.
 */
export function JevConflictPage({
  productId,
  field,
}: {
  productId: string;
  field: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const known = isEnrichmentField(field);
  const [load, setLoad] = useState<ReviewLoad>({ kind: "loading" });
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!canView || !known) return;
    let active = true;
    setLoad({ kind: "loading" });
    setNotFound(false);
    productApi
      .enrichment(token, productId)
      .then((review) => active && setLoad({ kind: "ready", review }))
      .catch((cause: unknown) => {
        if (!active) return;
        setNotFound(cause instanceof ApiError && cause.status === 404);
        setLoad({ kind: "error" });
      });
    return () => {
      active = false;
    };
    // `token` is read, not watched: the session object changes identity
  }, [canView, known, productId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );

  const back = (
    <Link
      href={reviewHref(productId)}
      className="inline-flex items-center gap-1 rounded-[10px] border border-pilot-grey-300 bg-white px-3 py-2 text-sm font-medium text-pilot-grey-900 hover:bg-pilot-grey-50"
    >
      <span aria-hidden="true">←</span>
      Vissza az adatellenőrzéshez
    </Link>
  );
  const header = (
    <PilotPageHeader
      eyebrow="Termékek / JEV"
      title="Forrásütközés feloldása"
      description="JEV · mezőszintű ütközés és a források eredete"
      actions={back}
    />
  );

  if (!known)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        {header}
        <Alert
          variant="danger"
          title="Ismeretlen mező"
          description="Ez a mező nem szerepel a JEV által vizsgált termékadatok között."
        />
      </PilotThemeRoot>
    );

  return (
    <JevConflictBody
      header={header}
      field={field}
      load={load}
      notFound={notFound}
      canManage={canManage}
    />
  );
}

function JevConflictBody({
  header,
  field,
  load,
  notFound,
  canManage,
}: {
  header: ReactNode;
  field: ProductEnrichmentFieldKey;
  load: ReviewLoad;
  notFound: boolean;
  canManage: boolean;
}) {
  const { state, review } = conflictState(load, field);
  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      {header}

      <section
        aria-label="Ütköző mező"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-pilot-grey-200 bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      >
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h2 className="text-sm font-semibold leading-5 text-pilot-grey-900">
            {FIELD_LABEL[field]} · forrásütközés
          </h2>
          <p className="text-sm leading-5 text-pilot-grey-600">
            A Jev nem választ automatikusan a források között.
          </p>
        </div>
        {review ? <JevStatusBadge status={review.status} /> : null}
      </section>

      {state === "conflict" && review ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {review.evidence.map((entry, index) => (
              <JevSourceCard
                key={`${entry.sourceType}-${index}`}
                entry={entry}
              />
            ))}
          </div>
          <PilotSection
            title="Miért nem döntött automatikusan?"
            subtitle={CONFLICT_RULE}
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-5 text-pilot-grey-700 marker:text-pilot-aqua-600">
              {explanationLines(review).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </PilotSection>
        </>
      ) : state === "loading" ? (
        <JevReviewStateMessage state="loading" />
      ) : notFound ? (
        <Alert
          variant="danger"
          title="A termék nem található"
          description="Lehet, hogy archiválták, vagy hibás a hivatkozás."
        />
      ) : (
        <>
          <p
            role={state === "error" ? "alert" : "status"}
            className={`rounded-[14px] border px-4 py-3 text-sm leading-5 ${
              state === "error"
                ? "border-pilot-red-100 bg-pilot-red-50 text-pilot-red-700"
                : "border-pilot-grey-200 bg-white text-pilot-grey-600"
            }`}
          >
            {
              CONFLICT_STATE_MESSAGE[
                state as keyof typeof CONFLICT_STATE_MESSAGE
              ]
            }
          </p>
          <PilotSection
            title="Miért nem döntött automatikusan?"
            subtitle={CONFLICT_RULE}
          >
            <p className="text-sm leading-5 text-pilot-grey-600">
              A források értékei egy ellenőrzés után jelennek meg itt. A Jev nem
              írhatja felül csendben a termékadatot.
            </p>
          </PilotSection>
        </>
      )}

      <PilotSection
        title="Emberi döntés"
        subtitle="A kiválasztott érték csak jóváhagyás után kerülhet a terméktörzsbe."
      >
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            {decisionLabels(state === "conflict" ? review : null).map(
              (label, index) => (
                <PilotButton
                  key={label}
                  size="regular"
                  variant={
                    index === 0 && state === "conflict"
                      ? "primary"
                      : "secondary"
                  }
                  disabled
                  title={disabledDecisionReason(canManage)}
                >
                  {label}
                </PilotButton>
              ),
            )}
          </div>
          <p className="text-xs leading-4 text-pilot-grey-500">
            {disabledDecisionReason(canManage)}
          </p>
        </div>
      </PilotSection>
    </PilotThemeRoot>
  );
}
