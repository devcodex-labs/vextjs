import { describe, expect, it } from "vitest";
import {
  VEXT_DOCS_APP_JS,
  VEXT_DOCS_STYLE_CSS,
} from "../../../src/lib/docs/renderers/vext-assets.js";

describe("Vext docs vanilla assets", () => {
  it("loads OpenAPI and Code JSDoc data without React or innerHTML", () => {
    expect(VEXT_DOCS_APP_JS).toContain(
      'fetchJson(endpointUrl(config.endpoints.openapi), "OpenAPI")',
    );
    expect(VEXT_DOCS_APP_JS).toContain(
      'fetchJson(endpointUrl(config.endpoints.code), "Code docs")',
    );
    expect(VEXT_DOCS_APP_JS).toContain(
      'fetchJson(config.endpoints.config, "Docs config")',
    );
    expect(VEXT_DOCS_APP_JS).toContain(
      'url.searchParams.set("source", state.activeSourceId)',
    );
    expect(VEXT_DOCS_APP_JS).toContain(
      'history.replaceState(null, "", linkForAnchor(state.anchor))',
    );
    expect(VEXT_DOCS_APP_JS).toContain("source: activeSource()");
    expect(VEXT_DOCS_APP_JS).toContain("Try it out");
    expect(VEXT_DOCS_APP_JS).toContain("resolveInitialView");
    expect(VEXT_DOCS_APP_JS).toContain("HTTP API");
    expect(VEXT_DOCS_APP_JS).toContain("Pages");
    expect(VEXT_DOCS_APP_JS).toContain("Components");
    expect(VEXT_DOCS_APP_JS).toContain("Plugins");
    expect(VEXT_DOCS_APP_JS).toContain("Middlewares");
    expect(VEXT_DOCS_APP_JS).not.toContain('["locale", "Locales"]');
    expect(VEXT_DOCS_APP_JS).not.toContain('["config", "Config"]');
    expect(VEXT_DOCS_APP_JS).not.toContain('["style", "Styles"]');
    expect(VEXT_DOCS_APP_JS).not.toContain('["preload", "Preload"]');
    expect(VEXT_DOCS_APP_JS).toContain("Metadata");
    expect(VEXT_DOCS_APP_JS).toContain("Open source");
    expect(VEXT_DOCS_APP_JS).toContain("Schema fields");
    expect(VEXT_DOCS_APP_JS).toContain("appendModelDetails");
    expect(VEXT_DOCS_APP_JS).toContain("appendPluginDetails");
    expect(VEXT_DOCS_APP_JS).toContain("appendMiddlewareDetails");
    expect(VEXT_DOCS_APP_JS).toContain("appendFormattedDescription");
    expect(VEXT_DOCS_APP_JS).toContain("isDescriptionCodeLine");
    expect(VEXT_DOCS_APP_JS).toContain("Parameters");
    expect(VEXT_DOCS_APP_JS).toContain("Request body");
    expect(VEXT_DOCS_APP_JS).toContain("Responses");
    expect(VEXT_DOCS_APP_JS).toContain("Usage");
    expect(VEXT_DOCS_APP_JS).toContain("buildOperationTree");
    expect(VEXT_DOCS_APP_JS).toContain("flattenSingleOperationBranches");
    expect(VEXT_DOCS_APP_JS).toContain("operationTreeSegments");
    expect(VEXT_DOCS_APP_JS).toContain("operationLeafLabel");
    expect(VEXT_DOCS_APP_JS).toContain("isDynamicPathSegment");
    expect(VEXT_DOCS_APP_JS).toContain("buildCodeTree");
    expect(VEXT_DOCS_APP_JS).toContain("codeLeafLabel");
    expect(VEXT_DOCS_APP_JS).toContain("setupSidebarResize");
    expect(VEXT_DOCS_APP_JS).toContain("setupUiControls");
    expect(VEXT_DOCS_APP_JS).toContain("setupOutline");
    expect(VEXT_DOCS_APP_JS).toContain("THEME_STORAGE_KEY");
    expect(VEXT_DOCS_APP_JS).toContain("DENSITY_STORAGE_KEY");
    expect(VEXT_DOCS_APP_JS).toContain("VIEW_FILTERS");
    expect(VEXT_DOCS_APP_JS).toContain("Copy endpoint");
    expect(VEXT_DOCS_APP_JS).toContain("Copy link");
    expect(VEXT_DOCS_APP_JS).toContain("Copy response");
    expect(VEXT_DOCS_APP_JS).toContain("Copy URL");
    expect(VEXT_DOCS_APP_JS).toContain("cURL");
    expect(VEXT_DOCS_APP_JS).toContain('"Copy " + label');
    expect(VEXT_DOCS_APP_JS).toContain("Code samples");
    expect(VEXT_DOCS_APP_JS).toContain("Request history");
    expect(VEXT_DOCS_APP_JS).toContain("Params");
    expect(VEXT_DOCS_APP_JS).toContain("Headers");
    expect(VEXT_DOCS_APP_JS).toContain("Samples");
    expect(VEXT_DOCS_APP_JS).toContain("History");
    expect(VEXT_DOCS_APP_JS).toContain("No declared query parameters");
    expect(VEXT_DOCS_APP_JS).toContain("No declared request headers");
    expect(VEXT_DOCS_APP_JS).toContain("Auth and effective headers");
    expect(VEXT_DOCS_APP_JS).toContain("Effective headers preview");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-auth-change");
    expect(VEXT_DOCS_APP_JS).not.toContain('{ id: "auth", label: "Auth"');
    expect(VEXT_DOCS_APP_JS).toContain("Request headers:");
    expect(VEXT_DOCS_APP_JS).toContain("Response headers:");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-tryout-status");
    expect(VEXT_DOCS_APP_JS).toContain("Same origin");
    expect(VEXT_DOCS_APP_JS).toContain("Custom server...");
    expect(VEXT_DOCS_APP_JS).toContain("Custom server URL is required.");
    expect(VEXT_DOCS_APP_JS).toContain("resolveInitialServerValue");
    expect(VEXT_DOCS_APP_JS).toContain("defaultServer");
    expect(VEXT_DOCS_APP_JS).toContain("customServerUrl");
    expect(VEXT_DOCS_APP_JS).toContain("Browser CORS rules apply");
    expect(VEXT_DOCS_APP_JS).toContain(
      "Manual header rows or raw JSON override auto auth headers",
    );
    expect(VEXT_DOCS_APP_JS).toContain("createCurlSample");
    expect(VEXT_DOCS_APP_JS).toContain("createBrowserFetchSample");
    expect(VEXT_DOCS_APP_JS).toContain("createNodeFetchSample");
    expect(VEXT_DOCS_APP_JS).toContain("createAxiosSample");
    expect(VEXT_DOCS_APP_JS).toContain("REQUEST_HISTORY_STORAGE_KEY");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-request-history");
    expect(VEXT_DOCS_APP_JS).toContain("resolveDisplayUrl");
    expect(VEXT_DOCS_APP_JS).toContain("isCrossOriginUrl");
    expect(VEXT_DOCS_APP_JS).toContain('tabs.activate("response", false)');
    expect(VEXT_DOCS_APP_JS).toContain("Copy usage");
    expect(VEXT_DOCS_APP_JS).toContain("Copy source path");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-overview-grid");
    expect(VEXT_DOCS_APP_JS).toContain("Project commands");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-command-groups");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-outline");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-mark");
    expect(VEXT_DOCS_APP_JS).toContain("hasStableTail");
    expect(VEXT_DOCS_APP_JS).toContain("insideDynamicBranch");
    expect(VEXT_DOCS_APP_JS).toContain("SIDEBAR_WIDTH_STORAGE_KEY");
    expect(VEXT_DOCS_APP_JS).toContain("rawValue == null");
    expect(VEXT_DOCS_APP_JS).toContain(
      'document.addEventListener("pointermove"',
    );
    expect(VEXT_DOCS_APP_JS).toContain("renderOperations");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-nav-branch");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-nav-caret");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-nav-caret-button");
    expect(VEXT_DOCS_APP_JS).toContain("collapsedGroups");
    expect(VEXT_DOCS_APP_JS).toContain("appendTopLevelNavContent");
    expect(VEXT_DOCS_APP_JS).toContain("applyAutoSidebarWidth");
    expect(VEXT_DOCS_APP_JS).toContain("SIDEBAR_AUTO_MAX_WIDTH");
    expect(VEXT_DOCS_APP_JS).toContain("removeItem(SIDEBAR_WIDTH_STORAGE_KEY)");
    expect(VEXT_DOCS_APP_JS).toContain('setAttribute("data-vext-docs-view"');
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-caret-spacer");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-leaf-spacer");
    expect(VEXT_DOCS_STYLE_CSS).toContain("--vext-docs-sidebar-width");
    expect(VEXT_DOCS_STYLE_CSS).toContain(
      "var(--vext-docs-sidebar-width, 280px) 8px minmax(0, 1fr)",
    );
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-resizer");
    expect(VEXT_DOCS_STYLE_CSS).toContain('data-vext-docs-theme="dark"');
    expect(VEXT_DOCS_STYLE_CSS).toContain('data-vext-docs-density="compact"');
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-ui-controls");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-search-tools");
    expect(VEXT_DOCS_STYLE_CSS).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(VEXT_DOCS_STYLE_CSS).toContain("width: min(760px, 100%)");
    expect(VEXT_DOCS_STYLE_CSS).toContain("@media (max-width: 980px)");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-outline");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-overview-card");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-project");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-command-row");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-param");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-mark");
    expect(VEXT_DOCS_APP_JS).toContain("renderLoadingState");
    expect(VEXT_DOCS_APP_JS).toContain("renderNavLoading");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-loading-card");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-skeleton");
    expect(VEXT_DOCS_APP_JS).toContain("fullLabel");
    expect(VEXT_DOCS_APP_JS).toContain("aria-expanded");
    expect(VEXT_DOCS_APP_JS).toContain("resolveSchema");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-response-tab");
    expect(VEXT_DOCS_APP_JS).toContain('setAttribute("role", "tab")');
    expect(VEXT_DOCS_APP_JS).toContain("renderAuthControls");
    expect(VEXT_DOCS_APP_JS).toContain("Authorize");
    expect(VEXT_DOCS_APP_JS).toContain("auth: ");
    expect(VEXT_DOCS_APP_JS).not.toContain('appendBadge(meta, "operationId:');
    expect(VEXT_DOCS_APP_JS).not.toContain(
      "appendBadge(meta, getOperationKind",
    );
    expect(VEXT_DOCS_APP_JS).toContain("textContent");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-method");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-nav-count");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-response-explorer");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-tryout-target");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-custom-server");
    expect(VEXT_DOCS_STYLE_CSS).toContain(".vext-docs-server-vars[hidden]");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-tryout-tabs");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-tablist");
    expect(VEXT_DOCS_STYLE_CSS).toContain("flex-wrap: nowrap");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-tabpanel");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-kv-empty");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-code-samples");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-history");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-kv-row");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-effective-headers");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-response-toolbar");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-tryout-status");
    expect(VEXT_DOCS_APP_JS).toContain("vext-docs-operation-body");
    expect(VEXT_DOCS_APP_JS).toContain("details.vext-docs-tryout > summary");
    expect(VEXT_DOCS_APP_JS).toContain('status.textContent = "Sending..."');
    expect(VEXT_DOCS_APP_JS).not.toContain(
      'details.classList.add("is-sending")',
    );
    expect(VEXT_DOCS_STYLE_CSS).toContain("box-shadow");
    expect(VEXT_DOCS_STYLE_CSS).toContain("border-left: 4px solid");
    expect(VEXT_DOCS_STYLE_CSS).toContain("margin: 16px 22px 26px");
    expect(VEXT_DOCS_STYLE_CSS).toContain("padding-top: 16px");
    expect(VEXT_DOCS_STYLE_CSS).toContain("border-radius: 8px");
    expect(VEXT_DOCS_STYLE_CSS).toContain("flex-wrap: wrap");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-auth");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-code-list");
    expect(VEXT_DOCS_STYLE_CSS).toContain("vext-docs-code-inline-block");
    expect(VEXT_DOCS_STYLE_CSS).toContain("overflow-wrap: anywhere");
    expect(VEXT_DOCS_STYLE_CSS).toContain("height: 180px");
    expect(VEXT_DOCS_STYLE_CSS).toContain('data-vext-docs-view="overview"');
    expect(VEXT_DOCS_STYLE_CSS).toContain("max-height: calc(100vh - 36px)");
    expect(VEXT_DOCS_STYLE_CSS).toContain("@media (min-width: 1400px)");
    expect(VEXT_DOCS_STYLE_CSS).toContain(".vext-docs-operation:hover");
    expect(VEXT_DOCS_STYLE_CSS).toContain(".vext-docs-code-item:hover");
    expect(VEXT_DOCS_STYLE_CSS).toContain("prefers-reduced-motion");
    expect(VEXT_DOCS_STYLE_CSS).toContain("position: sticky");
    expect(VEXT_DOCS_STYLE_CSS).toContain("height: 100vh");
    expect(VEXT_DOCS_STYLE_CSS).toContain("overflow-y: auto");
    expect(VEXT_DOCS_STYLE_CSS).toContain("scrollbar-width: thin");
    expect(VEXT_DOCS_APP_JS).not.toContain("(root)");
    expect(VEXT_DOCS_APP_JS).not.toContain(
      "for (const section of groupOperations(operations, state.view))",
    );
    expect(VEXT_DOCS_APP_JS).not.toContain("innerHTML");
    expect(VEXT_DOCS_APP_JS).not.toContain("React");
  });

  it("keeps the vanilla app script syntactically valid", () => {
    expect(() => new Function(VEXT_DOCS_APP_JS)).not.toThrow();
  });
});
