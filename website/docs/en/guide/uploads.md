# File Uploads

Built-in multipart parsing can read uploaded files into `req.files` and suits small files with explicit size limits. It does not save files automatically or create a temporary directory. This guide builds a verifiable upload endpoint, then explains route overrides and resource boundaries.

## Run a minimal example

Prerequisite: create a Node.js 20+ TypeScript application with [Quick Start](/guide/quick-start) and npm scripts `dev: vext dev`, `build: vext build`, and `start: vext start`. Add these two files, merging existing settings as needed. This example disables global multipart and enables it only on the upload route.

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  bodyParser: { enabled: true, maxBodySize: "16kb" },
  multipart: { enabled: false },
} satisfies VextUserConfig;
```

```typescript
// src/routes/uploads.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      multipart: {
        enabled: true,
        maxFileSize: 1024,
        maxFiles: 1,
        allowedMimeTypes: ["text/plain"],
        files: { document: { description: "Text file", required: true } },
      },
    },
    async (req, res) => {
      // A non-multipart request skips the parser's required-file check.
      const file = req.files?.find((item) => item.fieldname === "document");
      if (!file) {
        return app.throw(400, "Expected document file");
      }
      res.json({
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
      });
    },
  );
});
```

Create three test files in the example project: a five-byte `sample.txt`, a 1,025-byte `oversized.txt`, and a 20 KB `large.txt`. This command writes those files; choose other names if files with these names already exist:

```bash
node -e "const fs = require('node:fs'); fs.writeFileSync('sample.txt', 'hello'); fs.writeFileSync('oversized.txt', 'a'.repeat(1025)); fs.writeFileSync('large.txt', 'a'.repeat(20 * 1024));"
```

Run `npm run dev`; these requests target `http://127.0.0.1:3000`. Windows PowerShell users can invoke real curl with `curl.exe`. `curl -F` generates a boundary automatically; do not add a Content-Type header that omits it:

```bash
curl -i -F "document=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "other=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@sample.txt;type=application/octet-stream" http://127.0.0.1:3000/uploads
curl -i -H "Content-Type: application/json" -d '{}' http://127.0.0.1:3000/uploads
curl -i -F "document=@oversized.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@sample.txt;type=text/plain" -F "document=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@large.txt;type=text/plain" http://127.0.0.1:3000/uploads
```

| Request                                                | Expected result                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| First request, file at most 1,024 bytes                | HTTP 200; `data` contains filename, size, and mimetype, with size in bytes |
| Field named `other`                                    | HTTP 400: required `document` file field is missing                        |
| MIME `application/octet-stream`                        | HTTP 415                                                                   |
| JSON request                                           | HTTP 400, rejected by this example's handler                               |
| `document` over 1,024 bytes, whole request below 16 KB | HTTP 413, per-file limit                                                   |
| Two files in one request                               | HTTP 413, file-count limit                                                 |
| Whole request over 16 KB                               | HTTP 413, body-size limit                                                  |

Stop the development service, run `npm run build -- --typecheck` and `npm start`, then repeat these requests. A successful receive proves only parsing and validation. This example does not persist files. If files must be saved, explicitly design the storage destination, naming policy, failure handling, and deletion policy in an application service.

## Body and file limits

| Setting                      | Default    | Purpose                                                                |
| ---------------------------- | ---------- | ---------------------------------------------------------------------- |
| `bodyParser.enabled`         | `true`     | Global body parsing switch                                             |
| `bodyParser.maxBodySize`     | `"1mb"`    | Whole-request read limit; accepts a byte number or a b/kb/mb/gb string |
| `multipart.enabled`          | `false`    | Global built-in multipart switch                                       |
| `multipart.maxFileSize`      | `10485760` | Per-file byte limit; numeric                                           |
| `multipart.maxFiles`         | `10`       | Maximum number of files in one request                                 |
| `multipart.allowedMimeTypes` | Unset      | No MIME restriction when unset                                         |

A multipart request also includes boundaries, form headers, and other overhead. Set `maxBodySize` above the planned aggregate file size plus required overhead. Increasing `maxFileSize` does not increase the request read limit. If an adapter imposes another limit, the stricter one applies; multipart settings alone cannot guarantee a large request reaches the application.

## Actual semantics of route overrides

