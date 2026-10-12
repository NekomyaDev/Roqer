/**
 * Which run is writing in each Roblox Studio place.
 *
 * Several chats can run at once, but two runs editing the same place could
 * overwrite each other's work, so a place takes one writing run at a time. A
 * run claims its place before it does anything that waits, so two starts that
 * arrive together cannot both get it. The claim is released when that run ends
 * or when its start fails. A release only frees the place if it still holds the
 * claim it was given, so a stale release cannot free a place someone else took.
 */

export type StudioPlaceClaim = Readonly<{ instanceId: string; token: symbol }>;

export class StudioPlaceClaims {
  private readonly holders = new Map<string, symbol>();

  /** The claim for `instanceId`, or null when another run already holds the place. */
  claim(instanceId: string): StudioPlaceClaim | null {
    if (this.holders.has(instanceId)) return null;
    const token = Symbol(instanceId);
    this.holders.set(instanceId, token);
    return { instanceId, token };
  }

  /** Free the place, if this claim still holds it. A null claim (a run with no place) does nothing. */
  release(claim: StudioPlaceClaim | null): void {
    if (claim !== null && this.holders.get(claim.instanceId) === claim.token) this.holders.delete(claim.instanceId);
  }

  holds(instanceId: string): boolean {
    return this.holders.has(instanceId);
  }
}
