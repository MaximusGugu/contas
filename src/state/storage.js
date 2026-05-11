export function saveLocalSnapshot(snapshot) {
  Object.entries(snapshot).forEach(([key, value]) => {
    localStorage.setItem(key, JSON.stringify(value));
  });
}