- Route `multipart.enabled: true` enables parsing for that route even when global multipart is disabled. `false` skips built-in route multipart; when unset, it follows global configuration.
- Route-specific parsing middleware is injected only when route `enabled: true` is explicit. Set that switch when route-specific `files.required`, size, count, or MIME checks are needed.
- If global parsing already ran, route middleware checks `req.files` again. A route can tighten limits, but a request already rejected globally never reaches it; a looser route setting cannot recover the request.
- To set independent limits for different routes, disable global multipart and enable each route explicitly as in the example. The bodyParser and adapter read boundaries still apply.
- Route `bodyParser.maxBodySize` sets a whole-request limit. Compatibility setting `override.maxBodySize` participates only when there is no route `bodyParser` object; it is not merged field by field with that object.
- `bodyParser.enabled: false` disables only that parsing layer, not explicitly registered route multipart. To delegate to custom upload logic, set route `multipart.enabled: false` explicitly.

Global parsing happens before user authentication middleware. Explicit route multipart is also inserted before user route middleware and the auth Guard. Setting `auth` on an upload route therefore does not mean authorization precedes the file read. See the [Route Definition API](/api/route-definition) for chain order. Applications still need separate identity and object-level permission checks; a parser switch is not authorization.

## req.files and form fields

`req.files` is an optional `ParsedFile[]`; each entry has `fieldname`, `filename`, `mimetype`, `size`, and `buffer: Buffer`. The filename property is `filename`; the framework does not generate a disk path. It may be `undefined` when multipart is disabled, not matched, or not parsed, and an empty array when parsing succeeded without files.

The `files` setting describes fields and checks that required files with those names are present. It is not a field allowlist. Undeclared files may still upload, subject to general size, count, and MIME limits. `required: true` does not limit the request to one file with that name.

On POST, PUT, and PATCH routes, `files` also contributes to OpenAPI multipart requestBody generation. Descriptions and required markers inform API consumers, but a `files` declaration alone does not register route parsing. The example explicitly sets `multipart.enabled: true` so observed behavior matches the description. See the [Route Definition API](/api/route-definition) for complete rules.

Built-in parsing extracts File entries only; it does not place ordinary multipart text fields into `req.body`. To validate text fields too, choose custom parsing that explicitly supports that contract. Do not assume `req.valid("body")` can read those text fields.

`allowedMimeTypes` compares the parsed File MIME value; it does not inspect content. An empty File.type is treated as `application/octet-stream`. An unset list imposes no restriction; an empty array accepts no MIME values. Applications must inspect content when a trustworthy format is needed, and must not use an untrusted filename directly as a storage path.

## Memory, adapters, and custom uploads

The built-in flow reads a bounded raw Buffer and parses the form using Web APIs, keeping file content in `ParsedFile.buffer`. Adapters share this parser but have their own request-read boundaries. This is not streaming persistence. Concurrent uploads can hold several copies of request and file data in memory, so a per-file limit is not a process memory budget.

There is no built-in `tmpDir`, disk-retention TTL, or scheduled cleanup task. Request completion also does not explicitly zero every Buffer immediately; the runtime reclaims unreferenced memory. The application owns files saved to disk or object storage, failed-write residue, and connection lifecycles.

For large files, stream-as-you-read, resumable uploads, or custom form semantics, choose a custom upload solution that fits the actual adapter and storage capabilities, and first disable built-in parsing that would consume the request body. `_getRawBodyBuffer()` still reads all content into memory and is not a streaming substitute. See [Plugins](/guide/plugins) for integration and [Security and Resources](/specification/security-and-resources) for ownership.

## Errors and rechecks

Built-in parser failures return direct JSON with `code`, `message`, and `requestId`, without the successful response's `data` wrapper.

| Symptom                          | Diagnosis and action                                                                         | Recheck                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `req.files` is undefined         | Check Content-Type boundary, global/route switches, and whether parsing was skipped          | Send real multipart as in the example                    |
| Required-file check did not fire | Non-multipart skips it; was route `enabled: true` explicit?                                  | Send missing-file multipart and JSON separately          |
| 413                              | Distinguish whole-body, per-file, and file-count limits; check reverse proxy and adapter too | Exceed exactly one limit at a time                       |
| 415                              | Check whether the actual form MIME is on the allowlist                                       | Try allowed and disallowed MIME values                   |
| 400                              | Boundary/message format or missing required file                                             | Retry with a boundary generated by `curl -F`             |
| Uploaded file cannot be found    | Built-in parsing never wrote it to disk                                                      | Inspect application save logic and verify storage output |

See the [Configuration API](/api/config), [Request Context API](/api/context), and [Route Definition API](/api/route-definition) for all field definitions.
