"use client";

import {
  Alert,
  ConfirmDialog,
  PilotButton,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import type { ProductImageSummary } from "@acropora/types";
import { useRef, useState } from "react";

import { productApi } from "@/lib/api/products";

import { ProductImage } from "./product-image-source";

/**
 * A KÉPEK ALT-SZÖVEGE ÉS SORRENDJE (T4.1-D3, 4. szelet). Csak OS-gazdájú terméknél
 * jelenik meg: UNAS-gazdánál a szinkron minden futásnál újraírja a képeket. Az üres
 * alt nem hiba: akkor a kirakat a termék nevét adja (a polip D3 szerinti gépi
 * alapérték). A sorrend a fel/le gombra azonnal mentődik, mert a szerver csak a
 * teljes, pontos sorrendet fogadja el.
 *
 * FELTÖLTÉS ÉS TÖRLÉS (6. szelet): a feltöltött kép a lista végére kerül, a
 * szerver a tartalmából ismeri fel (JPEG, PNG, GIF, WebP). A törlés előtt a közös
 * megerősítés kérdez, mert nem visszavonható: a fájl is megy, és a boltból a
 * következő vetítés veszi ki.
 */
export function ProductImagesEditor({
  productId,
  productName,
  images,
  token,
  onSaved,
}: {
  productId: string;
  productName: string;
  images: ProductImageSummary[];
  token: string;
  onSaved: () => void;
}) {
  const [alts, setAlts] = useState<Record<string, string>>(() =>
    Object.fromEntries(images.map((image) => [image.id, image.altText ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = images.map((image) => image.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void run(() => productApi.setImageOrder(token, productId, ids));
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      try {
        await productApi.uploadImage(token, productId, file);
      } finally {
        if (fileInput.current) fileInput.current.value = "";
      }
    });
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert
          variant="danger"
          title="A kép nem mentődött"
          description={error}
        />
      ) : null}
      <ol className="space-y-4">
        {images.map((image, index) => {
          const alt = alts[image.id] ?? "";
          const changed = alt.trim() !== (image.altText ?? "");
          return (
            <li
              key={image.id}
              className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
            >
              <ProductImage
                token={token}
                productId={productId}
                image={image}
                alt={image.altText ?? productName}
                className="aspect-[156/112] w-full rounded-lg border border-pilot-grey-200 object-cover"
              />
              <div className="min-w-0 space-y-2">
                <PilotFormField
                  label={`${index + 1}. kép alt-szövege`}
                  help="Üresen a kirakat a termék nevét írja ki."
                >
                  <PilotInput
                    value={alt}
                    onChange={(value) =>
                      setAlts((current) => ({ ...current, [image.id]: value }))
                    }
                    placeholder={productName}
                    aria-label={`${index + 1}. kép alt-szövege`}
                  />
                </PilotFormField>
                <div className="flex flex-wrap gap-2">
                  <PilotButton
                    variant="secondary"
                    disabled={busy || !changed}
                    onClick={() =>
                      void run(() =>
                        productApi.setImageAlt(token, productId, image.id, alt),
                      )
                    }
                  >
                    Alt mentése
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    disabled={busy || index === 0}
                    aria-label={`${index + 1}. kép előrébb`}
                    onClick={() => move(index, -1)}
                  >
                    Előrébb
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    disabled={busy || index === images.length - 1}
                    aria-label={`${index + 1}. kép hátrébb`}
                    onClick={() => move(index, 1)}
                  >
                    Hátrébb
                  </PilotButton>
                  <PilotButton
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${index + 1}. kép törlése`}
                    onClick={() => setConfirmingDelete(image.id)}
                  >
                    Törlés
                  </PilotButton>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <ConfirmDialog
        open={confirmingDelete !== null}
        title="Törlöd a képet?"
        consequence="A kép és a tárolt fájlja törlődik; a boltból a következő vetítés veszi ki."
        recovery="Nem vonható vissza: a képet újra fel kell tölteni."
        confirmLabel="Kép törlése"
        busy={busy}
        onCancel={() => setConfirmingDelete(null)}
        onConfirm={() => {
          const imageId = confirmingDelete;
          if (!imageId) return;
          void run(async () => {
            await productApi.deleteImage(token, productId, imageId);
            setConfirmingDelete(null);
          });
        }}
      />
      {images.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">Nincs termékkép.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="sr-only"
          aria-label="Kép feltöltése"
          onChange={(event) => upload(event.target.files?.[0])}
        />
        <PilotButton
          variant="secondary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Kép feltöltése
        </PilotButton>
        <p className="text-xs text-pilot-grey-500">
          JPEG, PNG, GIF vagy WebP, legfeljebb 10 MB. A lista végére kerül.
        </p>
      </div>
    </div>
  );
}
