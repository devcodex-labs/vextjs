/// <reference path="../types/vextjs.d.ts" />

import { defineAppExtensions, definePlugin } from "vextjs";

export const appExtensions = defineAppExtensions<{
  "metrics.v2": { enabled: boolean };
  "dash-key": { count: number };
  default: { mode: string };
}>();

function registerIgnored(app: {
  extend: (key: string, value: unknown) => void;
}) {
  app.extend("ignoredOutsideLifecycle", { nope: true });
}

export default definePlugin({
  name: "mailer",
  setup(app) {
    const mailer = {
      async send(to: string, subject: string, body: string): Promise<void> {
        void to;
        void subject;
        void body;
      },
    };
    app.extend("mailer", mailer);
    app.extend("bad-key", { invalidAtRuntime: true });
  },
  onReady(app) {
    app.extend("readyState", { value: true });
  },
});

void registerIgnored;
