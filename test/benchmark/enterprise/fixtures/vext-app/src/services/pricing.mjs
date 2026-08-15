import { increment } from "../../../../target-runtime.mjs";

export default class PricingService {
  constructor(app) {
    this.state = app.enterpriseBenchmarkState;
  }

  quote(body) {
    // Deterministic small CPU work stands in for ordinary pricing rules.
    let checksum = 0;
    for (let index = 0; index < body.sku.length; index += 1) {
      checksum = (checksum * 31 + body.sku.charCodeAt(index)) % 10_007;
    }
    increment(this.state, "service");
    return {
      ...body,
      pricingChecksum: checksum,
    };
  }
}
