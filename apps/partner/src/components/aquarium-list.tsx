"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  ServiceListFooter,
  ServiceListHeader,
  ServiceSearchField,
  Skeleton,
  StatCard,
  sv,
} from "@acropora/ui";
import type { AquariumListResponse } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";

/**
 * AZ AKVÁRIUM-LISTA A BELSŐ (`app.acropora.hu`) ELRENDEZÉSÉBEN.
 *
 * Ugyanaz a keret, mint az `AssetList`-nél (lásd annak fejlécét): a
 * `sv`/`ServiceListHeader`/`ServiceListFooter`/`ServiceSearchField`
 * komponensek a belső felülettel közösek, nem egy saját, párhuzamos
 * megoldás -- Balázs kérése (2026-09-24), hogy a portál ugyanúgy nézzen
 * ki, mint a belső Acropora OS.
 *
 * === A HATÓKÖR A SZERVERÉ, NEM EZ A LAPÉ ===
 *
 * A `partnerApi.aquariums()` nem küld `customerId`-t -- a látott sorokat a
 * szerver `aquarium-visibility.ts`-e adja: a hívó saját ügyfele, a hozzá
 * RENDELT (kiosztott) helyszínek szerint. Hozzárendelés nélkül a hívó
 * SEMMIT nem lát -- ez nem hiba, hanem Balázs döntése (lásd a séma-
 * fejlécet), és a lap üres-állapota ezt a mondatot viseli.
 *
 * === A "VÍZTÍPUS" OSZLOP HIÁNYZIK, ÉS EZ SZÁNDÉKOS ===
 *
 * A Figma 9. köri terv (`PartnerPortalScreen.tsx` `PartnerAkváriumokList`)
 * Víztípus oszlopot rajzol, DE az `AquariumSummary` (a lista válasza) NEM
 * hordozza a `waterType` mezőt -- az csak az `AquariumDetail`-en (egy
 * konkrét akvárium adatlapján) áll. A "kód nyer a terv felett" szabály
 * szerint ez az oszlop most kimarad, nem találjuk ki -- ha a lista-válasz
 * valaha bővül `waterType`-tal, ez a kártya visszakerülhet.
 *
 * === AZ "ÚJ AKVÁRIUM" GOMB MOSTANTÓL ITT VAN ===
 *
 * Ugyanaz az indok/minta, mint a belső `asset-list-page.tsx` "Új eszköz"
 * gombjánál: `Link` + `Button` + `Icon` a `ServiceListHeader` `action`
 * prop-jában. FELTÉTEL NÉLKÜL jelenik meg (nem `hasPermission`-höz kötve,
 * mint a belső lapon) -- a `PARTNER_SERVICE` szerep create()-hez nem kap
 * `requireInternalWriter`-t (lásd `aquariums.service.ts`), tehát minden
 * partner-fiók hívhatja a végpontot. Hozzárendelt helyszín nélkül a gomb
 * a felvitel-űrlapra visz, ami a saját "nincs helyszíne, nem tud felvinni"
 * üzenetét mutatja -- ugyanaz a minta, mint a `new-ticket.tsx` hibajegy-
 * nyitásánál.
 *
 * EZ A BEKEZDÉS KORÁBBAN AZT ÁLLÍTOTTA, hogy a gomb hiányát egy VÉGPONT
 * hiánya indokolja ("saját, hozzárendelt helyszín" választó), és hogy a
 * meglévő `worksheetsApi.departments(customerId)` a vevő TELJES
 * helyszínlistáját adná. **Ez tévedés volt, és mérve javítva 2026-09-25:**
 * `worksheets.repository.ts` `departments()`-e `scope.kind === "customer"`
 * hívónál MÁR AKKOR is `id: { in: [...assignedUnitIds] }` szűrést
 * alkalmazott (`assignedUnitIdsFor(actorUserId)`-ból) -- ugyanaz a
 * végpont, amit a `new-ticket.tsx` helyszín-választója is hív, MÁR a hívó
 * saját, kiosztott helyszíneire szűkült, nem a vevő teljes fájára. A hiány
 * tehát KIZÁRÓLAG a képernyő/útvonal volt, nem a szerver oldal -- ez a
 * javítás pont ezt pótolja.
 */

