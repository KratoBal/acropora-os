import { headers } from "next/headers";

import {
  Gyik,
  Hero,
  KampanySav,
  Lepesek,
  Nyertesek,
} from "@/components/fooldal-szakaszok";
import {
  HetiKerdesSzakasz,
  type KerdesAllapot,
} from "@/components/heti-kerdes";
import { OldalKeret } from "@/components/oldal-keret";
import { latogatoIp } from "@/lib/ip";
import { jatekApiKornyezetbol } from "@/lib/jatek-api";

// A heti kerdes mindig az api mostani allapota: sosem gyorsitotarazott lap.
export const dynamic = "force-dynamic";

export default async function KezdoLap() {
  const api = jatekApiKornyezetbol(process.env);
  const kerFejlec = await headers();
  const eredmeny = await api.aktualis(
    latogatoIp(kerFejlec.get("x-forwarded-for")),
  );

  const allapot: KerdesAllapot = !eredmeny.ok
    ? { fajta: "elerhetetlen" }
    : eredmeny.question === null
      ? { fajta: "nincs" }
      : { fajta: "nyitott", kerdes: eredmeny.question, proba: api.hamis };

  return (
    <OldalKeret proba={api.hamis}>
      <Hero />
      <KampanySav />
      <HetiKerdesSzakasz allapot={allapot} />
      <Lepesek />
      <Nyertesek />
      <Gyik />
    </OldalKeret>
  );
}
