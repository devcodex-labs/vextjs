import { requestContext } from "vextjs";

import {
  HttpQuoteClient,
  OrderService as SharedOrderService,
  RingOrderRepository,
} from "../../../../application-model.mjs";
import {
  observeQuoteClient,
  observeRepository,
} from "../../../../observation.mjs";
import { observer } from "../plugins/benchmark-observer.mjs";

const orderService = new SharedOrderService({
  repository: observeRepository(new RingOrderRepository(), observer),
  quoteClient: observeQuoteClient(
    new HttpQuoteClient({ baseUrl: process.env.BENCHMARK_EXTERNAL_URL }),
    observer,
  ),
});

export default class OrderService {
  async create({ userId, body }) {
    const context = requestContext.getStore();
    return orderService.create({ userId, body, context });
  }
}
