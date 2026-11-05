import { BeadasUrlap } from "@/components/beadas-urlap";
import { OldalKeret } from "@/components/oldal-keret";
import { jatekApiKornyezetbol } from "@/lib/jatek-api";
import { NEM_ELERHETO } from "@/lib/uzenetek";

// A heti kerdes mindig az api mostani allapota: sosem gyorsitotarazott lap.
export const dynamic = "force-dynamic";

const BUDAPEST = "Europe/Budapest";
const idopont = (iso: string) =>
  new Intl.DateTimeFormat("hu-HU", {
    timeZone: BUDAPEST,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export default async function KezdoLap() {
  const api = jatekApiKornyezetbol(process.env);
  const eredmeny = await api.aktualis();

  return (
    <OldalKeret>
      {api.hamis ? (
        <p className="jatek-proba" data-testid="proba-jelzes">
          Próbaüzem: ez a kérdés még nem valódi, és a beküldés nem megy sehova.
        </p>
      ) : null}
      {!eredmeny.ok ? (
        <p className="jatek-uzenet" data-fajta="hiba" role="alert">
          {NEM_ELERHETO}
        </p>
      ) : eredmeny.question === null ? (
        <section className="jatek-kartya">
          <p className="jatek-kerdes">Most nincs nyitott kérdés.</p>
          <p className="jatek-hatarido">
            A játékban hetente új kérdés nyílik. Nézz vissza később, vagy olvasd
            el addig a <a href="/jatekszabalyzat">játékszabályzatot</a>.
          </p>
        </section>
      ) : (
        <section className="jatek-kartya">
          <p className="jatek-het">{eredmeny.question.week}</p>
          <p className="jatek-kerdes">{eredmeny.question.prompt}</p>
          <p className="jatek-hatarido">
            Beküldési határidő: {idopont(eredmeny.question.closesAt)}
          </p>
          <BeadasUrlap kerdes={eredmeny.question} />
        </section>
      )}
    </OldalKeret>
  );
}
