# Unreleased

## Changed

- Upgraded runtime validation and database dependencies to `schema-dsl@2.0.9` and `monsqlize@2.0.3`, keeping the existing schema/OpenAPI and MonSQLize plugin contracts intact.
- Moved the optional benchmark runner to on-demand `npm exec --package=autocannon@8.0.0`, keeping `autocannon` and its transitive dependency tree out of the root install, audit and file-link consumer surface.
- Redesigned the Rspress documentation site theme, homepage, navigation, favicon and public logo assets around the Vext runtime-console visual direction.
- Refocused the documentation homepage on Native performance, three-tier server hot reload, ecosystem links, footer navigation and dark-theme readability.
- Enhanced the documentation site ecosystem menu, GitHub organization footer link and lightweight motion background with pointer-following scan effects.
- Fixed documentation homepage motion visibility, reduced-motion behavior, pointer scan compatibility and static `.html` links for primary homepage actions.
- Moved the documentation ecosystem switcher next to the logo, constrained ecosystem card text wrapping and added a lightweight terminal typing sequence to the homepage console.
- Shifted the documentation ecosystem switcher to the far-left side before the logo, tightened VX badge centering and shortened homepage console reveal delays.
- Locked the documentation theme to the dark runtime-console surface, removed the light/dark switcher, darkened table headers and made the homepage console typing effect visible without hiding log output.
- Hardened documentation homepage links, code block/callout contrast and the runtime console typewriter across async Rspress page loading and reduced-motion environments.
- Upgraded the homepage console into a looping terminal playback sequence and restored Vext-themed Shiki syntax colors for documentation code blocks.
- Reframed the homepage console around `npx vextjs create` project scaffolding and increased code block token contrast while keeping the dark Vext theme.
- Improved right-side table-of-contents inline code pills so API method names stay readable in the dark documentation theme.
