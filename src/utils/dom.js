export function byId(id) {
  return document.getElementById(id);
}

export function on(id, eventName, handler) {
  const el = byId(id);
  if (el) el.addEventListener(eventName, handler);
  return el;
}
