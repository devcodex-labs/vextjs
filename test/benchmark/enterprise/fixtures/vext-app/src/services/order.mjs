import { delay } from "../../../../contract.mjs";
import { increment } from "../../../../target-runtime.mjs";

export default class OrderService {
  constructor(app) {
    this.app = app;
    this.state = app.enterpriseBenchmarkState;
  }

  async create({ userId, body, context, delayMs }) {
    increment(this.state, "service");
    await delay(delayMs);
    const priced = this.app.services.pricing.quote(body);
    return this.app.services.repository.create({
      userId,
      body: priced,
      context,
    });
  }
}
