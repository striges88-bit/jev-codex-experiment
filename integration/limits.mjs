// No local input byte cap: submit complete state and fall back on provider failure.
// These exports keep existing validation/packet-planning consumers compatible.
export const requestBytes = Infinity;
export const frameBytes = Infinity;
