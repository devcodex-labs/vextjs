---
role: troubleshooting
---

# Error handling

Use this page to diagnose failures in routes and middleware. First inspect the HTTP status, response body, request Accept header, and requestId. Then distinguish input validation, business rejection, authentication, and unknown exceptions. Errors thrown or awaited along the request call chain are handed to the framework; a detached background Promise or timer failure should not be assumed to become the current request's response.

See [HTTP and Routing Specifications](/specification/http-and-routing) for route and validation responsibilities.

## Diagnose by Symptom

| Symptom                                                                    | Check first                                                                        | Verify after the fix                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Startup reports a route definition, prefix conflict, or missing middleware | Default export, synchronous factory, entry prefix, configuration allowlist         | Restart successfully, then request the exact method and full path                                                   |
| Route returns 404                                                          | Duplicate file prefix, HTTP method, excluded entry, or an intentional business 404 | Verify loading with the Routing guide's minimal example; distinguish framework Not Found from business message/code |
| 400 / 422 with `errors`                                                    | Position and fields of `validate`, request body format, Content-Type               | Invalid input still fails; schema-compliant input enters the handler                                                |
| 401 / 403 with `AUTH_*`                                                    | Whether auth middleware establishes `req.auth`; role and permission requirements   | Missing credentials still fail; valid credentials with permission succeed                                           |
| 500 / Internal Server Error                                                | Correlate server logs by requestId and inspect the exception propagation chain     | The request succeeds after fixing the cause; unexpected errors remain logged                                        |
| Browser displays HTML while an API tool displays JSON                      | Accept, development overlay, page error rendering                                  | Request JSON explicitly with `Accept: application/json` and check its contract                                      |
| Body `code` differs from HTTP status                                       | Explicit business code or code from an i18n configuration                          | Assert HTTP status and business code separately                                                                     |

