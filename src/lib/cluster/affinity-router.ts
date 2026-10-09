import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** URL canonicalizes IPv6 compression; mapped IPv4 shares the IPv4 key. */
export function normalizeSourceIP(address: string): string {
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) throw new Error("Invalid TCP source IP");
  const zone = address.indexOf("%");
  const plain = zone < 0 ? address : address.slice(0, zone);
  const canonical = new URL(`http://[${plain}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/i.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16),
      low = parseInt(mapped[2]!, 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return zone < 0 ? canonical : `${canonical}%${address.slice(zone + 1)}`;
}

/** Rendezvous scoring over logical slots, never over PIDs or transient IDs. */
export function selectAffinitySlot(
  address: string,
  slots: readonly number[],
): number | undefined {
  const key = normalizeSourceIP(address);
  let winner: number | undefined, score: Buffer | undefined;
  for (const slot of slots) {
    const next = createHash("sha256")
      .update(key)
      .update("\0")
      .update(String(slot))
      .digest();
    const comparison = score ? Buffer.compare(next, score) : 1;
    if (comparison > 0 || (comparison === 0 && slot < winner!)) {
      winner = slot;
      score = next;
    }
  }
  return winner;
}
