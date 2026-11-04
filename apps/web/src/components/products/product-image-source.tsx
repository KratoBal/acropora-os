"use client";

import { useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * A FELTÖLTÖTT KÉP CÍME NEM WEBCÍM (T4.1-D3, 6. szelet): a szerver a `url`
 * mezőbe a tartalom lenyomatát írja (`os-upload:<sha256>`), a fájl a
 * dokumentum-tárolóban áll, és csak hitelesítve olvasható. A UNAS-ból jött kép
 * `url`-je továbbra is a webcíme.
 */
export const UPLOADED_IMAGE_URL_PREFIX = "os-upload:";

export function isUploadedImageUrl(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith(UPLOADED_IMAGE_URL_PREFIX));
}

/**
 * A kép megjeleníthető címe: a webcím változatlanul, a feltöltött képé a
 * letöltött fájl helyi címe (`blob:`), amit a lap elhagyásakor felszabadít.
 * Amíg nincs meg, vagy ha a letöltés nem sikerül, `undefined`: a hívó a saját
 * üres állapotát mutatja.
 */
export function useProductImageSrc(
  token: string,
  productId: string,
  image: { id: string; url: string } | null | undefined,
): string | undefined {
  const uploaded = isUploadedImageUrl(image?.url);
  const imageId = image?.id;
  const [blobUrl, setBlobUrl] = useState<string>();

  useEffect(() => {
    if (!uploaded || !imageId) return;
    let cancelled = false;
    let created: string | undefined;
    productApi
      .downloadImage(token, productId, imageId)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(undefined);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setBlobUrl(undefined);
    };
  }, [uploaded, token, productId, imageId]);

  if (!image) return undefined;
  return uploaded ? blobUrl : image.url;
}

/** Egy termékkép: a webcímről vagy, feltöltött képnél, a tárolóból. */
export function ProductImage({
  token,
  productId,
  image,
  alt,
  className,
}: {
  token: string;
  productId: string;
  image: { id: string; url: string };
  alt: string;
  className?: string;
}) {
  const src = useProductImageSrc(token, productId, image);
  if (!src)
    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className ?? ""} bg-pilot-grey-100`}
      />
    );
  return <img src={src} alt={alt} className={className} />;
}
