import { definePlugin } from "vextjs";

function registerIgnored(app: { extend: (key: string, value: unknown) => void }) {
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
  },
  onReady(app) {
    app.extend("readyState", { value: true });
  },
});

void registerIgnored;

