import { PilotSelect } from "@acropora/ui";

/**
 * A DEPENDENT FIELD BEFORE WHAT IT DEPENDS ON (Picasso 3.7, sample C: "A függő mező kikapcsolt beviteli mező, és a címke alatt egy
 * mondat mondja meg, mire vár"; acrobot 62858). The place of the field stays visible and disabled, with what it waits for inside
 * ("Előbb válassz partnert"); the why stands as the field's help line. A sentence in the field's place hid that a field comes there.
 */
export function PilotWaitingField({
  id,
  waitingFor,
}: {
  id?: string;
  /** what the field waits for, shown in it: "Előbb válassz partnert" */
  waitingFor: string;
}) {
  return (
    <PilotSelect
      id={id}
      className="w-full"
      value=""
      onChange={() => undefined}
      disabled
      chevron
    >
      <option value="">{waitingFor}</option>
    </PilotSelect>
  );
}
