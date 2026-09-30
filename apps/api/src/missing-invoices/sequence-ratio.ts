/**
 * A PYTHON `difflib.SequenceMatcher(None, a, b).ratio()` HŰ ÁTIRATA (junk
 * nélkül; rövid neveknél az automatikus junk sem lép életbe, az 200 karakter
 * fölött kapcsol be). A párosítás névhasonlósági küszöbeit (0,6) barracuda
 * ezzel a függvénnyel mérte, ezért nem egy másik hasonlósági mérték.
 *
 *   ratio = 2 * M / (len(a) + len(b)), ahol M az egyező blokkok hossza: a
 *   leghosszabb közös részsztring, majd rekurzívan a bal és a jobb maradék.
 */
export function sequenceRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * matchingCharacters(a, 0, a.length, b, 0, b.length)) / total;
}

function matchingCharacters(
  a: string,
  aLow: number,
  aHigh: number,
  b: string,
  bLow: number,
  bHigh: number,
): number {
  const [i, j, size] = longestMatch(a, aLow, aHigh, b, bLow, bHigh);
  if (size === 0) return 0;
  return (
    size +
    matchingCharacters(a, aLow, i, b, bLow, j) +
    matchingCharacters(a, i + size, aHigh, b, j + size, bHigh)
  );
}

/**
 * A difflib `find_longest_match`-e: a leghosszabb közös blokk, és azonos hossz
 * esetén a legkorábbi `a`-beli, azon belül a legkorábbi `b`-beli kezdet.
 */
function longestMatch(
  a: string,
  aLow: number,
  aHigh: number,
  b: string,
  bLow: number,
  bHigh: number,
): [number, number, number] {
  let bestI = aLow;
  let bestJ = bLow;
  let bestSize = 0;
  let previous = new Map<number, number>();
  for (let i = aLow; i < aHigh; i++) {
    const current = new Map<number, number>();
    for (let j = bLow; j < bHigh; j++) {
      if (a[i] !== b[j]) continue;
      const size = (previous.get(j - 1) ?? 0) + 1;
      current.set(j, size);
      if (size > bestSize) {
        bestI = i - size + 1;
        bestJ = j - size + 1;
        bestSize = size;
      }
    }
    previous = current;
  }
  return [bestI, bestJ, bestSize];
}
