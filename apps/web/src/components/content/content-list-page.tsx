"use client";

import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ContentListItem,
  type ContentViewerRole,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentApi } from "@/lib/api/content";
import {
  CONTENT_ROLE_LABELS,
  CONTENT_STATE_LABELS,
  CONTENT_WAITS_ON_LABELS,
  contentImageLabel,
} from "./content-labels";

const ROLES: ContentViewerRole[] = ["approver", "reviewer", "author", "sender"];

/**
 * A TARTALOM-SOR LISTÁJA: ami RÁM vár.
 *
 * EZ AZ ELSŐ SZELET, ÉS SZÁNDÉKOSAN ENNYI. Balázs panasza nem a jóváhagyásról
 * szólt, hanem arról, hogy sem ő, sem Luca nem látja, mi készült el és mi vár
 * rájuk. Egy működő lista ezt megoldja; a naptár nézet szép, de nem az a
 * fájdalom, és külön szelet.
 *
 * AZ ALAPÉRTELMEZETT SZEREP A `approver`, nem a `author`. Aki ezt az oldalt
 * először megnyitja, az a két nevesített ember egyike lesz, és nekik a
 * jóváhagyásra váró sor a kérdés. Egy szerző-nézet alapból üres listát adna
 * nekik, és az pontosan az a benyomás, amitől az egész felület készül.
 */
export function ContentListPage() {
  const { session } = useAuth();
  const [role, setRole] = useState<ContentViewerRole>("approver");
  const [items, setItems] = useState<ContentListItem[] | null>(null);
  const [waitingForImage, setWaitingForImage] = useState<
    ContentListItem[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_VIEW),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        // A KÉT LEKÉRDEZÉS KÜLÖN MEGY, mert két különböző kérdés: az egyik a
        // szöveg útja, a másik a képé. Egy összevont hívás a kettőt egy
        // listává mosná, és épp az a hat poszt tűnne el benne, ami ma hetek
        // óta kizárólag fotóra vár.
        const [waiting, images] = await Promise.all([
          contentApi.waiting(token, role, signal),
          contentApi.waitingForImage(token, signal),
        ]);
        setItems(waiting);
        setWaitingForImage(images);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A tartalom-lista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, role, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView) {
    return (
      <Alert
        title="Nincs jogosultságod"
        description="A tartalom-sor megtekintéséhez content.view jog kell."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tartalom"
        description="Ami rád vár, és ami képre vár."
      />

      <label className="block space-y-1">
        <span className="text-sm font-medium">Kinek a szemével</span>
        <Select
          value={role}
          onChange={(event) => setRole(event.target.value as ContentViewerRole)}
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {CONTENT_ROLE_LABELS[value]}
            </option>
          ))}
        </Select>
      </label>

      {error ? (
        <Alert
          variant="danger"
          title="A lista nem tölthető be"
          description={error}
        />
      ) : null}

      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <ContentSection
            title={CONTENT_ROLE_LABELS[role]}
            items={items ?? []}
            empty="Ebben a nézetben most nincs tétel."
          />
          {/*
            A KÉPRE VÁRÓ LISTA KÜLÖN ÁLL, MINDIG. Nem a szerep-választótól függ:
            a kép Lucára vár, akárki írta a szöveget, és ma ez az a hat tétel,
            ami hetek óta mozdulatlan. Ha a szerep-szűrő elrejthetné, pontosan
            az veszne el, amiért a lista készült.
          */}
          <ContentSection
            title="Képre vár"
            items={waitingForImage ?? []}
            empty="Semmi nem vár képre."
          />
        </>
      )}
    </div>
  );
}

function ContentSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: ContentListItem[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <EmptyState
          title={empty}
          description="Ha ez váratlan, töltsd újra az oldalt."
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ContentRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContentRow({ item }: { item: ContentListItem }) {
  const image = contentImageLabel(item);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.title}</p>
        <p className="text-sm text-muted-foreground">
          {CONTENT_STATE_LABELS[item.state]} &middot; vár:{" "}
          {CONTENT_WAITS_ON_LABELS[item.state]}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={image.waiting ? "warning" : "neutral"}>
          {image.text}
        </Badge>
        {/*
          A TERVEZETT DÁTUM CSAK AKKOR JELENIK MEG, HA VAN. Egy „nincs dátum"
          felirat minden ötletnél ott állna, és a szemet elvonná arról a
          néhányról, aminek TÉNYLEG van határideje.
        */}
        {item.plannedFor ? (
          <Badge variant="neutral">
            {new Date(item.plannedFor).toLocaleDateString("hu-HU")}
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}
