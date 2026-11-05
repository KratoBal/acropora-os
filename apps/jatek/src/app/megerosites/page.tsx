import type { Metadata } from "next";

import { MegerositesAllapot } from "@/components/megerosites-allapot";
import { OldalKeret } from "@/components/oldal-keret";

export const metadata: Metadata = { title: "Részvétel megerősítése" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ token?: string | string[] }> };

export default async function MegerositesLap({ searchParams }: Props) {
  const { token } = await searchParams;
  const egy = Array.isArray(token) ? token[0] : token;
  return (
    <OldalKeret>
      <section className="jatek-kartya">
        {egy ? (
          <MegerositesAllapot token={egy} />
        ) : (
          <p className="jatek-uzenet" data-fajta="hiba" role="alert">
            Ez a megerősítő link nem érvényes. Nézd meg, hogy a levélben lévő
            linket másoltad-e be teljesen.
          </p>
        )}
      </section>
    </OldalKeret>
  );
}
