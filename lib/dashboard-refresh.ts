/** One scheduler shared by checklist and provisioning subscribers. */
export function createRefreshScheduler(
  refresh: () => void,
  visible: () => boolean,
) {
  const subscribers = new Map<symbol, string>();
  let changedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    if (!subscribers.size || !visible()) return;
    timer = setTimeout(
      () => {
        if (visible()) refresh();
        schedule();
      },
      Date.now() - changedAt >= 600_000 ? 300_000 : 60_000,
    );
  }
  return {
    update(id: symbol, progress: string) {
      if (subscribers.get(id) !== progress) changedAt = Date.now();
      subscribers.set(id, progress);
      schedule();
    },
    remove(id: symbol) {
      subscribers.delete(id);
      schedule();
    },
    visibilityChanged: schedule,
  };
}
