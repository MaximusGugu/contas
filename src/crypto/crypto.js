const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptData(obj, senha) {
  const dadosBytes = encoder.encode(JSON.stringify(obj));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dadosBytes);
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt))
  };
}

export async function decryptData(encryptedObj, senha) {
  try {
    const iv = Uint8Array.from(atob(encryptedObj.iv), c => c.charCodeAt(0));
    const salt = Uint8Array.from(atob(encryptedObj.salt), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(encryptedObj.encrypted), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(decoder.decode(decrypted));
  } catch (e) {
    throw new Error("Senha incorreta.");
  }
}
