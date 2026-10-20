"use client";

import { Alert, Badge } from "@acropora/ui";
import Link from "next/link";

import { rc } from "@/lib/api";
import { formatLiters, WATER_BODY_LABEL, WATER_TYPE_LABEL } from "@/lib/labels";
import type { ReefClubAquarium, ReefClubShopLink } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

import { ShopLinks } from "./shop-links";

export function AquariumList() {
  const aquariums = useLoad(() =>
    rc<{ aquariums: ReefClubAquarium[] }>("GET", "/aquariums").then(
      (r) => r.aquariums,
    ),
  );
  const links = useLoad(() =>
    rc<{ links: ReefClubShopLink[] }>("GET", "/shop-links").then(
      (r) => r.links,
    ),
  );

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Akváriumok</h1>
          <Link
            href="/akvariumok/uj"
            className="inline-flex h-9 items-center rounded-lg bg-dusk-900 px-4 text-sm font-semibold text-white hover:bg-dusk-800"
          >
            Új akvárium
          </Link>
        </div>

        {aquariums.state.status === "loading" ? (
          <p role="status" className="text-sm text-pilot-grey-500">
            Betöltés…
          </p>
        ) : null}
        {aquariums.state.status === "failed" ? (
          <Alert
            variant="danger"
            title="Az akváriumok nem töltődtek be"
            description={aquariums.state.message}
          />
        ) : null}
        {aquariums.state.status === "ready" &&
        aquariums.state.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-pilot-grey-600">
            Még nincs akváriumod. Vegyél fel egyet az „Új akvárium” gombbal,
            vagy kösd össze a fiókodat a bolti nyilvántartással az alábbi
            kóddal, és a bolti akváriumaid itt jelennek meg.
          </p>
        ) : null}
        {aquariums.state.status === "ready" &&
        aquariums.state.data.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {aquariums.state.data.map((aquarium) => (
              <li key={aquarium.id}>
                <AquariumCard aquarium={aquarium} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <ShopLinks
        links={links.state}
        onChanged={async () => {
          // a new or ended link changes which shop aquariums the list shows
          await Promise.all([links.reload(), aquariums.reload()]);
        }}
      />
    </div>
  );
}

function AquariumCard({ aquarium }: { aquarium: ReefClubAquarium }) {
  const details = [
    WATER_BODY_LABEL[aquarium.waterBodyType],
    aquarium.waterType ? WATER_TYPE_LABEL[aquarium.waterType] : null,
    formatLiters(aquarium.systemVolumeLiters),
  ].filter(Boolean);
  return (
    <Link
      href={`/akvariumok/${aquarium.id}`}
      className="block rounded-xl border border-line bg-white p-4 shadow-sm transition hover:border-pilot-aqua-400"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">{aquarium.name}</h2>
        <Badge>{aquarium.origin === "OWN" ? "Saját" : "Bolti"}</Badge>
      </div>
      <p className="mt-1 text-sm text-pilot-grey-600">{details.join(" · ")}</p>
      {aquarium.sharedWithShopAt ? (
        <p className="mt-2 text-xs font-medium text-pilot-aqua-700">
          Megosztva a bolttal
        </p>
      ) : null}
    </Link>
  );
}
