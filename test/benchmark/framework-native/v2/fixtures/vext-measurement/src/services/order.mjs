import { requestContext } from "vextjs";

import {
  HttpQuoteClient,
  OrderService as SharedOrderService,
  RingOrderRepository,
} from "../../../../application-model.mjs";

const orderService = new SharedOrderService({
  repository: new RingOrderRepository(),
  quoteClient: new HttpQuoteClient({
    baseUrl: process.env.BENCHMARK_EXTERNAL_URL,
  }),
});

export default class OrderService {
  async create({ userId, body }) {
    const context = requestContext.getStore();
    return orderService.create({ userId, body, context });
  }
}
