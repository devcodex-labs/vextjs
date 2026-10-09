import { describe, it, expect } from "vitest";
import {
  normalizeSourceIP,
  selectAffinitySlot,
} from "../../../src/lib/cluster/affinity-router.js";
import { WorkerSlots } from "../../../src/lib/cluster/worker-slots.js";

describe("source IP affinity", () => {
  it("canonicalizes equivalent addresses and rejects non-IP keys", () => {
    expect(normalizeSourceIP("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeSourceIP("0:0:0:0:0:ffff:7f00:1")).toBe("127.0.0.1");
    expect(normalizeSourceIP("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeSourceIP("fe80::1%eth0")).toBe("fe80::1%eth0");
    expect(() => normalizeSourceIP("proxy.example")).toThrow();
  });

  it("keeps healthy-slot mappings when one slot disappears", () => {
    const used = new Set<number>();
    for (let ip = 1; ip < 255; ip++) {
      const address = `127.0.0.${ip}`;
      const initial = selectAffinitySlot(address, [0, 1, 2, 3])!;
      used.add(initial);
      expect(selectAffinitySlot(address, [3, 2, 1, 0])).toBe(initial);
      if (initial !== 2)
        expect(selectAffinitySlot(address, [0, 1, 3])).toBe(initial);
    }
    expect(used.size).toBe(4);
    expect(selectAffinitySlot("127.0.0.1", [])).toBeUndefined();
  });

  it("does not remove a new owner on a late old-generation exit", () => {
    const slots = new WorkerSlots();
    slots.activate(0, 1);
    slots.activate(0, 2);
    slots.remove(0, 1);
    expect(slots.owner(0)).toBe(2);
    slots.remove(0, 2);
    expect(slots.owner(0)).toBeUndefined();
  });
});
