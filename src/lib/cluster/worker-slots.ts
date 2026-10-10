/** Identity only: readiness and health remain in ClusterMaster.WorkerMeta. */
export class WorkerSlots {
  private readonly current = new Map<number, number>();
  activate(slot: number, workerId: number): void {
    this.current.set(slot, workerId);
  }
  remove(slot: number, workerId: number): void {
    if (this.current.get(slot) === workerId) this.current.delete(slot);
  }
  entries(): IterableIterator<[number, number]> {
    return this.current.entries();
  }
  owner(slot: number): number | undefined {
    return this.current.get(slot);
  }
}
