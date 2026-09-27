# Render Refresh

After a successful backend soft reload in development, Render Refresh tells the browser to request the page again according to the changed file's scope. It requires frontend enabled, `frontend.dev.hot: true`, and a page that loads the browser runtime. Production and `hydration: "none"` pages do not consume the notification.

## What Triggers It

The current trigger recognizes changes under `src/routes/**`, `src/services/**`, and `src/middlewares/**`, plus a full `src` reload. It does not analyze whether a changed file really affects the current page. Typical cases include:

- route handler changes the props passed to `res.render()`
- service used by a page route changes
- layout data shape changes
- render-data processing in one of those middleware files

These changes happen on the server, so refreshing only React components cannot fetch new server data. Editing `src/locales/**` alone, changing a runtime cache, or changing the database does not by itself publish a render-reload event; request the page again manually. A custom backend directory can participate in reload, but this notification check still uses the default paths above.

## Configuration

```ts
export default {
  frontend: {
    enabled: true,
    dev: {
      renderRefresh: "prompt",
    },
  },
};
```

| Value      | Behavior                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `"prompt"` | Shows a development prompt after a matching successful soft reload; with overlay off, logs to the Console. |
| `"auto"`   | Reloads the current page automatically.                                                                    |
| `"off"`    | Does not publish a render-reload event or actively notify the browser.                                     |

## Recommended Default

The default is `"prompt"`. It avoids unexpected loss of browser state. A prompt says that relevant code reloaded, not that the current page's data necessarily changed.

Use `"auto"` for demos, design review, or fast page-building sessions where preserving browser state is less important.

Use `"off"` when testing long-running client state and you want manual control.

## Runtime Calls Do Not Refresh

Calling `res.render()` during a normal request does not trigger a development refresh. A successful soft reload of the paths above does; a failed reload does not publish a success notification. Configuration changes cause a different cold-restart flow; see [Development Workflow](./dev-workflow).

## Verify the Notification and New Data

Use the dashboard example from [Data Flow](./data-flow). Run `npm run dev` in the app root and open `/dashboard`. Change the route's fixed count and wait for a successful terminal soft reload. In prompt mode, follow the prompt to reload and see the new count; auto mode reloads fully, while off mode requires a manual refresh. Switching the configuration itself restarts the development environment, so check that the new setting loaded before comparing behavior.

Inspect the Console and SSE connection as well. A prompt does not guarantee the next request succeeds: verify the response status and rendered content after refresh. Restore the example data and stop the service. This feature does not provide production data push, cache subscriptions, or application real-time notifications.
