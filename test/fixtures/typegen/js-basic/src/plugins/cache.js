import { definePlugin } from "vextjs";

export default definePlugin({
  name: "user-cache",
  setup(app) {
    const cache = {
      get(key) {
        return key;
      },
    };
    app.extend("userCache", cache);
  },
});
