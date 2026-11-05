import type { JogiDokumentum } from "../lib/jogi-szovegek.js";

/** Egy jogi dokumentum (vazlat) a lapon: a vazlat-jelzes FENT, minden szakasz, minden [KITOLTENDO] lathato. */
export function JogiOldal({ dokumentum }: { dokumentum: JogiDokumentum }) {
  return (
    <article
      className="jatek-kartya jatek-jogi"
      data-dokumentum={dokumentum.azonosito}
    >
      <p className="jatek-vazlat" data-testid="vazlat-jelzes">
        {dokumentum.vazlat_jelzes}
      </p>
      <h2 style={{ fontSize: "1.4rem", marginTop: 0 }}>{dokumentum.cim}</h2>
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
