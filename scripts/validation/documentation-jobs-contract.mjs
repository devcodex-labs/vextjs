import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function syntax(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

// Read public fields from the real type declarations. No runtime modules or
// user applications are imported to validate documentation.
export function jobsDocumentationSchema(root) {
  const file = syntax(
    "types.ts",
    readFileSync(path.join(root, "src/lib/jobs/types.ts"), "utf8"),
  );
  const declarations = new Map(
    file.statements
      .filter(
        (node) =>
          ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
      )
      .map((node) => [node.name.text, node]),
  );
  function members(node) {
    if (!node)
      throw new Error(
        "Cannot resolve a Jobs public type from src/lib/jobs/types.ts",
      );
    if (ts.isTypeReferenceNode(node))
      return members(declarations.get(node.typeName.getText(file)));
    if (ts.isTypeAliasDeclaration(node)) return members(node.type);
    if (ts.isIntersectionTypeNode(node)) return node.types.flatMap(members);
    return [...(node?.members ?? [])].filter(ts.isPropertySignature);
  }
  const job = members(declarations.get("VextJobDefinitionInput"));
  const global = members(declarations.get("VextJobsConfig"));
  const redis = global.find((node) => node.name.getText(file) === "redis");
  const names = (nodes, prefix = "") =>
    nodes.map((node) => prefix + node.name.getText(file));
  return {
    "job-options": names(job),
    "jobs-options": names(global, "jobs."),
    "redis-options": names(members(redis.type), "jobs.redis."),
    "job-context": names(members(declarations.get("VextJobContext"))),
    "job-docs": names(members(declarations.get("VextJobDocsConfig")), "docs."),
    required: names(job.filter((node) => !node.questionToken)),
    defaults: jobsDefaults(root),
  };
}

function jobsDefaults(root) {
  const source = (name) =>
    syntax(name, readFileSync(path.join(root, name), "utf8"));
  const app = source("src/lib/app.ts");
  let config;
  visit(app, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(app) === "DEFAULT_CONFIG"
    )
      config = node.initializer;
  });
  const property = (object, name) =>
    object.properties.find((node) => node.name?.getText(app) === name)
      .initializer;
  const jobs = property(config, "jobs");
  const redis = source("src/lib/jobs/redis-coordinator.ts");
  let ttl;
  visit(redis, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(redis) === "ttl" &&
      ts.isBinaryExpression(node.initializer)
    )
      ttl = Number(node.initializer.right.getText(redis));
  });
  const definition = source("src/lib/jobs/define-job.ts");
  let minimum;
  visit(definition, (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "validateJobLeaseTtl"
    )
      visit(node, (child) => {
        if (
          ts.isBinaryExpression(child) &&
          child.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
          ts.isNumericLiteral(child.right)
        )
          minimum = Number(child.right.text);
      });
  });
  if (!Number.isFinite(ttl) || !Number.isFinite(minimum))
    throw new Error("Cannot read Jobs TTL defaults/constraints from source");
  return {
    "jobs.enabled": property(jobs, "enabled").getText(app),
    "jobs.dir": property(jobs, "dir").text,
    "jobs.timezone": property(jobs, "timezone").text,
    leaseTtl: ttl,
    minimumLeaseTtl: minimum,
  };
}

export function collectJobsDocumentation(root, locales = ["zh", "en"]) {
  const result = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.mdx?$/.test(entry.name))
        result.set(
          path.relative(root, file).replaceAll("\\", "/"),
          readFileSync(file, "utf8"),
        );
    }
  }
  for (const locale of locales) visit(path.join(root, "website/docs", locale));
  return result;
}

