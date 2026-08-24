"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  Select,
  Textarea,
} from "@acropora/ui";
import type { CatalogOption, ProductDetail } from "@acropora/types";
import { type FormEvent, useEffect, useState } from "react";

import { productApi } from "@/lib/api/products";

/**
 * A termék három üzleti mezőjének szerkesztője: név, leírás, kategória.
 *
 * A három egy űrlapon van, és ez döntés volt: a tulajdonjoguk EGYSZERRE került
 * át a webshoptól, tehát ugyanaz a szabály vonatkozik rájuk. Külön szerkesztők
 * azt sugallnák, hogy külön kérdések, és a következő mezőnél megint el kellene
 * dönteni, hova tartozik.
 *
 * A szerkesztő NEM dönti el, hogy szabad-e írni: azt a szerver mondja meg. Ez a
 * komponens csak akkor jelenik meg, ha a törzsadat gazdája az Acropora OS, de a
 * tiltás attól még a szolgáltatásban áll, nem itt. Egy felület, ami maga őrzi a
 * szabályt, pontosan addig őrzi, amíg valaki meg nem kerüli.
 */
export function ProductBasicsEditor({
  token,
  product,
  canManage,
  onSaved,
}: {
  token: string;
  product: ProductDetail;
  canManage: boolean;
  onSaved: (product: ProductDetail) => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [primaryCategoryId, setPrimaryCategoryId] = useState(
    product.primaryCategory?.id ?? "",
  );
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void productApi
      .categoryOptions(token)
      .then((options) => {
        if (active) setCategories(options);
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await productApi.update(token, product.id, {
        name,
        description: description.trim() ? description : null,
        primaryCategoryId: primaryCategoryId || null,
      });

      /**
       * A mentés után VISSZAOLVASSUK a terméket, és azt tesszük ki a
       * képernyőre. Nem a helyi állapotot, és nem is a mentés válaszát: az még
       * abból a tranzakcióból származik, ami írt. Amit itt látunk, az az, amit
       * a szerver bárki másnak is kiadna.
       */
      onSaved(await productApi.detail(token, product.id));
      setNotice(
        "A név, a leírás és a kategória a szerverről visszaolvasva látszik.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A mentés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  // A korai kilépés a hookok UTÁN áll, szándékosan: a hookok számának és
  // sorrendjének minden renderben azonosnak kell lennie.
  if (!canManage) return null;

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">
        Alapadatok szerkesztése
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        A név, a leírás és a kategória az Acropora OS tulajdona ezen a terméken.
      </p>

      {error ? (
        <Alert
          className="mt-3"
          variant="danger"
          title="A mentés nem sikerült"
          description={error}
        />
      ) : null}
      {notice ? (
        <Alert
          className="mt-3"
          variant="info"
          title="Mentve"
          description={notice}
        />
      ) : null}

      <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
        <FormField label="Név" htmlFor="product-name">
          <Input
            id="product-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </FormField>
        <FormField label="Leírás" htmlFor="product-description">
          <Textarea
            id="product-description"
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
          />
        </FormField>
        {/*
          A felirat szándékosan "elsődleges", nem "kategória": egy termék TÖBB
          kategóriához is tartozhat, és a lista szűrője MINDEGYIK alatt megtalálja
          (mérve: a szűrő a kapcsolat-táblára megy, nem a skalárra). Ez a mező
          csak azt mondja meg, melyik az elsődleges.
        */}
        <FormField
          label="Elsődleges kategória"
          htmlFor="product-primary-category"
          description="A termék több kategóriához is tartozhat; ez azt állítja be, melyik az elsődleges."
        >
          <Select
            id="product-primary-category"
            value={primaryCategoryId}
            onChange={(event) => setPrimaryCategoryId(event.target.value)}
            disabled={busy}
          >
            <option value="">Nincs kategória</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </FormField>
        <Button type="submit" disabled={busy}>
          {busy ? "Mentés…" : "Mentés"}
        </Button>
      </form>
    </Card>
  );
}
