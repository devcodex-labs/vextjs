# Fast Refresh

Fast Refresh is the default feedback path for React page, layout, and component changes during `vext dev` in an app with frontend enabled. It requires both `frontend.dev.hot` and `fastRefresh`, plus a page that loads the browser runtime. Production builds and pages using `hydration: "none"` do not take this path. Start with the [Full-Stack Getting Started](./getting-started) guide.

## What It Handles

| Change                 | Expected behavior                                  |
| ---------------------- | -------------------------------------------------- |
| Page component edit    | React Fast Refresh when the module is refresh-safe |
| Shared component edit  | React Fast Refresh across affected pages           |
| CSS or CSS Module edit | CSS update path when possible                      |
| JSCSS style edit       | Frontend rebuild plus stylesheet update            |

Vext keeps the backend process running for frontend-only edits.

## Configuration

```ts
export default {
  frontend: {
    enabled: true,
    dev: {
      hot: true,
      fastRefresh: true,
    },
  },
};
```

## Fallbacks

The generated entry reimports the rebuilt entry and invokes React Refresh. If entry loading or Refresh fails, Vext logs the error and reloads the whole page. With `hot` enabled but `fastRefresh` disabled, a rebuild that is not CSS-only also reloads the page.

State preservation is not guaranteed for every export or Hook structure change; a component may remount. Refresh the whole page after changing the document or runtime boundary to verify the new document load. Setting `hot: false` disconnects the generated entry's SSE/Refresh integration, so refresh manually.

Importing server code can fail Leak Scan and must be fixed at the dependency boundary; a full-page reload cannot resolve it. If the overlay is disabled, inspect the Console and terminal errors. See [Diagnostics and Leak Scan](./diagnostics-and-leak-scan).

## Good Component Shape

```tsx
// src/frontend/components/UserCard.tsx
export function UserCard(props: { name: string }) {
  return <article>{props.name}</article>;
}
```

Keep service calls in routes and pass data as props. That keeps frontend modules refreshable and safe to bundle.

The current builder primarily identifies named, capitalized component exports in `.tsx`/`.jsx` files under the frontend root and registers them for refresh. It does not promise equal state preservation for arbitrary JavaScript modules. Import and render this component from a real page; creating an unreferenced file will not display it.

## Verify an Update

Run `npm run dev` in the app root, then open a page that uses the component and retains default hydration. Change visible text inside `<article>` and confirm a successful rebuild in the terminal, updated page text, and no Console refresh error. Existing interaction state can help observe preservation, but check the resulting output separately. For a CSS-only edit, see [Development Workflow](./dev-workflow). For route/service data changes, see [Render Refresh](./render-refresh). Stop the development server when finished.
