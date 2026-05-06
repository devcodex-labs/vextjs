import { definePlugin } from "vextjs";

export default definePlugin({
  name: "beta",
  onReady(app) {
    app.extend("shared", 42);
  },
});

