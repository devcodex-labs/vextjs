import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  types: ["node"],
};

function compileTypeProbe(source: string): readonly ts.Diagnostic[] {
  const root = process.cwd();
  const fileName = path.join(
    root,
    "test",
    "unit",
    "plugins",
    "monsqlize-model-definition-probe.ts",
  );
  const normalizedFileName = path.normalize(fileName);
  const host = ts.createCompilerHost(compilerOptions, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  host.fileExists = (file) =>
    path.normalize(file) === normalizedFileName || fileExists(file);
  host.readFile = (file) =>
    path.normalize(file) === normalizedFileName ? source : readFile(file);
  host.getSourceFile = (file, languageVersion) => {
    const text =
      path.normalize(file) === normalizedFileName ? source : readFile(file);
    return text === undefined
      ? undefined
      : ts.createSourceFile(file, text, languageVersion, true);
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    if (!diagnostic.file) return false;
    const diagnosticFileName = path.normalize(diagnostic.file.fileName);
    return (
      diagnosticFileName === normalizedFileName ||
      (diagnostic.code === 2430 &&
        diagnosticFileName.endsWith(
          path.normalize("src/lib/plugins/monsqlize/types.ts"),
        ))
    );
  });
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return `${diagnostic.file.fileName}:${line + 1}:${character + 1} ${message}`;
}

