"use client";

import type {
  ArticleDiffField,
  ArticleDiffSide,
  ArticleRevisionDiff,
  ArticleRevisionSummary,
} from "@acropora/types";
import { Alert, Button, Skeleton } from "@acropora/ui";
import { useEffect, useRef, useState } from "react";

import { contentApi } from "@/lib/api/content";

/**
 * A CIKK JÓVÁHAGYOTT VÁLTOZATAI ÉS AZ ÖSSZEVETÉSÜK (kutatási terv v4, 9.2 S5:
 * „két egymás utáni változat különbsége megjeleníthető”). Minden változat az
 * előzőhöz, a legutóbbi a mostani, MENTETT szöveghez is összevethető. A törzs
 * bekezdésenként, a megváltozott bekezdés szavanként jelölve; a többi
 * nyilvános mező csak ha eltér.
 */

const FIELD_LABELS: Record<ArticleDiffField, string> = {
  title: "Cím",
  excerpt: "Bevezető",
  byline: "Szerző",
  seoTitle: "SEO cím",
  metaDescription: "Meta leírás",
  coverImageUrl: "Borítókép címe",
  coverImageAlt: "Borítókép leírása",
  ogImageUrl: "Megosztási kép",
  channels: "Csatornák",
  noindex: "Rejtve a keresők elől",
};

const dateTime = (iso: string) => new Date(iso).toLocaleString("hu-HU");

function sideLabel(side: ArticleDiffSide): string {
  return side.kind === "current"
    ? "a mostani, mentett szöveg"
    : `a ${dateTime(side.approvedAt)} változat`;
}

export function ArticleRevisionDiffView({
  diff,
}: {
  diff: ArticleRevisionDiff;
}) {
  if (diff.identical)
    return (
      <p className="text-sm text-dusk-600">
        A két változat szövege és mezői azonosak.
      </p>
    );
  return (
    <div className="space-y-3 text-sm">
      {diff.fields.length ? (
        <dl className="space-y-1">
          {diff.fields.map((f) => (
            <div key={f.field}>
              <dt className="font-medium text-dusk-800">
                {FIELD_LABELS[f.field]}
              </dt>
              <dd>
                <del className="bg-red-50 text-red-800">
                  {f.before || "(üres)"}
                </del>
                {" → "}
                <ins className="bg-green-50 text-green-800 no-underline">
                  {f.after || "(üres)"}
                </ins>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="space-y-2" aria-label="A törzs különbsége">
        {diff.body.map((block, index) => {
          if (block.kind === "changed")
            return (
              <p key={index} data-diff="changed">
                {block.segments.map((s, k) =>
                  s.kind === "added" ? (
                    <ins
                      key={k}
                      className="bg-green-100 text-green-900 no-underline"
                    >
                      {s.text}
                    </ins>
                  ) : s.kind === "removed" ? (
                    <del key={k} className="bg-red-100 text-red-900">
                      {s.text}
                    </del>
                  ) : (
                    <span key={k}>{s.text}</span>
                  ),
                )}
              </p>
            );
          if (block.kind === "added")
            return (
              <p
                key={index}
                data-diff="added"
                className="bg-green-50 text-green-900"
              >
                <span className="sr-only">Új bekezdés: </span>
                {block.text}
              </p>
            );
          if (block.kind === "removed")
            return (
              <p
                key={index}
                data-diff="removed"
                className="bg-red-50 text-red-900 line-through"
              >
                <span className="sr-only">Törölt bekezdés: </span>
                {block.text}
              </p>
            );
          return (
            <p key={index} data-diff="same" className="text-dusk-500">
              {block.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function ArticleRevisions({
  token,
  contentId,
  revisions,
  approvedRevisionId,
  publishedRevisionId,
  dirty,
}: {
  token: string;
  contentId: string;
  /** Newest first, as the server lists them. */
  revisions: readonly ArticleRevisionSummary[];
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  /** Unsaved edits: the comparison reads the saved text, and says so. */
  dirty: boolean;
}) {
  const [diff, setDiff] = useState<ArticleRevisionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the request in flight: a newer click cancels it, so a slower, older
  // answer never overwrites the newer one (barracuda on #1920, note 2)
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const compare = (from: string, to: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);
    setDiff(null);
    contentApi
      .articleDiff(token, contentId, from, to, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDiff(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Az összevetés nem sikerült.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  };

  if (!revisions.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-dusk-800">
        Jóváhagyott változatok
      </h2>
      <ul className="space-y-1 text-sm text-dusk-600">
        {revisions.map((revision, index) => {
          const older = revisions[index + 1];
          return (
            <li key={revision.id} className="flex flex-wrap items-center gap-2">
              <span>
                {dateTime(revision.approvedAt)}
                {revision.id === publishedRevisionId
                  ? " · ez látszik"
                  : revision.id === approvedRevisionId
                    ? " · jóváhagyva, még nem közzétéve"
                    : ""}
              </span>
              {older ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => compare(older.id, revision.id)}
                >
                  Az előzőhöz képest
                </Button>
              ) : null}
              {index === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => compare(revision.id, "current")}
                >
                  A mostani szöveghez képest
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {loading ? <Skeleton className="h-16 w-full" /> : null}
      {error ? (
        <Alert
          variant="danger"
          title="Az összevetés nem sikerült"
          description={error}
        />
      ) : null}
      {diff ? (
        <div className="space-y-2 rounded-lg border border-pilot-grey-200 bg-white p-3">
          <p className="text-xs text-dusk-600">
            Mi változott {sideLabel(diff.from)} és {sideLabel(diff.to)} között.
            {diff.to.kind === "current" && dirty
              ? " A még nem mentett módosítások nincsenek benne."
              : ""}
          </p>
          <ArticleRevisionDiffView diff={diff} />
        </div>
      ) : null}
    </section>
  );
}
