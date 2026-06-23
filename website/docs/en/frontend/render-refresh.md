# Render Refresh

Render Refresh handles server-side changes that affect the HTML produced by `res.render()`.

## What Triggers It

Examples:

- route handler changes the props passed to `res.render()`
- service used by a page route changes
- layout data shape changes
- server-side locale/message resolution changes
- render cache invalidation affects the current page

These changes happen on the server side, so React Fast Refresh is not enough.

## Configuration

```ts
export default {
  frontend: {
    dev: {
      renderRefresh: "prompt",
    },
  },
};
```

| Value | Behavior |
|-------|----------|
| `"prompt"` | Browser shows a dev prompt after successful backend reload. |
| `"auto"` | Browser reloads the current page automatically. |
| `"off"` | Terminal logs the change; browser is not refreshed. |

## Recommended Default

Use `"prompt"` for application work. It avoids surprising page reloads while still making stale SSR data visible.

Use `"auto"` for demos, design review, or fast page-building sessions where preserving browser state is less important.

Use `"off"` when testing long-running client state and you want manual control.

## Runtime Calls Do Not Refresh

Calling `res.render()` during a normal request does not trigger a development refresh. The trigger is a successful rebuild or backend reload of code that can change rendered output.