See the [Routing guide](/guide/routing) for route declarations, [Middleware guide](/guide/middleware) for allowlists, and [Route Definition](/api/route-definition#auth) for `AUTH_*`.

## Minimal Reproduction and Verification

In a runnable VextJS project, add the following file. If you do not have a project yet, follow [Quick Start](/guide/quick-start). This example needs no service or database. Verify it with the default `response.hideInternalErrors: true` and JSON requests.

```ts
// src/routes/error-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/missing", (_req, _res) => {
    app.throw({
      status: 404,
      message: "Item not found",
      code: "ITEM_NOT_FOUND",
      details: { itemId: "example" },
    });
  });
  app.get(
    "/item/:id",
    { validate: { param: { id: "integer:1-!" } } },
    (req, res) => {
      res.json(req.valid("param"));
    },
  );
  app.post("/", { validate: { body: { email: "email!" } } }, (req, res) => {
    res.json(req.valid("body"));
  });
  app.get("/unknown", () => {
    throw new Error("Example internal failure");
  });
});
```

Create two UTF-8 request files in the project root: `error-invalid.json` containing `{}`, and `error-valid.json` containing:

```json
{ "email": "a@example.com" }
```

Run `npm run dev`, then send the following requests from another terminal. These commands assume `http://127.0.0.1:3000` and set `Accept: application/json`. In Windows PowerShell, use `curl.exe` to invoke actual curl.

```bash
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/missing
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/item/abc
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/item/1
curl -i -H "Accept: application/json" -H "Content-Type: application/json" --data-binary @error-invalid.json http://127.0.0.1:3000/error-demo
curl -i -H "Accept: application/json" -H "Content-Type: application/json" --data-binary @error-valid.json http://127.0.0.1:3000/error-demo
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/unknown
```

Check each result:

| Request                                             | Expected observation                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| GET `/error-demo/missing`                           | HTTP 404, `code` ITEM_NOT_FOUND, `details.itemId` example |
| GET `/error-demo/item/abc`                          | HTTP 400, `errors` contains the `id` field                |
| GET `/error-demo/item/1`                            | HTTP 200, default wrapped `data.id` is numeric 1          |
| POST `/error-demo` with `{}`                        | HTTP 422, `errors` contains the `email` field             |
| POST `/error-demo` with `{"email":"a@example.com"}` | HTTP 200                                                  |
| GET `/error-demo/unknown`                           | Default HTTP 500, message Internal Server Error, no stack |

Set `Content-Type: application/json` on POST requests as shown. If results differ, compare the project's response configuration, validator, error hooks, and middleware before changing business logic. Do not disable validation or swallow exceptions merely to make the example pass.

## `app.throw`

**Symptom: an expected business rejection returns 500 or loses its business code.** Check whether ordinary `new Error()` was used and whether a business code was mistaken for an HTTP status. Use the structured form when specifying a status, code, or details; after the fix, check response status and body code separately.

`app.throw` is suitable for scenarios where "I want to actively return clear HTTP errors", such as 401, 404, 409, 502, or responses that require business codes, i18n parameters, and third-party error details.

```ts
// Basic error
app.throw(404, "user.not_found");

// Business error code
app.throw(409, "email.taken", "EMAIL_TAKEN");

// i18n interpolation parameter + business error code
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);

// When the fourth parameter is an object or array, it is output as details
app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

// When code + details are required at the same time, use the object entry
app.throw({
  status: 502,
  message: "payment.failed",
  code: "PAYMENT_FAILED",
  details: { provider: "stripe", providerCode: "card_declined" },
});
```

The return type of `app.throw()` is `never`. After calling, the current processing flow will be interrupted, no additional `return` is required.

## `details`

**Symptom: third-party failure details are missing from the response.** The framework does not copy every property from a third-party error into the body by default. Check whether `details` was supplied explicitly and whether any serializable content remains after cleaning.

`details` is used to explicitly return business details, which is common in third-party interface or downstream service errors:

- Upstream business code, original message, trace id
- Reason for failure that can be shown to the caller
- Third-party response fragments trimmed by the application

The framework performs JSON-safe cleaning before writing the response. Circular or repeated object references become `"[Circular]"`; `Date` becomes an ISO string; `Error` retains only `name/message`. Function and `undefined` properties are omitted from objects, but keep their positions as `null` in arrays. Objects at depth 8 are truncated to `"[MaxDepth]"`; BigInt becomes a string.

Top-level scalars are wrapped as `{ value: ... }`. Empty objects, empty arrays, and details with no retained values are omitted. The returned details therefore need not have exactly the same shape as the input.

Prefer explicitly passing details through `HttpError` or `app.throw`. Error normalization also reads and cleans a `details` property explicitly attached to an exception. Do not treat `hideInternalErrors` as a filter for arbitrary custom details, and do not expose an entire third-party exception without trimming it for callers.

## Response format

```json
{
  "code": "PAYMENT_FAILED",
  "message": "Payment failed",
  "details": {
    "provider": "stripe",
    "providerCode": "card_declined"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`code` prefers an explicit business code, may come from i18n configuration, and otherwise falls back to HTTP status. HTTP status and body `code` are separate fields.

## Differences from ordinary Error

**Symptom: only a 500 appears, or browser and curl receive different formats.** Ordinary `new Error()` enters the default 500 path. Normalization also reads an error's `status` / `statusCode`; a deliberate HTTP error entry avoids depending on a third-party exception's shape.

```ts
// Structured business error: returns the specified status/message/code/details
app.throw(404, "user.not_found");

// Unexpected runtime error: enters the 500 path
throw new Error("Database connection lost");
```

`response.hideInternalErrors` defaults to true and hides internal messages and stack traces for unknown 5xx errors. Set it to false locally if JSON stack inspection is needed. Explicit structured errors follow their own contract. When browser Accept includes `text/html`, a development overlay or page-error renderer may return HTML; request `application/json` explicitly when diagnosing a JSON API.

By default the server logs unknown exceptions and HttpError 5xx, but not validation errors. HttpError 4xx logging requires `response.logErrors.http4xx: true`. If logs are missing, inspect the logger, `logErrors`, and any custom middleware that catches and swallows errors. A catch used only for logging should rethrow the original error.

## Validation Errors

**Symptom: similar invalid inputs sometimes return 400 and sometimes 422.** Check the validation location first: path parameters use 400, other declared locations use 422. Inspect raw input, schema, and `errors[].field`, then correct the request and retry; do not collapse both cases into one status simply because the data is invalid.

When route `validate` fails, invalid path parameters return HTTP `400`; query, header, cookie, and body failures return HTTP `422`. Both include field-level error details. Custom field-level errors can throw `VextValidationError`:

```ts
import { VextValidationError } from "vextjs";

throw new VextValidationError([{ field: "email", message: "Invalid email" }]);
```

## More references

- [`app.throw` API](/api/app#appthrowstatus-message-paramsorcode-codeordetails)
- [Error handling in middleware](/guide/middleware#error-handling-middleware)
- [Error handling in routing](/guide/routing#error-handling)
- [Response configuration](/guide/configuration#response-configuration-response)
- [HTTP and Routing Specifications](/specification/http-and-routing)
