/** 一个 dev 进程中的有界资源操作队列；关闭后不可重新打开。 */
export class DevOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;
  private readonly cancellation = new AbortController();

  get signal(): AbortSignal {
    return this.cancellation.signal;
  }

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.signal.aborted) return Promise.reject(this.signal.reason);
    if (this.count >= 64)
      return Promise.reject(new Error("[vext dev] operation queue is full"));
    this.count++;
    const task = this.tail.then(() => {
      this.signal.throwIfAborted();
      return operation(this.signal);
    });
    this.tail = task.then(
      () => {
        this.count--;
      },
      () => {
        this.count--;
      },
    );
    return task;
  }

  /** 等待调用时已接收的工作；过载重试先让出队列，不新增隐藏的待入队任务。 */
  waitForPending(): Promise<void> {
    return this.tail;
  }

  /** 调用方取消正在等待的 IPC；当前操作主动检查 signal，再等所有清理完成。 */
  close(): Promise<void> {
    this.cancellation.abort(
      new Error("[vext dev] operation canceled by shutdown"),
    );
    return this.tail;
  }
}
