import { byId } from "../utils/dom.js";

export function openModal(id, display = "flex") {
  const modal = byId(id);
  if (modal) modal.style.display = display;
}

export function closeModal(id) {
  const modal = byId(id);
  if (modal) modal.style.display = "none";
}
