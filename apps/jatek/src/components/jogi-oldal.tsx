import type { JogiDokumentum } from "../lib/jogi-szovegek.ts";

/** Egy jogi dokumentum (vazlat) a lapon: a vazlat-jelzes FENT, minden szakasz, minden [KITOLTENDO] lathato. */
export function JogiOldal({ dokumentum }: { dokumentum: JogiDokumentum }) {
  return (
    <article
      className="jatek-wrap jatek-jogi"
      data-dokumentum={dokumentum.azonosito}
    >
      {dokumentum.vazlat_jelzes ? (
        <p className="jatek-vazlat" data-testid="vazlat-jelzes">
          {dokumentum.vazlat_jelzes}
        </p>
      ) : null}
      <h1>{dokumentum.cim}</h1>
      {dokumentum.szakaszok.map((szakasz) => (
        <section key={szakasz.cim}>
          <h2>{szakasz.cim}</h2>
          {szakasz.bekezdesek.map((bekezdes) => (
            <p key={bekezdes}>{bekezdes}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
