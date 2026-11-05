import type { Tool } from "../src/agent/tools.ts";

/** Example business rule. The caller supplies an authoritative clock and reservation lookup. */
export function requireBookingWithin24Hours(
  loadCreatedAt: (reservationId: string) => Promise<string>,
  now: () => Date,
): NonNullable<Tool["beforeExecute"]> {
  return async (args) => {
    const reservationId = args.reservationId;
    if (typeof reservationId !== "string" || !reservationId) return { allowed: false, reason: "Reservation ID is required" };
    const createdAt = new Date(await loadCreatedAt(reservationId));
    const current = now();
    if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(current.getTime())) {
      throw new Error("Invalid booking or current time");
    }
    const elapsed = current.getTime() - createdAt.getTime();
    if (elapsed < 0) return { allowed: false, reason: "Booking time is in the future" };
    if (elapsed > 24 * 60 * 60 * 1000) return { allowed: false, reason: "Booking is older than 24 hours" };
    return { allowed: true };
  };
}
