import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

import { beszurLathatosagShim } from "./visibility-shim.js";

/**
 * A REJTO OSZTALYOK STILUSA, MINDEN TESZT ELE.
 *
 * A `happy-dom` nem tolt be stiluslapot, tehat egy `hidden` osztallyal rejtett
 * elem szamitott stilus nelkul LATHATONAK szamit -- merve 2026-09-22.
 * A shim indoka es a hatara a `visibility-shim.ts` fejlecen all.
 */
// Server route tests use real Node Request/Response (including Cookie headers).
// The visibility shim applies only to browser component tests.
beforeAll(() => {
  if (typeof document !== "undefined") beszurLathatosagShim();
});

/**
 * THE THEME STORE LIVES IN THE MODULE (card 302951c0): every view shares one state, read from the cache once. Without
 * this reset a test that puts "dark" into the cache would still see the state an earlier test in the same file read.
 * Browser tests only: the server route tests never load the store.
 */
afterEach(async () => {
  cleanup();
  if (typeof document !== "undefined")
    (await import("@acropora/ui")).resetThemeStateForTests();
});
