import type {
  VextApiClient,
  VextClientContract,
  VextClientRouteContract,
} from "vextjs/frontend";

type HeadContract = Omit<VextClientContract, "routes"> & {
  routes: Array<
    Omit<VextClientRouteContract, "method" | "path" | "routeId"> & {
      method: "HEAD";
      path: "/probe";
      routeId: "head-probe";
    }
  >;
};

declare const client: VextApiClient<
  HeadContract,
  {
    "head-probe": {
      params: unknown;
      query: unknown;
      headers: unknown;
      body: unknown;
      response: { value: string };
    };
  }
>;

const shortcut: Promise<null> = client.HEAD("/probe");
const generic: Promise<null> = client.request("HEAD", "/probe");
// @ts-expect-error HEAD has no entity, even if a route describes a GET-like body.
const invalid: Promise<{ value: string }> = client.HEAD("/probe");
void [shortcut, generic, invalid];
