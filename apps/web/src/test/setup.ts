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

afterEach(() => cleanup());
