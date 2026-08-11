import type {
  IDslBuilder,
  InferDslDefinition,
  InferSchema,
} from "schema-dsl/pure";

/** Request locations supported by RouteOptions.validate and req.valid(). */
export type VextValidationLocation =
  | "query"
  | "body"
  | "param"
  | "header"
  | "cookie";

/** Broad validated-data shape used when a handler has no route schema context. */
export type VextDefaultValidatedData = Record<
  VextValidationLocation,
  Record<string, any>
>;

/** Shape consumed by a typed VextRequest or VextHandler. */
export type VextValidatedData = Record<VextValidationLocation, unknown>;

/**
 * Infer the runtime value represented by one Vext schema definition.
 *
 * schema-dsl owns DSL-string and object inference. Vext only adapts its
 * single-item array shorthand and deliberately treats chainable builders as
 * unknown because their runtime mutations cannot be recovered from the
 * public builder interface alone.
 */
type NormalizeVextSchema<TSchema> = TSchema extends IDslBuilder
  ? true
  : TSchema extends readonly [infer TItem]
    ? { type: "array"; items: NormalizeVextSchema<TItem> }
    : TSchema extends readonly (infer TItem)[]
      ? { type: "array"; items: NormalizeVextSchema<TItem> }
      : TSchema extends
            | { type: unknown }
            | { properties: unknown }
            | { oneOf: unknown }
            | { anyOf: unknown }
            | { enum: unknown }
            | { const: unknown }
        ? TSchema
        : TSchema extends Record<string, unknown>
          ? { [TKey in keyof TSchema]: NormalizeVextSchema<TSchema[TKey]> }
          : TSchema;

export type InferVextSchema<TSchema> = InferSchema<
  NormalizeVextSchema<TSchema>
>;

type InferVextValidationSchema<TSchema> =
  TSchema extends Record<string, unknown>
    ? InferDslDefinition<{
        [TKey in keyof TSchema]: NormalizeVextSchema<TSchema[TKey]>;
      }>
    : InferVextSchema<TSchema>;

type InferVextValidationLocation<
  TValidation,
  TLocation extends VextValidationLocation,
> = TValidation extends object
  ? TLocation extends keyof TValidation
    ? InferVextValidationSchema<Exclude<TValidation[TLocation], undefined>>
    : undefined
  : undefined;

/** Map RouteOptions.validate into the five req.valid() result locations. */
export type InferVextValidation<TValidation> = {
  [TLocation in VextValidationLocation]: InferVextValidationLocation<
    TValidation,
    TLocation
  >;
};
