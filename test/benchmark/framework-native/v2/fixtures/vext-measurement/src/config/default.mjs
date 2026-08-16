const port = Number.parseInt(process.env.PORT ?? "0", 10);

export default {
  adapter: "native",
  host: "127.0.0.1",
  port,
  logger: { level: "info", pretty: false },
  requestId: { enabled: true },
  requestContext: { enabled: true },
  bodyParser: { enabled: true },
  response: { wrap: false },
  rateLimit: { enabled: false },
  cors: { enabled: false },
  securityHeaders: { enabled: true, preset: "basic" },
  accessLog: { enabled: true },
  session: { enabled: false },
  csrf: { enabled: false },
  frontend: { enabled: false },
  openapi: { enabled: false },
  middlewares: ["benchmark-auth"],
};
