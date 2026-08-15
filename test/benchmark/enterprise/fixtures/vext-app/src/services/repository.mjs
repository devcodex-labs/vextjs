import { createRepositoryOrder } from "../../../../target-runtime.mjs";

export default class RepositoryService {
  constructor(app) {
    this.state = app.enterpriseBenchmarkState;
  }

  create(input) {
    return createRepositoryOrder({
      state: this.state,
      userId: input.userId,
      body: input.body,
      context: input.context,
    });
  }
}
