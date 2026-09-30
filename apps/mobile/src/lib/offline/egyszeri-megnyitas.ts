/**
 * A HELYI ADATBAZIS KOZOS MEGNYITASA ES AZ IRASOK SORRENDJE -- NATIV RETEG
 * NELKUL, HOGY MERHETO LEGYEN.
 *
 * === A MERT HIBA (Balazs, 2026-09-30, Android, production-apk 5) ===
 *
 * A "Letoltom a helyszint" lefutott es szamot mondott, terero nelkul viszont a
 * lista ezt irta: "Nincs kapcsolat, es nincs mentett masolat". A masolatbol
 * NULLA sor jott vissza.
 *
 * === AMI A KODBAN ALLT, ES AMI EGYUTT KIADJA EZT ===
 *
 * 1. HAT KULON MEGNYITAS. Ot masolat-modul a SAJAT `opening` valtozojaval
 *    nyitotta meg az adatbazist, a sor-modul pedig MINDEN hivasnal ujra. Az
 *    expo-sqlite a ket platformon UGYANAZT a nativ kapcsolatot adja vissza
 *    (utvonal szerint gyorsitotarazva), tehat minden megnyitas ugyanazon a
 *    kapcsolaton futtatta le a semat ES a sorszamozott lepeseket
 *    (`applyMigrations`). Ket parhuzamos megnyitas ugyanazt a `user_version`-t
 *    olvassa, ugyanazt az `ALTER TABLE ... ADD COLUMN`-t futtatja, es a
 *    masodik "duplicate column name" hibaval elhasal.
 *
 * 2. A BUKOTT MEGNYITAS OROKRE MEGMARADT. Az `opening ??= ...` a ELUTASITOTT
 *    igeretet is megtartotta: egy egyszer elhasalt megnyitas utan az a modul az
 *    app ujrainditasaig SEMMIT nem irt es semmit nem olvasott -- es mindket
 *    iranyban csendben, mert a masolat-modulok minden hibat elnyelnek. A
 *    letoltes ezert "kesz"-t mondott, a lista pedig ureset latott.
 *
 * 3. EGYMASBA CSUSZO TRANZAKCIOK. A `withTransactionAsync` nem kizarolagos: egy
 *    kozben indulo masik `BEGIN` hibat dob, es a hibaagon kiadott `ROLLBACK` a
 *    MASIK, meg futo tranzakciot gorgeti vissza.
 *
 * === A JAVITAS ITT ===
 *
 * `egyszeriMegnyitas`: egy megnyitas az egesz appnak, es ha elhasal, a
 * kovetkezo hivas UJRA probalja -- nem orokli a bukast.
 *
 * `egymasUtan`: a tranzakciok sorban futnak, egy a masik utan, tehat egyik sem
 * nyithat `BEGIN`-t egy masik futasa kozben.
 */

/**
 * EGY MEGNYITAS, AMIT MINDENKI MEGOSZT -- ES A BUKAST NEM JEGYZI MEG.
 *
 * A folyamatban levo igeretet adja vissza minden hivonak, tehat a sema es a
 * lepesek egyszer futnak le. Ha a megnyitas elhasal, az igeret TORLODIK: a
 * kovetkezo hivo ujraprobalja, nem a regi hibat kapja.
 */
export function egyszeriMegnyitas<T>(nyit: () => Promise<T>): () => Promise<T> {
  let folyamatban: Promise<T> | null = null;
  return () => {
    folyamatban ??= nyit().catch((hiba: unknown) => {
      folyamatban = null;
      throw hiba;
    });
    return folyamatban;
  };
}

/**
 * EGYMAS UTAN FUTO FELADATOK.
 *
 * A kovetkezo feladat akkor indul, amikor az elozo VEGET ERT, akar sikerrel,
 * akar hibaval: egy elhasalt iras nem allithatja meg a tobbit. A hibat a SAJAT
 * hivoja kapja meg, nem a kovetkezo.
 */
export function egymasUtan(): <T>(feladat: () => Promise<T>) => Promise<T> {
  let lanc: Promise<unknown> = Promise.resolve();
  return <T>(feladat: () => Promise<T>): Promise<T> => {
    const futas = lanc.then(feladat, feladat);
    lanc = futas.catch(() => undefined);
    return futas;
  };
}
