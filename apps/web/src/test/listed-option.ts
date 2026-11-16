import { screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * A SELECT, AMIKOR MÁR OTT A VÁLASZTANDÓ SOR (card e91dc528). A mező gyakran előbb jelenik meg, mint a listája: a
 * címke az első renderben ott áll, a sorok a lista-hívás válaszával jönnek. Egy `findByLabelText` a MEZŐRE vár, nem a
 * sorra, tehát a választás csak azért sikerül, mert a mockolt válasz addig megérkezett; egy késő válasznál a választás
 * egy nem létező értékre megy. Ez a sorra vár, és a mezőt adja vissza.
 */
export async function listedSelect(
  label: string | RegExp,
  value: string,
): Promise<HTMLSelectElement> {
  const select = (await screen.findByLabelText(label)) as HTMLSelectElement;
  await waitFor(() =>
    expect([...select.options].map((option) => option.value)).toContain(value),
  );
  return select;
}