const PAGE_SIZE = 25;

function formatLiters(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value.toLocaleString("hu-HU")} l`;
}

function formatLastMeasuredAt(value: string | undefined): string {
  if (!value) return "Nincs mérés";
  return new Date(value).toLocaleDateString("hu-HU");
}

export function AquariumList() {
  const { user } = useAuth();
  const [data, setData] = useState<AquariumListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    if (!user?.customerId) return;
    void partnerApi
      .aquariums({
        ...(search.trim() ? { search: search.trim() } : {}),
        page,
        pageSize: PAGE_SIZE,
      })
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az akváriumok nem tölthetők be.",
        ),
      );
  }, [user?.customerId, search, page]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  const selectSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <section>
      <ServiceListHeader
        eyebrow="Saját adatok"
        title="Akváriumok"
        lead="A cégéhez tartozó, hozzárendelt helyszínek akváriumai. Kattintson egy akváriumra az adatlapjáért."
        action={
          <Link href="/akvariumok/uj">
            <Button>
              <Icon name="plus" className="mr-1.5 size-[17px]" />
              Új akvárium
            </Button>
          </Link>
        }
      />

      {error ? (
        <Alert
          className="mb-6"
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Nyilvántartott akvárium"
          value={data ? String(data.pagination.totalItems) : "—"}
        />
        <StatCard
          label="Mérés nélküli akvárium"
          value={
            data
              ? String(data.items.filter((item) => !item.lastMeasuredAt).length)
              : "—"
          }
        />
      </div>

      <section className={sv.panel}>
        <div className={sv.toolbar}>
          <ServiceSearchField
            label="Akvárium keresése"
            placeholder="Név, akváriumszám"
            value={search}
            onChange={selectSearch}
          />
          {data ? (
            <Pagination
              position="top"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </div>

        {!data && !error ? (
          <div className="space-y-3 p-5" aria-label="Akváriumok betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}

        {data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr>
                    {[
                      "Akvárium",
                      "Helyszín",
                      "Víztérfogat",
                      "Utolsó mérés",
                    ].map((head) => (
                      <th key={head} className={sv.tableHead}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((aquarium) => (
                    <tr key={aquarium.id} className={sv.tableRow}>
                      <td className={sv.tableCell}>
                        <Link
                          href={`/akvariumok/${aquarium.id}`}
                          className={sv.rowTitle}
                        >
                          {aquarium.name}
                        </Link>
                        <span className={`mt-1 block font-mono ${sv.rowMeta}`}>
                          {aquarium.aquariumNumber}
                        </span>
                      </td>
                      <td className={sv.tableCell}>
                        {aquarium.departmentName ?? "Nincs megadva"}
                      </td>
                      <td className={sv.tableCell}>
                        {formatLiters(aquarium.systemVolumeLiters)}
                      </td>
                      <td className={sv.tableCell}>
                        {formatLastMeasuredAt(aquarium.lastMeasuredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ServiceListFooter
              shown={data.items.length}
              totalItems={data.pagination.totalItems}
              tail={{
                kind: "paged",
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
              }}
            />
          </>
        ) : data ? (
          <div className="p-5">
            <EmptyState
              title="Nincs megjeleníthető akvárium"
              description="A partneri fiókhoz jelenleg nincs hozzárendelt helyszínen akvárium, vagy a keresés nem ad találatot. A hozzárendelést a belső csapat állítja be."
            />
          </div>
        ) : null}
      </section>
      {data ? (
        <Pagination
          position="bottom"
          className="mt-6"
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
