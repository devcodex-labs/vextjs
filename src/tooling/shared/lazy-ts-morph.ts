type TsMorphModule = typeof import("ts-morph");

let cachedTsMorphModule: Promise<TsMorphModule> | null = null;

/**
 * loadTsMorph — 懒加载 ts-morph
 *
 * 仅在 `vext typegen` / 后续 `doctor` 等开发辅助命令执行时加载，
 * 避免污染 `start / dev / build` 的默认运行路径。
 */
export function loadTsMorph(): Promise<TsMorphModule> {
  if (cachedTsMorphModule == null) {
    cachedTsMorphModule = import("ts-morph");
  }

  return cachedTsMorphModule;
}

