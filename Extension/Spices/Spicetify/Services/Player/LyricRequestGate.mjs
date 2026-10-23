// Leading-edge debounce shared by every provider. Only a burst of song changes
// waits; ordinary autoplay/isolated skips have no artificial latency. One timer
// belongs to the latest change, and displaced waiters are explicitly released.
export function createLyricRequestGate({ now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let lastChange = -Infinity;
  let pending;
  function clearPending() {
    if (!pending) return;
    cancel(pending.timer);
    pending.resolve(false);
    pending = undefined;
  }
  return {
    change() {
      const time = now();
      const inBurst = time - lastChange < 800;
      lastChange = time;
      clearPending();
      if (!inBurst) return Promise.resolve(true);
      return new Promise(resolve => {
        pending = { resolve, timer: schedule(() => {
          pending = undefined;
          resolve(true);
        }, 800) };
      });
    },
    dispose() { clearPending(); lastChange = -Infinity; },
  };
}
