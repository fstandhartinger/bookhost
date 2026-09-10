// One process-wide admission gate, including streaming, parsing and model calls.
const state = globalThis as unknown as {
  intakeSlots?: number;
  intakeSlotsByTeam?: Record<string, number>;
};

function limit(name: string, fallback: number) {
  const configured = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

export function acquireSlot(teamId: string): (() => void) | null {
  const slotsByTeam = (state.intakeSlotsByTeam ||= {});
  const teamSlots = slotsByTeam[teamId] || 0;
  if (
    (state.intakeSlots || 0) >= limit("INTAKE_MAX_CONCURRENT", 2) ||
    teamSlots >= limit("INTAKE_MAX_PER_TEAM", 1)
  )
    return null;
  state.intakeSlots = (state.intakeSlots || 0) + 1;
  slotsByTeam[teamId] = teamSlots + 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      state.intakeSlots!--;
      slotsByTeam[teamId]!--;
    }
  };
}
