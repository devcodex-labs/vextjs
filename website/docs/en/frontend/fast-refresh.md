# Fast Refresh

Fast Refresh is the default feedback path for React page, layout, and component changes during `vext dev`.

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
    dev: {
      hot: true,
      fastRefresh: true,
    },
  },
};
```

## Fallbacks

Fast Refresh can fall back to a full page reload when:

- a module exports non-component values used outside React
- the update changes document/runtime boundaries
- the file imports server-only code
- the refresh runtime reports an unrecoverable error

The fallback should be clear and recoverable in the browser overlay or terminal.

## Good Component Shape

```tsx
export function UserCard(props: { name: string }) {
  return <article>{props.name}</article>;
}
```

Keep service calls in routes and pass data as props. That keeps frontend modules refreshable and safe to bundle.
