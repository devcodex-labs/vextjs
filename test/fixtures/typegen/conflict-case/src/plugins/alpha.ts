/// <reference path="../types/vextjs.d.ts" />

import { definePlugin } from "vextjs";

export default definePlugin({
  name: "alpha",
  setup(app) {
    app.extend("shared", {
      send(message: string) {
        return message;
      },
    });
  },
});

