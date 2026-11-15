"use client";

import type { ContentState, TeachingSourceListItem } from "@acropora/types";
import { Alert, PageHeader, PilotBadge, Skeleton } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";

import { CONTENT_STATE_LABELS } from "./content-labels";

/**
 * AZ OKTATÓANYAG-FORRÁSOK LISTÁJA (T5.2, spec v2 4. pont): cím, verzió,
 * felhasználási kör, és a kimenetek állapota a spec szavaival: naprakész,
 * elavult, eltér a forrástól, keret felett, és a forrás nyitott kérdései.
 * Egy sor a forrás-lapra visz. Saját Figma nincs (a Tartalom sora „nincs").
 */
export function TeachingSourceListPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [items, setItems] = useState<TeachingSourceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    contentApi
      .teachingSources(token, controller.signal)
      .then(setItems)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error ? cause.message : "A lista nem tölthető be.",
        );
      });
    return () => controller.abort();
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tartalom" className="text-xs text-pilot-grey-600">
          ← Tartalom
        </Link>
        <PageHeader
          title="Oktatóanyagok"
          description="Egy forrás, több kimenet: a források és a kimeneteik állapota."
        />
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="A lista nem tölthető be"
          description={error}
        />
      ) : items === null ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <p className="text-sm text-pilot-grey-600">
          Még nincs oktatóanyag. Új tételt a Tartalom lapon, az Oktatóanyag
          csatornával lehet felvenni.
        </p>
      ) : (
        <ul className="divide-y divide-pilot-grey-200 rounded-lg border border-pilot-grey-200">
          {items.map((item) => (
            <li key={item.contentId} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/tartalom/${encodeURIComponent(item.contentId)}/forras`}
                  className="font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
                <span className="text-pilot-grey-600">
                  {CONTENT_STATE_LABELS[item.state as ContentState] ??
                    item.state}
                  {item.version !== null
                    ? ` · ${item.version}. verzió`
                    : " · még nincs forrása"}
                  {item.audience
                    ? ` · ${item.audience === "PUBLIC" ? "nyilvános" : "belső"}`
                    : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.openQuestions ? (
                  <PilotBadge variant="amber">
                    {item.openQuestions} nyitott kérdés
                  </PilotBadge>
                ) : null}
                {item.outputs.total === 0 ? (
                  <PilotBadge variant="grey">nincs kimenet</PilotBadge>
                ) : (
                  <>
                    {item.outputs.current ? (
                      <PilotBadge variant="success">
                        {item.outputs.current} naprakész
                      </PilotBadge>
                    ) : null}
                    {item.outputs.stale ? (
                      <PilotBadge variant="amber">
                        {item.outputs.stale} elavult
                      </PilotBadge>
                    ) : null}
                    {item.outputs.withdrawn ? (
                      <PilotBadge variant="amber">
                        {item.outputs.withdrawn} visszavont jóváhagyású
                      </PilotBadge>
                    ) : null}
                    {item.outputs.awaitingDecision ? (
                      <PilotBadge variant="amber">
                        {item.outputs.awaitingDecision} szerkesztett változat
                        döntésre vár
                      </PilotBadge>
                    ) : null}
                    {item.outputs.overFrame ? (
                      <PilotBadge variant="amber">
                        {item.outputs.overFrame} keret felett
                      </PilotBadge>
                    ) : null}
                    {item.outputs.sent ? (
                      <PilotBadge variant="teal">
                        {item.outputs.sent} kiment
                      </PilotBadge>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
