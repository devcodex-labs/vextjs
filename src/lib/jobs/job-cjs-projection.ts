import { createSourceBindings } from "../source-bindings.js";
import {
  parseSourceSyntax,
  walkSourceSyntax,
  type SyntaxNode,
} from "../source-syntax.js";
import { staticKey } from "../../tooling/project-index/static-values.js";

type Lexical = ReturnType<typeof createSourceBindings>;
type Identifier = Extract<SyntaxNode, { type: "Identifier" }>;
type Entry = { id: Identifier; value: SyntaxNode };

// Locked esbuild 0.28.x transport semantics, including its minifySyntax form.
// Names are alpha-normalized by lexical identity; markers alone grant nothing.
const templates = [
  `var D=Object.defineProperty,G=Object.getOwnPropertyDescriptor,N=Object.getOwnPropertyNames,H=Object.prototype.hasOwnProperty;
var E=(target,all)=>{for(var name in all)D(target,name,{get:all[name],enumerable:true});};
var C=(to,from,except,desc)=>{if(from&&typeof from==="object"||typeof from==="function"){for(let key of N(from))if(!H.call(to,key)&&key!==except)D(to,key,{get:()=>from[key],enumerable:!(desc=G(from,key))||desc.enumerable});}return to;};
var T=(mod)=>C(D({},"__esModule",{value:true}),mod);
var A=Object.create,P=Object.getPrototypeOf;
var U=(mod,isNodeMode,target)=>(target=mod!=null?A(P(mod)):{},C(isNodeMode||!mod||!mod.__esModule?D(target,"default",{value:mod,enumerable:true}):target,mod));
var K=(target,value)=>D(target,"name",{value,configurable:true});`,
  `var D=Object.defineProperty,G=Object.getOwnPropertyDescriptor,N=Object.getOwnPropertyNames,H=Object.prototype.hasOwnProperty;
var E=(o,e)=>{for(var t in e)D(o,t,{get:e[t],enumerable:!0})},C=(o,e,t,p)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of N(e))!H.call(o,r)&&r!==t&&D(o,r,{get:()=>e[r],enumerable:!(p=G(e,r))||p.enumerable});return o};var T=o=>C(D({},"__esModule",{value:!0}),o);
var A=Object.create,P=Object.getPrototypeOf;
var U=(o,e,r)=>(r=o!=null?A(P(o)):{},C(e||!o||!o.__esModule?D(r,"default",{value:o,enumerable:!0}):r,o));
var K=(o,e)=>D(o,"name",{value:e,configurable:!0});`,
];
const roles = ["D", "G", "N", "H", "E", "C", "T"];

function entries(program: SyntaxNode): Entry[] {
  if (program.type !== "Program") return [];
  return program.body.flatMap((statement) =>
    statement.type === "VariableDeclaration"
      ? statement.declarations.flatMap((item) =>
          item.id.type === "Identifier" && item.init
            ? [{ id: item.id, value: item.init }]
            : [],
        )
      : [],
  );
}

/** Compare syntax and binding identity, never execute a candidate transport. */
function fingerprint(
  node: SyntaxNode,
  lexical: Lexical,
  external: Map<Identifier, string>,
): string {
  const locals = new Map<Identifier, number>();
  const encode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(encode);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.type === "Identifier") {
      const id = value as Identifier;
      const binding = lexical.resolve(id)?.identifier;
      if (binding && (lexical.isReference(id) || binding === id)) {
        const role = external.get(binding);
        if (role) return { type: "Identifier", role };
        if (!locals.has(binding)) locals.set(binding, locals.size);
        return { type: "Identifier", local: locals.get(binding) };
      }
      return { type: "Identifier", name: id.name };
    }
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter(
          (key) =>
            ![
              "start",
              "end",
              "raw",
              "comments",
              "leadingComments",
              "trailingComments",
            ].includes(key),
        )
        .map((key) => [key, encode(record[key])]),
    );
  };
  return JSON.stringify(encode(node));
}

let cachedTemplates: Map<string, string>[] | undefined;
function trustedTemplates(): Map<string, string>[] {
  return (cachedTemplates ??= templates.map((source) => {
    const program = parseSourceSyntax("job-transport.cjs", source);
    const lexical = createSourceBindings(program);
    const items = entries(program);
    const external = new Map(items.map((item) => [item.id, item.id.name]));
    return new Map(
      items.map((item) => [
        item.id.name,
        fingerprint(item.value, lexical, external),
      ]),
    );
  }));
}

