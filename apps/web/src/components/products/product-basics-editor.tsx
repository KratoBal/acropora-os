"use client";

import { Alert, Button, Card, FormField, Input, Select } from "@acropora/ui";
import type { CatalogOption, ProductDetail } from "@acropora/types";
import { type FormEvent, useEffect, useState } from "react";

import { ProductDescriptionEditor } from "@/components/products/product-description-editor";
import { productApi } from "@/lib/api/products";

/**
 * A termék négy üzleti mezőjének szerkesztője: név, leírás, kategória és
 * vásárolhatóság.
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
/** Az ures szerkeszto kimenete (`<p></p>`) nem leiras. */
const leirasUres = (html: string) => !html.replace(/<p><\/p>/g, "").trim();

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
  /*
    A LEIRAS CSAK AKKOR MEGY A MENTESBE, HA A SZERKESZTOBEN VALTOZOTT. A
    szerkeszto a betoltott HTML-t a teljes profilra normalizalja (a UNAS-bol
    atvett `style`, `div` es tarsai eltunnek), es a szerver is igy tisztit; egy
    csak a nevet modosito mentes ezert nem nyulhat a leirashoz.
  */
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [primaryCategoryId, setPrimaryCategoryId] = useState(
    product.primaryCategory?.id ?? "",
  );
  const [webshopSellable, setWebshopSellable] = useState(
    product.webshopSellable,
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
        ...(descriptionEdited
          ? { description: leirasUres(description) ? null : description }
          : {}),
        primaryCategoryId: primaryCategoryId || null,
        webshopSellable,
      });
      setDescriptionEdited(false);

      /**
       * A mentés után VISSZAOLVASSUK a terméket, és azt tesszük ki a
       * képernyőre. Nem a helyi állapotot, és nem is a mentés válaszát: az még
       * abból a tranzakcióból származik, ami írt. Amit itt látunk, az az, amit
       * a szerver bárki másnak is kiadna.
       */
      onSaved(await productApi.detail(token, product.id));
      setNotice(
        "A név, a leírás, a kategória és a vásárolhatóság a szerverről visszaolvasva látszik.",
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
      <h2 className="text-sm font-semibold text-dusk-900">
        Alapadatok szerkesztése
      </h2>
      <p className="mt-1 text-xs text-dusk-500">
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
        {/*
          A szöveg azt mondja meg, MI TÖRTÉNIK egy törléssel. A különbség itt
          nagyobb, mint máshol: ezt a terméket a webshop szinkronja kihagyja,
          tehát az eredeti szöveget SEMMI nem hozza vissza. Egy UNAS-gazdájú
          terméknél a következő szinkron helyrerakná; itt nincs ilyen háló.
        */}
        {/*
          NEM `FormField`: annak `<label>`-je egy urlapmezot keres, a
          szerkeszto pedig `contenteditable`. A szerkeszto akadalymentes neve
          a sajat `aria-label`-je ("Leírás"), a felirat itt csak szoveg.
        */}
        <div className="space-y-1.5">
          <p className="block text-sm font-semibold text-dusk-800">Leírás</p>
          <p className="text-xs text-dusk-500">
            A törölt szöveget és formázást a szinkron nem hozza vissza: ezt a
            terméket már mi gondozzuk. Az előnézet azt mutatja, ami a mentés
            után tárolódik.
          </p>
          <ProductDescriptionEditor
            token={token}
            product={product}
            value={description}
            onChange={(html) => {
              setDescription(html);
              setDescriptionEdited(true);
            }}
          />
        </div>
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
        <FormField
          label="Vásárolható"
          htmlFor="product-webshop-sellable"
          description="A termék megvehető-e a saját webshopunkban. Nem azonos az Aktív állapottal: az az archiválásról szól."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              id="product-webshop-sellable"
              type="checkbox"
              checked={webshopSellable}
              onChange={(event) => setWebshopSellable(event.target.checked)}
              disabled={busy}
            />
            Vásárolható a webshopban
          </label>
        </FormField>
        <Button type="submit" disabled={busy}>
          {busy ? "Mentés…" : "Mentés"}
        </Button>
      </form>
    </Card>
  );
}
