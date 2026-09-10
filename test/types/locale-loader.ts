import { loadI18n, type VextApp } from "vextjs";

declare const app: VextApp;
const languages: Promise<string[]> = loadI18n(app, "src/locales");
void languages;
void loadI18n(app, "dist/locales", { rootDir: process.cwd(), compiled: true });
// The public API binds to a real app, not a path/logger or a private replacement callback.
// @ts-expect-error A directory is not an application.
void loadI18n("src/locales", app.logger);
// @ts-expect-error Internal dictionary mutation callbacks are not public options.
void loadI18n(app, "src/locales", () => {});
