// One process-wide admission gate, including streaming, parsing and model calls.
const state = globalThis as unknown as { intakeSlots?: number };
export function acquireSlot(): (() => void) | null {
  if ((state.intakeSlots || 0) >= 2) return null;
  state.intakeSlots = (state.intakeSlots || 0) + 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      state.intakeSlots!--;
    }
  };
}
