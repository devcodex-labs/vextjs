# VextJS CRUD API

This is the executable CRUD reference for VextJS 2.x. It uses the built-in
native adapter, OpenAPI/Vext Docs, the raw `app.db` MonSQLize instance, strict
route validation, and an explicitly disabled global rate limiter.

The model declares `collection: "todos"`, so raw MonSQLize lookup uses the
exact registry key `app.db.model("todos")`; VextJS 2.x does not rewrite it to a
facade alias such as `Todo`.

## Run

Use a dedicated MongoDB database. The example intentionally refuses to start
without `MONGODB_URI`; a mock or shared development database is not treated as
successful verification.

```powershell
$env:MONGODB_URI = "mongodb://127.0.0.1:27017/vext_crud_example"
npm install
npm run typecheck
npm run build
npm start
```

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/vext_crud_example npm start
```

Open `http://127.0.0.1:3100/docs`, then exercise:

- `GET /todos?limit=20`
- `POST /todos` with `{ "title": "Verify Vext" }`
- `GET /todos/:id`
- `PATCH /todos/:id`
- `DELETE /todos/:id`

Every business-required path `id` uses `string:1-!`. A path-parameter
validation failure returns HTTP 400 before the route handler runs. Body/query
validation failures remain HTTP 422. The generated OpenAPI path parameter is
also `required: true`.

The authoritative source is this directory. The bilingual website pages link
here instead of maintaining a second, drifting implementation.
