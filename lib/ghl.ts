// DEPRECATED: GoHighLevel integration removed.
// Keep small stubs so any lingering imports fail with a clear message.

export function _ghlDeprecated() {
  throw new Error("GoHighLevel (GHL) removed from this project. Use src/lib/supabase.ts and src/lib/google.ts instead.");
}

export async function upsertContact() { _ghlDeprecated(); }
export async function getFreeSlots() { _ghlDeprecated(); }
export async function createAppointment() { _ghlDeprecated(); }

export default _ghlDeprecated;