export interface CjsJobProjection {
  unwrapName(node: SyntaxNode): SyntaxNode;
  exports: Map<string, SyntaxNode>;
  allowedModuleAssignments: Set<SyntaxNode>;
  namespaceSource(node: SyntaxNode): string | undefined;
}

/** A complete finite export table plus unchanged transport helpers is required. */
export function readCjsJobProjection(
  program: SyntaxNode,
  lexical: Lexical,
): CjsJobProjection | undefined {
  if (program.type !== "Program") return;
  const items = entries(program);
  const trusted = trustedTemplates();
  // Ordinary constants can use the same Object primitives. Prove the complete
  // linked helper set rather than treating a duplicate primitive as an escape.
  const solutions: {
    external: Map<Identifier, string>;
    selected: Map<string, Entry>;
  }[] = [];
  let budget = 4096;
  const choose = (
    index: number,
    external: Map<Identifier, string>,
    selected: Map<string, Entry>,
  ) => {
    if (--budget < 0 || solutions.length > 1) return;
    if (index === roles.length) {
      solutions.push({ external, selected });
      return;
    }
    const role = roles[index]!;
    for (const item of items)
      if (
        !external.has(item.id) &&
        trusted.some(
          (template) =>
            template.get(role) === fingerprint(item.value, lexical, external),
        )
      )
        choose(
          index + 1,
          new Map([...external, [item.id, role]]),
          new Map([...selected, [role, item]]),
        );
  };
  choose(0, new Map(), new Map());
  if (budget < 0 || solutions.length !== 1) return;
  const { external, selected } = solutions[0]!;
  for (const role of ["A", "P", "U", "K"]) {
    const matches = items.filter((item) =>
      trusted.some(
        (template) =>
          template.get(role) === fingerprint(item.value, lexical, external),
      ),
    );
    if (matches.length !== 1) continue;
    external.set(matches[0]!.id, role);
    selected.set(role, matches[0]!);
  }
  const identity = (node: SyntaxNode) =>
    node.type === "Identifier" ? lexical.resolve(node)?.identifier : undefined;
  const roleOf = (node: SyntaxNode) => {
    const key = identity(node);
    return key && external.get(key);
  };
  const unbound = (node: SyntaxNode, name: string) =>
    node.type === "Identifier" && node.name === name && !lexical.resolve(node);
  const moduleExport = (node: SyntaxNode) =>
    node.type === "MemberExpression" &&
    !node.computed &&
    unbound(node.object, "module") &&
    staticKey(node.property) === "exports";
  const containers = new Set(
    items
      .filter(
        (item) =>
          item.value.type === "ObjectExpression" &&
          !item.value.properties.length,
      )
      .map((item) => item.id),
  );
  let container: Identifier | undefined;
  let table: Map<string, SyntaxNode> | undefined;
  const permitted = new Set<SyntaxNode>(
    [...selected.values()].map((item) => item.value),
  );
  const allowedModuleAssignments = new Set<SyntaxNode>();
  let moduleAssignment: SyntaxNode | undefined;
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement") continue;
    const expression = statement.expression;
    if (
      expression.type === "CallExpression" &&
      roleOf(expression.callee) === "E"
    ) {
      const [target, values] = expression.arguments;
      const targetId = target && identity(target);
      if (
        table ||
        expression.arguments.length !== 2 ||
        !targetId ||
        !containers.has(targetId) ||
        values?.type !== "ObjectExpression"
      )
        return;
      container = targetId;
      table = new Map();
      for (const property of values.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        )
          return;
        const name = staticKey(property.key);
        const getter = property.value;
        if (
          !name ||
          table.has(name) ||
          getter.type !== "ArrowFunctionExpression" ||
          getter.async ||
          getter.params.length ||
          !(
            getter.body.type === "Identifier" ||
            (getter.body.type === "MemberExpression" &&
              !getter.body.computed &&
              staticKey(getter.body.property) === "default" &&
              getter.body.object.type === "Identifier")
          )
        )
          return;
        table.set(name, getter.body);
      }
      permitted.add(expression);
    }
    if (
      expression.type === "AssignmentExpression" &&
      moduleExport(expression.left)
    ) {
      const call = expression.right;
      if (
        moduleAssignment ||
        expression.operator !== "=" ||
        call.type !== "CallExpression" ||
        roleOf(call.callee) !== "T" ||
        call.arguments.length !== 1
      )
        return;
      const target = call.arguments[0];
      if (!target || identity(target) !== container) return;
      moduleAssignment = expression;
      allowedModuleAssignments.add(expression);
      permitted.add(expression);
    }
    // Node's unreachable named-export annotation has no runtime mutation.
    if (
      expression.type === "LogicalExpression" &&
      expression.operator === "&&" &&
      expression.left.type === "Literal" &&
      expression.left.value === 0
    ) {
      const assignment = expression.right;
      if (
        assignment.type === "AssignmentExpression" &&
        assignment.operator === "=" &&
        moduleExport(assignment.left) &&
        assignment.right.type === "ObjectExpression" &&
        assignment.right.properties.every(
          (property) =>
            property.type === "Property" &&
            property.shorthand &&
            !property.computed &&
            property.value.type === "Identifier",
        )
      ) {
        permitted.add(expression);
        allowedModuleAssignments.add(assignment);
      }
    }
  }
  if (!table?.has("default") || !container || !moduleAssignment) return;
  const protectedBindings = new Set([...external.keys(), container]);
  const namespaceSource = (node: SyntaxNode): string | undefined => {
    if (node.type !== "CallExpression") return;
    if (
      roleOf(node.callee) === "U" &&
      node.arguments.length >= 1 &&
      node.arguments.length <= 2 &&
      (!node.arguments[1] ||
        (node.arguments[1].type === "Literal" && node.arguments[1].value === 1))
    ) {
      const argument = node.arguments[0];
      return argument && argument.type !== "SpreadElement"
        ? namespaceSource(argument)
        : undefined;
    }
    if (!unbound(node.callee, "require") || node.arguments.length !== 1) return;
    const argument = node.arguments[0];
    return argument?.type === "Literal" && typeof argument.value === "string"
      ? argument.value
      : undefined;
  };
  const nameCallees = new Set<SyntaxNode>();
  walkSourceSyntax(program, (node) => {
    if (
      node.type === "CallExpression" &&
      roleOf(node.callee) === "U" &&
      namespaceSource(node)
    )
      permitted.add(node);
    if (
      node.type === "CallExpression" &&
      roleOf(node.callee) === "K" &&
      node.arguments.length === 2 &&
      node.arguments[1]?.type === "Literal" &&
      typeof node.arguments[1].value === "string" &&
      (node.arguments[0]?.type === "Identifier" ||
        node.arguments[0]?.type === "ArrowFunctionExpression" ||
        node.arguments[0]?.type === "FunctionExpression")
    )
      nameCallees.add(node.callee);
  });
  let safe = true;
  const inspectWrite = (target: SyntaxNode | null | undefined): void => {
    if (!target) return;
    if (target.type === "MemberExpression") {
      inspectWrite(target.object);
      return;
    }
    if (target.type === "ObjectPattern")
      for (const property of target.properties)
        inspectWrite(
          property.type === "Property" ? property.value : property.argument,
        );
    if (target.type === "ArrayPattern")
      for (const element of target.elements) inspectWrite(element);
    if (target.type === "RestElement") inspectWrite(target.argument);
    if (target.type === "AssignmentPattern") inspectWrite(target.left);
    if (protectedBindings.has(identity(target)!) || unbound(target, "Object"))
      safe = false;
  };
  walkSourceSyntax(program, (node, _parent, ancestors) => {
    if (
      node.type === "Identifier" &&
      lexical.isReference(node) &&
      protectedBindings.has(identity(node)!)
    ) {
      if (
        !nameCallees.has(node) &&
        !ancestors.some((ancestor) => permitted.has(ancestor))
      )
        safe = false;
    }
    if (node.type === "AssignmentExpression") inspectWrite(node.left);
    if (node.type === "UpdateExpression") inspectWrite(node.argument);
    if (node.type === "ForInStatement" || node.type === "ForOfStatement")
      inspectWrite(node.left);
  });
  const unwrapName = (node: SyntaxNode): SyntaxNode =>
    node.type === "CallExpression" &&
    nameCallees.has(node.callee) &&
    node.arguments[0] &&
    node.arguments[0].type !== "SpreadElement"
      ? node.arguments[0]
      : node;
  return safe
    ? { exports: table, allowedModuleAssignments, namespaceSource, unwrapName }
    : undefined;
}
