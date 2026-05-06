import { definePlugin } from "vextjs";

export default definePlugin({
  name: "cache",
  setup(app) {
    const cache = {
      get(key) {
        return key;
      },
    };
    app.extend("cache", cache);
  },
});

