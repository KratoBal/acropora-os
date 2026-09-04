export const normalizeBrandText = (value: string) =>
  value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/**
 * AZ ELVALASZTO NEM RESZE A MARKANEVNEK, A TOKENHATAR VISZONT IGEN.
 *
 * A normalizalas a kotojelet SZOKOZRE csereli, nem torli. Ettol a "Mag-Float"
 * alakbol "mag float" lesz, a szotari "Magfloat" alakbol pedig "magfloat", es a
 * ketto SOHA nem talalkozik. Merve a 09-03-as exporton, a 1893 termeknev ellen:
 * ot marka, 98 termek all igy -- koztuk mind a tizenegy Mag-Float termek, mert
 * a szotar szokoz nelkul irja a nevet, a katalogus meg kotojellel.
 *
 *   Mag-Float  <-> Magfloat      11 termek
 *   AquaMedic  <-> Aqua Medic    34
 *   RedSea     <-> Red Sea       24
 *   Aqualight  <-> Aqua Light    18
 *   Polyplab   <-> Polyp Lab     11
 *
 * MIERT NEM A TOMORITES A MEGOLDAS, HOLOTT AZ A KEZENFEKVO: ha egyszeruen
 * elhagyjuk a szokozoket mindket oldalon es reszszot keresunk, a tokenhatar
 * elveszik. Ugyanezen a merésen az a valtozat 175 talalatot ad, es a tobblet
 * nagy resze HAMIS: az "ATI" alias rasimul az "aqua illumin-ATI-on" nev
 * belsejere, a "D-D" pedig a "Jeco-DD-mp" alakra.
 *
 * EZERT AZ OSSZEFUZES CSAK TELJES TOKENEKBOL EPITKEZIK. A minta osszefuzott
 * alakjat egy OSSZEFUGGO token-reszsorozat osszefuzott alakjahoz merjuk, tehat
 * a hatarok megmaradnak: az "ati" nem allithato elo az "aqua" es az
 * "illumination" tokenekbol. Merve ugyanazon a bemeneten: 98 tobblet, nulla
 * vesztes, es mind az ot marka valodi.
 */
const brandTokens = (value: string) =>
  normalizeBrandText(value).split(" ").filter(Boolean);

const joinTokens = (value: string) =>
  normalizeBrandText(value).replace(/ /g, "");

/**
 * Egyezik-e a `target` a `tokens` egy OSSZEFUGGO, a `from` indexen KEZDODO
 * reszsorozatanak osszefuzott alakjaval.
 *
 * A hossz-vizsgalat nem gyorsitas, hanem hatar: amint az osszefuzott alak
 * hosszabb a keresettnel, a tovabbi tokenek csak hosszabbak lehetnek.
 */
const joinedMatchFrom = (tokens: string[], target: string, from: number) => {
  let joined = "";
  for (let index = from; index < tokens.length; index += 1) {
    joined += tokens[index];
    if (joined.length > target.length) return false;
    if (joined === target) return true;
  }
  return false;
};

export const containsTokenPhrase = (value: string, phrase: string) => {
  const target = joinTokens(phrase);
  if (!target) return false;
  const tokens = brandTokens(value);
  return tokens.some((_, index) => joinedMatchFrom(tokens, target, index));
};

export const startsWithTokenPhrase = (value: string, phrase: string) => {
  const target = joinTokens(phrase);
  if (!target) return false;
  return joinedMatchFrom(brandTokens(value), target, 0);
};
