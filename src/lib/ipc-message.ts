/** 只确认 IPC 传输；调用方仍需等待 ready 或业务操作结果。 */
export function sendMessageToParent(
  message: Record<string, unknown>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!process.send || process.connected === false) {
      reject(new Error("[vextjs] IPC parent is disconnected"));
      return;
    }
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}
