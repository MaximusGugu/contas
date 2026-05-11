import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseApp } from "./firebaseApp.js";

export const db = getFirestore(firebaseApp);

export {
  doc,
  setDoc,
  getDoc
};
