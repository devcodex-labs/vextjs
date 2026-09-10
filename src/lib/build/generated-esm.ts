import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { withTemporaryArtifact } from "../project/temporary-artifact.js";

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.url).then((loaded) => {
  const value = loaded.default ?? '';
  if (typeof value !== 'string') throw new TypeError('Generated ESM default export must be a string.');
  if (Buffer.byteLength(value) > workerData.maxBytes) throw new RangeError('Generated ESM result exceeds the size limit.');
  parentPort.postMessage({ value });
}).catch((error) => parentPort.postMessage({ error: String(error?.stack ?? error) }));
`;

/** 一次性构建求值线程；原生 ESM 缓存和模块自建计时器随线程退出回收。 */
export async function evaluateGeneratedEsmString(options: {
  rootDir: string;
  logicalPath: string;
  contents: Uint8Array | string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<string> {
  options.signal?.throwIfAborted();
  return withTemporaryArtifact(options, async (filename) => {
    options.signal?.throwIfAborted();
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      execArgv: [],
      workerData: {
        url: pathToFileURL(filename).href,
        maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        onAbort = () =>
          reject(
            options.signal?.reason ??
              new Error("Generated ESM execution aborted."),
          );
        options.signal?.addEventListener("abort", onAbort, { once: true });
        worker.once("message", (message: unknown) => {
          if (!message || typeof message !== "object") {
            reject(new Error("Invalid generated ESM response."));
            return;
          }
          const value = message as { value?: unknown; error?: unknown };
          if (typeof value.error === "string") reject(new Error(value.error));
          else if (typeof value.value === "string") resolve(value.value);
          else reject(new Error("Invalid generated ESM result."));
        });
        worker.once("error", reject);
        worker.once("exit", (code) =>
          reject(
            new Error(
              `Generated ESM worker exited before a result (code ${code}).`,
            ),
          ),
        );
        timer = setTimeout(
          () => reject(new Error("Generated ESM execution timed out.")),
          options.timeoutMs ?? 30_000,
        );
        if (options.signal?.aborted) onAbort();
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
      // terminate() 的 Promise 表示线程已经退出；不能发送停止后就清理模块文件。
      await worker.terminate();
    }
  });
}
