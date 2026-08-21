import type { VextUserConfig } from "vextjs";

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error(
    "[crud-api] MONGODB_URI is required; use an isolated database for this example.",
  );
}

const config: VextUserConfig = {
  host: "127.0.0.1",
  port: Number(process.env.PORT ?? 3100),
  adapter: "native",
  database: {
    config: {
      uri: mongoUri,
    },
  },
  openapi: {
    enabled: true,
    title: "Vext CRUD API",
    description: "Executable Todo CRUD example backed by app.db.",
    version: "2.0.0",
  },
  rateLimit: {
    enabled: false,
  },
};

export default config;
