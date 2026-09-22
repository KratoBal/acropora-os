"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from "@acropora/ui";
import {
  normalizeAssetCategoryName,
  type AssetCategory,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetCategoriesApi } from "@/lib/api/asset-categories";

/**
 * AZ ESZKOZ-KATEGORIAK KARBANTARTASA.
 *
 * Balazs kerese, 2026-09-22: az eszkoz-felvitelen a kategoria legyen
 * legordulo. Ez a lap az, ahol a lista TARTALMA keszul.
 *
 * === A TORLES KIVEZETES, ES A LAP EZT KIMONDJA ===
 *
 * Eszkozok hivatkoznak a sorokra, tehat a torles vagy elhasalna, vagy egy nev
 * eltunne a mar felvitt eszkozok alol. A gomb ezert „Kivezetés", nem
 * „Törlés" -- es a kivezetett sor a listan MARAD, halvanyan, hogy
 * visszahozhato legyen.
 */
export function AssetCategoriesPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [items, setItems] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ujNev, setUjNev] = useState("");
  const [mentes, setMentes] = useState(false);

  const betolt = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        /*
          A KIVEZETETTEK IS JONNEK. Ez a karbantarto lap -- itt pont az a
          kerdes, hogy mi all a listan, beleertve azt is, amit kivezettunk. A
          VALASZTO keri csak az aktivakat.
        */
        const valasz = await assetCategoriesApi.list(token, true, signal);
        setItems(valasz.items);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A kategóriák nem tölthetők be.",
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void betolt(controller.signal);
    return () => controller.abort();
  }, [betolt]);

  const felvesz = async () => {
    const nev = normalizeAssetCategoryName(ujNev);
    if (nev === "") return;
    setMentes(true);
    setError(null);
    try {
      await assetCategoriesApi.create(token, { name: nev });
      setUjNev("");
      await betolt();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kategória nem vehető fel.",
      );
    } finally {
      setMentes(false);
    }
  };

  const allit = async (kategoria: AssetCategory, aktiv: boolean) => {
    setError(null);
    try {
      await assetCategoriesApi.update(token, kategoria.id, { isActive: aktiv });
      await betolt();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kategória nem módosítható.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-dusk-900">
          Eszköz-kategóriák
        </h1>
        <p className="mt-1 text-sm text-dusk-600">
          Ez a lista áll az eszköz-felvitel legördülő menüjében. Kivezetni
          lehet, törölni nem: a már felvitt eszközök mellett a név olvasható
          marad.
        </p>
      </div>

      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">
            Új kategória
          </h2>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-dusk-700">Név</span>
            <Input
              aria-label="Kategória neve"
              value={ujNev}
              maxLength={80}
              onChange={(event) => setUjNev(event.target.value)}
              placeholder="pl. Vízkezelés"
            />
          </label>
          {/*
            URES NEVVEL NEM INDUL: a nev kotelezo, tehat a hivas BIZTOSAN
            elutasitas lenne. Egy halozati kor arra, amirol itt is tudjuk, hogy
            nem mehet, csak varakozas.
          */}
          <Button
            disabled={mentes || normalizeAssetCategoryName(ujNev) === ""}
            onClick={() => void felvesz()}
          >
            {mentes ? "Mentés…" : "Felvétel"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-dusk-900">A lista</h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-dusk-500">Betöltés…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-dusk-500">
              Még egyetlen kategória sincs felvéve.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((kategoria) => (
                <li
                  key={kategoria.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <span
                    className={
                      kategoria.isActive
                        ? "text-sm text-dusk-800"
                        : "text-sm text-dusk-400 line-through"
                    }
                  >
                    {kategoria.name}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void allit(kategoria, !kategoria.isActive)}
                  >
                    {kategoria.isActive ? "Kivezetés" : "Visszahozás"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