describe("VextModelDefinition public type", () => {
  it("accepts documented monSQLize schema, hooks and options shapes", () => {
    const diagnostics = compileTypeProbe(`
import type { VextModelDefinition } from "../../../src/lib/plugins/monsqlize/types.js";

const docStyleModel = {
  collection: "users",
  schema: {
    name: "string:1-50!",
    email: "email!",
  },
  hooks: {
    beforeInsert(context) {
      const doc = context.data as { name?: string; slug?: string };
      if (doc.name) {
        doc.slug = doc.name.toLowerCase();
      }
    },
  },
  options: {
    timestamps: true,
    softDelete: { enabled: true, field: "deletedAt" },
    version: true,
    validate: true,
  },
} satisfies VextModelDefinition<{ name: string; slug?: string }>;

const factoryStyleModel = {
  collection: "legacy_users",
  schema: (s) => s({ name: "string!", active: "boolean" }),
  hooks: (model) => ({
    insert: {
      before: (_ctx, doc) => doc,
    },
  }),
  methods: (model) => ({
    instance: {
      label() {
        return String(this.name);
      },
    },
    static: {
      findActive() {
        return model.find({ active: true });
      },
    },
  }),
} satisfies VextModelDefinition<{ name: string; active: boolean }>;

const invalidHookModel = {
  collection: "bad_hooks",
  // @ts-expect-error hooks must be an object or a factory.
  hooks: "beforeInsert",
} satisfies VextModelDefinition;

const invalidOptionsModel = {
  collection: "bad_options",
  options: {
    // @ts-expect-error timestamps must be boolean or a field map.
    timestamps: "yes",
  },
} satisfies VextModelDefinition;

void docStyleModel;
void factoryStyleModel;
void invalidHookModel;
void invalidOptionsModel;
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });
});

describe("MonSQLizeDatabaseConfig public type", () => {
  it("accepts documented Redis cache uri and rejects misspelled connection fields", () => {
    const diagnostics = compileTypeProbe(`
import type { MonSQLizeDatabaseConfig } from "../../../src/lib/plugins/monsqlize/types.js";

const docStyleRedisCache = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  cache: {
    redis: {
      enabled: true,
      uri: "redis://localhost:6379",
      prefix: "myapp:",
      ttl: 3600,
    },
  },
} satisfies MonSQLizeDatabaseConfig;

const legacyRedisCache = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  cache: {
    redis: {
      enabled: true,
      url: "redis://localhost:6379",
    },
  },
} satisfies MonSQLizeDatabaseConfig;

const invalidRedisCache = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  cache: {
    redis: {
      enabled: true,
      // @ts-expect-error Redis cache uses uri; url remains a deprecated alias.
      connection: "redis://localhost:6379",
    },
  },
} satisfies MonSQLizeDatabaseConfig;

void docStyleRedisCache;
void legacyRedisCache;
void invalidRedisCache;
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });

  it("exposes controlled 3.3.0 options and preserves the raw-instance capability boundary", () => {
    const diagnostics = compileTypeProbe(`
import { defineModel, Model } from "monsqlize";
import type {
  MonSQLizeDatabaseConfig,
  VextApp,
  VextMonSQLizeOptions,
} from "../../../src/index.js";

const controlledOptions = {
  schemaDsl: { enabled: false },
  poolFallback: { enabled: true, fallbackStrategy: "primary" },
  maxPoolsCount: 8,
  sync: { enabled: false, targets: [] },
  transaction: { enableRetry: true, maxRetries: 2 },
  findMaxLimit: 2_000,
  findMaxSkip: 20_000,
  requireCursorSecret: true,
  cursorSecretWarning: "always",
  cursorTypes: { createdAt: "date" },
  cursorValueNormalizer: (_field: string, value: unknown) => value,
  log: { slowQueryTag: { event: "db.slow", code: "DB_SLOW" } },
  countQueue: { enabled: true, concurrency: 2 },
  autoIndex: { enabled: true, emitEvents: false },
  cacheAutoInvalidate: true,
  writePathPolicy: { default: "model-only" },
} satisfies VextMonSQLizeOptions;

const database = {
  config: { uri: "mongodb://localhost:27017/myapp" },
  monsqlizeOptions: controlledOptions,
} satisfies MonSQLizeDatabaseConfig;

const protectedOptions = {
  // @ts-expect-error Vext owns the database type.
  type: "mongodb",
  // @ts-expect-error Vext owns databaseName resolution.
  databaseName: "other",
  // @ts-expect-error Vext owns the database alias.
  database: "other",
  // @ts-expect-error Vext owns the connection config.
  config: { uri: "mongodb://other" },
  // @ts-expect-error Vext owns cache construction.
  cache: {},
  // @ts-expect-error Vext owns the logger bridge.
  logger: null,
  // @ts-expect-error Vext owns pool normalization.
  pools: [],
  // @ts-expect-error Vext owns the pool strategy.
  poolStrategy: "auto",
  // @ts-expect-error Use database.maxTimeMS.
  maxTimeMS: 100,
  // @ts-expect-error Use database.findLimit.
  findLimit: 10,
  // @ts-expect-error Use database.findPageMaxLimit.
  findPageMaxLimit: 100,
  // @ts-expect-error Use database.slowQueryMs.
  slowQueryMs: 100,
  // @ts-expect-error Use database.slowQueryLog.
  slowQueryLog: {},
  // @ts-expect-error Use database.autoConvertObjectId.
  autoConvertObjectId: false,
  // @ts-expect-error Use database.namespace.
  namespace: { scope: "database" },
  // @ts-expect-error Use database.cursorSecret.
  cursorSecret: "secret",
  // @ts-expect-error Vext owns model loading.
  models: "./models",
} satisfies VextMonSQLizeOptions;

const unknownOptions = {
  // @ts-expect-error Unknown upstream keys are not accepted implicitly.
  futureTypo: true,
} satisfies VextMonSQLizeOptions;

declare const app: VextApp;

const UserDescriptor = defineModel("typed_users", {
  schema: {
    email: "email!",
    age: "number?",
  },
});
Model.define(UserDescriptor);

async function assertDescriptorInference() {
  const user = await app.db
    ?.model(UserDescriptor)
    .findOne({ email: "hello@example.com" });
  const email: string | undefined = user?.email;
  const age: number | undefined = user?.age;
  // @ts-expect-error The descriptor infers email as string, not number.
  const invalidEmail: number | undefined = user?.email;
  void email;
  void age;
  void invalidEmail;
}

app.db?.model(UserDescriptor);

app.db?.collection<{ embedding: number[] }>("items").vectorSearch({
  index: "items_embedding",
  path: "embedding",
  queryVector: [0.1, 0.2],
  limit: 5,
  numCandidates: 50,
});
app.db?.model<{ embedding: number[] }>("Item").vectorSearch({
  index: "items_embedding",
  path: "embedding",
  queryVector: [0.1, 0.2],
  limit: 5,
  exact: true,
});
app.db?.model("Item").checkRelationUsage({ _id: "item-1" });
app.db?.model("Item").deleteOneWithRelations({ _id: "item-1" });
app.db?.model("Item").forceDeleteWithRelations({ _id: "item-1" });
app.db?.withTransaction(async () => "ok");
app.db?.on("query", () => undefined);
app.db?.startSync();
app.db?.getSyncStats();
app.db?.db("analytics");

app.db?.collection("items").vectorSearch({
  index: "items_embedding",
  path: "embedding",
  queryVector: [0.1, 0.2],
  limit: 5,
  exact: true,
});
app.db?.model("Item").deleteOneWithRelations({ _id: "item-1" });

// @ts-expect-error app.monsqlize was removed in the 2.0 single-entry contract.
app.monsqlize?.model("Item");

// @ts-expect-error client is a readonly Vext extension.
app.db!.client = app.db!.client;

void database;
void protectedOptions;
void unknownOptions;
void assertDescriptorInference;
`);

    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });
});
