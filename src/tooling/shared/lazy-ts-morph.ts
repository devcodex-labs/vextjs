type TsMorphModule = typeof import("ts-morph");

let cachedTsMorphModule: Promise<TsMorphModule> | null = null;

/**
 * loadTsMorph — 懒加载 ts-morph
 *
 * 仅在 `vext typegen`、`vext dev` preflight、`doctor` 等开发辅助路径执行时加载，
 * 避免污染生产运行态路径。
 */
export function loadTsMorph(): Promise<TsMorphModule> {
  if (cachedTsMorphModule == null) {
    cachedTsMorphModule = import("ts-morph");
  }

  return cachedTsMorphModule;
}
