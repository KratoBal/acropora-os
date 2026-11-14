import { act } from "@testing-library/react";

type CalledMock = { mock: { results: { value: unknown }[] } };

/**
 * A MÁR ELINDÍTOTT HÍVÁSOK VÁLASZA, MIELŐTT A TESZT TOVÁBBMEGY (card e91dc528). Egy képernyő gyakran előbb rajzolja ki
 * az üres mezőt, mint a betöltött értékét: egy `findByLabelText` a MEZŐRE vár, és az utána jövő gépelés vagy állítás
 * csak azért lát kész adatot, mert a mockolt válasz addig megérkezett. Ez megvárja a megnevezett mockok eddigi
 * hívásainak válaszát (a sikerest és a bukottat is), és a hozzájuk tartozó renderelést.
 */
export async function answered(...mocks: CalledMock[]): Promise<void> {
  for (const mock of mocks)
    await act(() =>
      Promise.allSettled(mock.mock.results.map((result) => result.value)),
    );
}
