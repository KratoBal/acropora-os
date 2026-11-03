import { rmSync } from "node:fs";

import { AUTH_STATE } from "./paths";

/** A futás végén, sikertől függetlenül: a munkamenet-fájl nem marad a lemezen. */
export default function globalTeardown() {
  rmSync(AUTH_STATE, { force: true });
}
