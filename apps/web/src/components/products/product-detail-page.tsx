"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductDetail,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { productApi } from "@/lib/api/products";

export function ProductDetailPage({ productId }: { productId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );

  useEffect(() => {
    if (!canView || !session?.token) return;
    let active = true;
    setError(null);
    void productApi
      .detail(session.token, productId)
      .then((response) => {
        if (active) setProduct(response);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "A termék betöltése nem sikerült.",
          );
      });
    return () => {
      active = false;
    };
  }, [canView, productId, requestVersion, session?.token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );
  }

  if (error) {
    return (
      <Alert
        variant="danger"
        title="A termék nem tölthető be"
        description={error}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRequestVersion((value) => value + 1)}
          >
            Újrapróbálás
          </Button>
        }
      />
    );
  }

  if (!product) {
    return (
      <div className="space-y-6" aria-label="Termék betöltése">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={product.primarySku ?? "Nincs SKU"}
        title={product.name}
        description={product.description ?? "Ehhez a termékhez nincs leírás."}
        actions={
          <Button variant="secondary" onClick={() => router.push("/products")}>
            Vissza a listához
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Változatok és SKU-k
              </h2>
            </CardHeader>
            <div className="divide-y divide-slate-100">
              {product.variants.length ? (
                product.variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {variant.name ?? product.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {variant.sku}
                      </p>
                    </div>
                    <Badge variant={variant.isActive ? "success" : "neutral"}>
                      {variant.isActive ? "Aktív" : "Inaktív"}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="px-5 py-5 text-sm text-slate-500">
                  Nincs rögzített változat.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Képek</h2>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {product.images.length ? (
                product.images.map((image) => (
                  <figure key={image.id}>
                    <img
                      src={image.url}
                      alt={image.altText ?? product.name}
                      className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                    />
                    {image.title ? (
                      <figcaption className="mt-2 text-xs text-slate-500">
                        {image.title}
                      </figcaption>
                    ) : null}
                  </figure>
                ))
              ) : (
                <p className="text-sm text-slate-500">Nincs termékkép.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Alapadatok
              </h2>
              <Badge variant={product.isActive ? "success" : "neutral"}>
                {product.isActive ? "Aktív" : "Archivált"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-400">Márka</p>
                <p className="mt-1 text-slate-800">
                  {product.brand?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Kategóriák</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {product.categories.length ? (
                    product.categories.map((category) => (
                      <Badge
                        key={category.id}
                        variant={category.isPrimary ? "info" : "neutral"}
                      >
                        {category.name}
                        {category.isPrimary ? " · elsődleges" : ""}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Csatornák
              </h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {product.channelListings.length ? (
                product.channelListings.map((listing) => (
                  <div
                    key={listing.channel}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <p className="text-sm font-semibold text-slate-800">
                      {listing.channel}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Nyers külső státusz: {listing.externalStatus ?? "—"}
                    </p>
                    {listing.productUrl ? (
                      <a
                        href={listing.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs font-semibold text-teal-700 hover:underline"
                      >
                        Webshop oldal megnyitása
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Nincs csatornalisting.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
