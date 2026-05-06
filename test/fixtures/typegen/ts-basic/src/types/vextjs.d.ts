declare module "vextjs" {
  export interface FixtureApp {
    extend(key: string, value: unknown): void;
  }

  export interface FixturePluginDefinition {
    name: string;
    setup?(app: FixtureApp): void | Promise<void>;
    onReady?(app: FixtureApp): void | Promise<void>;
    onClose?(app: FixtureApp): void | Promise<void>;
  }

  export function definePlugin<T extends FixturePluginDefinition>(plugin: T): T;
}
