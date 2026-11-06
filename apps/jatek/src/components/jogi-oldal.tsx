import {
  szakaszBlokkok,
  type JogiBlokk,
  type JogiDokumentum,
} from "../lib/jogi-szovegek.ts";

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
          {szakaszBlokkok(szakasz).map((blokk, i) => (
            <Blokk key={i} blokk={blokk} />
          ))}
        </section>
      ))}
    </article>
  );
}

/** Egy blokk a lapon: bekezdés (a sortörések megmaradnak), alcím, felsorolás vagy táblázat. */
function Blokk({ blokk }: { blokk: JogiBlokk }) {
  switch (blokk.fajta) {
    case "bekezdes":
      return (
        <p>
          {blokk.sorok.map((sor, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              {sor}
            </span>
          ))}
        </p>
      );
    case "alcim":
      return <h3>{blokk.szoveg}</h3>;
    case "lista":
      return (
        <ul>
          {blokk.elemek.map((elem, i) => (
            <li key={i}>{elem}</li>
          ))}
        </ul>
      );
    case "tablazat":
      return (
        <div className="jatek-tablazat">
          <table>
            <thead>
              <tr>
                {blokk.fejlec.map((cella, i) => (
                  <th key={i} scope="col">
                    {cella}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blokk.sorok.map((sor, i) => (
                <tr key={i}>
                  {sor.map((cella, j) => (
                    <td key={j}>{cella}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
