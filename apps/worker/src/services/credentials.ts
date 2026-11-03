export interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

export interface CredentialCipher {
  encrypt(plain: string): Promise<EncryptedValue>;
  decrypt(ciphertext: string, iv: string): Promise<string>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Kunci AES-GCM 32 byte, base64, dari secret Worker CREDENTIALS_KEY. */
export async function createCredentialCipher(base64Key: string): Promise<CredentialCipher> {
  const keyBytes = fromBase64(base64Key);
  if (keyBytes.length !== 32) {
    throw new Error("CREDENTIALS_KEY harus 32 byte base64.");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);

  return {
    async encrypt(plain: string): Promise<EncryptedValue> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(plain),
      );
      return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
    },

    async decrypt(ciphertext: string, iv: string): Promise<string> {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        key,
        fromBase64(ciphertext),
      );
      return new TextDecoder().decode(plain);
    },
  };
}
