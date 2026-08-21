export const VEXT_BRAND_ASSET_VERSION = "20260820-v2";

export const VEXT_BRAND_COLORS = {
  canvas: "#071013",
  ink: "#F4FFFC",
  cyan: "#12D6C6",
  green: "#5EE987",
  amber: "#F5BD4F",
  rose: "#FF6B7A",
} as const;

export const VEXT_BRAND_MARK = {
  viewBox: "0 0 72 72",
  primaryPath: "M14 14L35 58L58 14",
  signalPath: "M58 14L66 28L52 42",
} as const;

export const VEXT_DOCS_THEME = {
  light: {
    colorScheme: "light",
    background: "#F3FBF9",
    panel: "#FFFFFF",
    text: VEXT_BRAND_COLORS.canvas,
    muted: "#526B67",
    line: "#C7E3DE",
    accent: "#08776F",
    accentSoft: "#D9F7F2",
    code: VEXT_BRAND_COLORS.canvas,
    success: "#168A48",
    panelSoft: "#EDF8F6",
    codeBackground: VEXT_BRAND_COLORS.canvas,
    codeForeground: VEXT_BRAND_COLORS.ink,
    markBackground: "#FFF1B8",
    cardShadow: "0 7px 18px rgba(7, 16, 19, 0.08)",
    cardShadowHover: "0 10px 24px rgba(7, 16, 19, 0.13)",
  },
  dark: {
    colorScheme: "dark",
    background: VEXT_BRAND_COLORS.canvas,
    panel: "#0D1B21",
    text: VEXT_BRAND_COLORS.ink,
    muted: "#ABC3C0",
    line: "#29433F",
    accent: "#52EADC",
    accentSoft: "#123F3B",
    code: VEXT_BRAND_COLORS.ink,
    success: VEXT_BRAND_COLORS.green,
    panelSoft: "#13272F",
    codeBackground: "#050B0E",
    codeForeground: VEXT_BRAND_COLORS.ink,
    markBackground: "#67501F",
    cardShadow: "0 7px 18px rgba(0, 0, 0, 0.28)",
    cardShadowHover: "0 10px 24px rgba(0, 0, 0, 0.38)",
  },
} as const;

export type VextDocsThemeName = keyof typeof VEXT_DOCS_THEME;

export function renderVextDocsThemeVariables(
  themeName: VextDocsThemeName,
): string {
  const theme = VEXT_DOCS_THEME[themeName];
  return `  color-scheme: ${theme.colorScheme};
  --vext-bg: ${theme.background};
  --vext-panel: ${theme.panel};
  --vext-text: ${theme.text};
  --vext-muted: ${theme.muted};
  --vext-line: ${theme.line};
  --vext-accent: ${theme.accent};
  --vext-accent-soft: ${theme.accentSoft};
  --vext-code: ${theme.code};
  --vext-success: ${theme.success};
  --vext-panel-soft: ${theme.panelSoft};
  --vext-code-bg: ${theme.codeBackground};
  --vext-code-fg: ${theme.codeForeground};
  --vext-mark-bg: ${theme.markBackground};
  --vext-card-shadow: ${theme.cardShadow};
  --vext-card-shadow-hover: ${theme.cardShadowHover};`;
}

export interface RenderVextMarkSvgOptions {
  background?: boolean;
  className?: string;
  ariaHidden?: boolean;
  ariaLabel?: string;
}

function escapeSvgAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderVextMarkSvg(
  options: RenderVextMarkSvgOptions = {},
): string {
  const attributes = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="${VEXT_BRAND_MARK.viewBox}"`,
    'fill="none"',
  ];

  if (options.className) {
    attributes.push(`class="${escapeSvgAttribute(options.className)}"`);
  }
  if (options.ariaHidden) {
    attributes.push('aria-hidden="true"');
  } else if (options.ariaLabel) {
    attributes.push('role="img"');
    attributes.push(`aria-label="${escapeSvgAttribute(options.ariaLabel)}"`);
  }

  const background = options.background
    ? `  <rect width="72" height="72" rx="16" fill="${VEXT_BRAND_COLORS.canvas}"/>\n`
    : "";

  return `<svg ${attributes.join(" ")}>
${background}  <path d="${VEXT_BRAND_MARK.primaryPath}" stroke="${VEXT_BRAND_COLORS.cyan}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${VEXT_BRAND_MARK.signalPath}" stroke="${VEXT_BRAND_COLORS.green}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="14" cy="14" r="4" fill="${VEXT_BRAND_COLORS.amber}"/>
  <circle cx="35" cy="58" r="4" fill="${VEXT_BRAND_COLORS.cyan}"/>
  <circle cx="58" cy="14" r="4" fill="${VEXT_BRAND_COLORS.green}"/>
</svg>`;
}

export const VEXT_MARK_SVG = `${renderVextMarkSvg()}\n`;
export const VEXT_FAVICON_SVG = `${renderVextMarkSvg({ background: true })}\n`;
