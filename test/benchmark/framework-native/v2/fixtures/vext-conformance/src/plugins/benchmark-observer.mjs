import { definePlugin } from "vextjs";

import { ConformanceObserver } from "../../../../observation.mjs";

export const observer = new ConformanceObserver();

export default definePlugin({
  name: "framework-native-v2-conformance-observer",
  setup() {},
});
