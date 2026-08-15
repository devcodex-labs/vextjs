const port = Number.parseInt(process.env.PORT ?? "3000", 10);

/**
 * This is intentionally a normal Vext application, not the Core diagnostic
 * harness. Every enabled feature participates in the public workload.
 */
export default {
  adapter: "native",
  host: "127.0.0.1",
  port,
  logger: {
    level: "silent",
    pretty: false,
  },
  requestId: {
    enabled: true,
  },
  requestContext: {
    enabled: true,
  },
  bodyParser: {
    enabled: true,
  },
  response: {
    wrap: false,
  },
  rateLimit: {
    enabled: false,
  },
  cors: {
    enabled: false,
  },
  securityHeaders: {
    enabled: true,
    preset: "basic",
  },
  accessLog: {
    enabled: true,
    skipPathPrefixes: ["/benchmark"],
  },
  session: {
    enabled: false,
  },
  csrf: {
    enabled: false,
  },
  frontend: {
    enabled: false,
  },
  openapi: {
    enabled: false,
  },
  middlewares: ["enterprise-auth"],
};
