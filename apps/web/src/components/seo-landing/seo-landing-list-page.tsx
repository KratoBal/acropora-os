"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type SeoLandingPage,
} from "@acropora/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { seoLandingPagesApi } from "@/lib/api/seo-landing-pages";

export const SEO_LANDING_LIST_PATH = "/admin/valogatasok";

/**
 * THE SEO LANDING PAGES (SEO P1-14): each one a curated product list at
 * `/hu/valogatas/{slug}` in the shop. The list shows the address and whether
 * it is published; editing is on the page itself.
 */
export function SeoLandingListPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [pages, setPages] = useState<SeoLandingPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    seoLandingPagesApi
      .list(token, controller.signal)
      .then(setPages)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A válogatások nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [canView, token]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed"
        description="products.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop válogatások"
        description="Kiemelt termékválogatások saját címmel a webshopban: /hu/valogatas/…"
        actions={
          canManage ? (
            <Link href={`${SEO_LANDING_LIST_PATH}/new`}>
              <Button>Új válogatás</Button>
            </Link>
          ) : null
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A válogatások nem tölthetők be"
          description={error}
        />
      ) : null}
      {!pages && !error ? <Skeleton className="h-48" /> : null}
      {pages && !pages.length ? (
        <EmptyState
          title="Még nincs válogatás"
          description="Egy válogatás néhány kategória vagy márka termékeit mutatja saját címen."
        />
      ) : null}
      {pages && pages.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
              <tr>
                <th className="p-3">Válogatás</th>
                <th>Cím a webshopban</th>
                <th>Állapot</th>
                <th>Frissítve</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      className="font-semibold text-brand-700"
                      href={`${SEO_LANDING_LIST_PATH}/${page.id}`}
                    >
                      {page.title}
                    </Link>
                  </td>
                  <td className="text-dusk-600">/hu/valogatas/{page.slug}</td>
                  <td>
                    <Badge variant={page.isPublished ? "success" : "neutral"}>
                      {page.isPublished ? "Közzétéve" : "Vázlat"}
                    </Badge>
                  </td>
                  <td>
                    {new Date(page.updatedAt).toLocaleDateString("hu-HU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