function fieldTable(source, anchor) {
  const marker = `<a id="${anchor}"></a>`;
  const start = source.indexOf(marker);
  if (start < 0) return [];
  const section = source
    .slice(start + marker.length)
    .split(/\n(?:#{1,6} |<a id=)/)[0];
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(
    (match) => match[1],
  );
}

function fieldRows(source) {
  return new Map(
    source
      .split(/\r?\n/)
      .filter((line) => /^\|\s*`[^`]+`\s*\|/.test(line))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim().replaceAll("`", "")),
      )
      .map((cells) => [cells[0], cells]),
  );
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function exampleErrors(code, file, schema) {
  const tree = syntax(file, code);
  const factories = new Set();
  const namespaces = new Set();
  visit(tree, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "vextjs"
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if ((element.propertyName ?? element.name).text === "defineJob")
            factories.add(element.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(tree) === "require" &&
      node.initializer.arguments[0]?.getText(tree).match(/^["']vextjs["']$/)
    ) {
      if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name))
        for (const element of node.name.elements)
          if (
            (element.propertyName ?? element.name).getText(tree) === "defineJob"
          )
            factories.add(element.name.getText(tree));
    }
  });
  const calls = [];
  visit(tree, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (
      (ts.isIdentifier(callee) && factories.has(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "defineJob" &&
        namespaces.has(callee.expression.getText(tree)))
    )
      calls.push(node);
  });
  const errors = [];
  for (const call of calls) {
    const value = call.arguments[0];
    if (!value || !ts.isObjectLiteralExpression(value)) continue;
    const keys = value.properties
      .filter((property) => property.name)
      .map((property) =>
        property.name.getText(tree).replace(/^["']|["']$/g, ""),
      );
    for (const key of keys)
      if (!schema["job-options"].includes(key))
        errors.push(`unsupported Job field ${key}`);
    if (!value.properties.some(ts.isSpreadAssignment))
      for (const key of schema.required)
        if (!keys.includes(key)) errors.push(`Job example requires ${key}`);
  }
  const registersFile = tree.statements.some(
    (node) =>
      ts.isExportAssignment(node) ||
      (ts.isExpressionStatement(node) &&
        ts.isBinaryExpression(node.expression) &&
        node.expression.left.getText(tree) === "module.exports"),
  );
  if (registersFile && calls.length > 1)
    errors.push("a selected Job file must contain one default SDK Job");
  if (
    calls.length &&
    /\/\/\s*src\/(?:jobs|tasks)\//.test(code) &&
    !registersFile
  )
    errors.push("a selected Job file needs a default export");
  return errors;
}

function releaseNotice(source) {
  // Check meaning as well as the original callout title. Normal install/version
  // commands and release-channel navigation remain legal.
  return (
    /发布版本与源码范围|Release and source scope|Published stable package:|已发布稳定包：/i.test(
      source,
    ) ||
    /(?:npm|published)(?=[^\n。]*(?:lag|behind|not yet|differ))[^\n。]*(?:repository source|源码)|(?:repository source|源码)[^\n。]*(?:not yet.{0,20}publish|尚未发布|未包含.{0,20}npm)/i.test(
      source,
    )
  );
}

export function verifyJobsDocumentation({
  root,
  documents = collectJobsDocumentation(root),
}) {
  const schema = jobsDocumentationSchema(root);
  const failures = [];
  const add = (file, message) => failures.push(`${file}: ${message}`);
  for (const [file, source] of documents) {
    if (/\/(?:guide|api)\/jobs\.md$/.test(file)) {
      for (const [anchor, fields] of Object.entries(schema)) {
        if (anchor === "required" || anchor === "defaults") continue;
        const actual = fieldTable(source, anchor);
        if (
          actual.length !== fields.length ||
          new Set(actual).size !== actual.length ||
          fields.some((field) => !actual.includes(field))
        )
          add(file, `${anchor} field table differs from src/lib/jobs/types.ts`);
      }
      const rows = fieldRows(source);
      for (const field of ["jobs.enabled", "jobs.dir", "jobs.timezone"])
        if (!rows.get(field)?.[2]?.includes(schema.defaults[field]))
          add(file, `default for ${field} differs from src/lib/app.ts`);
      for (const [field, column] of [
        ["leaseTtl", 3],
        ["jobs.redis.leaseTtl", 2],
      ]) {
        const row = rows.get(field);
        if (!row?.[column]?.includes(String(schema.defaults.leaseTtl)))
          add(file, `default for ${field} differs from the Redis coordinator`);
        if (!row?.join(" ").includes(String(schema.defaults.minimumLeaseTtl)))
          add(file, `minimum ${field} differs from defineJob validation`);
      }
      const plain = source.replaceAll("`", "");
      for (const priority of [
        "Job.timezone > jobs.timezone > UTC",
        `Job.leaseTtl > jobs.redis.leaseTtl > ${schema.defaults.leaseTtl}`,
        "client > url > uri > VEXT_REDIS_URL > REDIS_URL",
      ])
        if (!plain.includes(priority))
          add(file, `missing precedence ${priority}`);
    }
    if (/\/guide\/(?:quick-start|cli)\.md$/.test(file) && releaseNotice(source))
      add(
        file,
        "remove permanent package/source release notices in every version channel",
      );

    const prose = source
      .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "")
      .replaceAll("`", "");
    for (const sentence of prose.split(/[。;\n]/)) {
      if (!/jobs?|cron|定时任务/i.test(sentence)) continue;
      const mixedSchedule = /cron\s*\/\s*interval/i.exec(sentence);
      const rejectsMixed =
        mixedSchedule &&
        /(?:rejects?|does not support|no longer supports?|不支持|拒绝|不接受)\s*["'“”]?\s*$/i.test(
          sentence.slice(0, mixedSchedule.index),
        );
      if (mixedSchedule && !rejectsMixed)
        add(file, "Jobs is Cron-only; remove supported cron / interval prose");
      const intervalSupport =
        /(?:supports?|accepts?|allows?|支持)\s*interval\b/i.exec(sentence);
      if (intervalSupport) {
        const before = sentence.slice(0, intervalSupport.index);
        if (
          /(?:jobs?|定时任务)[^.。;\n]*$/i.test(before) &&
          !/(?:not|no longer|n't|不)\s*$/i.test(before)
        )
          add(file, "Jobs is Cron-only; interval is not a supported schedule");
      }
      if (
        /(?:built-in\s+(?:application\s+)?Cluster.{0,50}(?:require|must)|内置\s*Cluster.{0,30}必须).{0,35}Redis/i.test(
          sentence,
        ) &&
        !/(?:does not|do not|never|without|无需|不需要|不要求|不必).{0,40}(?:require|Redis)|not required/i.test(
          sentence,
        )
      )
        add(file, "one built-in Cluster does not require Redis");
      if (/整体就绪后才(?:开放调度|允许执行)|任务整体就绪后运行/.test(sentence))
        add(
          file,
          "Worker activation precedes the overall readiness acknowledgement",
        );
    }
    const fences =
      /^(?<fence>`{3,}|~{3,})(?<info>[^\n]*)\n(?<code>[\s\S]*?)^\k<fence>\s*$/gm;
    for (const match of source.matchAll(fences)) {
      if (
        !/^(?:typescript|javascript|ts|js|mjs|cjs)\b/.test(
          match.groups.info.trim(),
        )
      )
        continue;
      if (/\b(?:invalid|reference)\b/.test(match.groups.info)) continue;
      for (const error of exampleErrors(match.groups.code, file, schema))
        add(file, error);
    }
  }
  return failures;
}
