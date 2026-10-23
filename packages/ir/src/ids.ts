let counter = 0;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomChunk(length: number): string {
  const cryptoObj = globalThis.crypto;
  let out = "";
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
    }
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Create a short, URL-safe identifier. Uniqueness is only required inside one
 * project; the counter disambiguates ids minted inside the same millisecond.
 */
export function createId(prefix = "b"): string {
  counter = (counter + 1) % 1_679_616; // 36^4
  const time = Date.now().toString(36).slice(-5);
  const count = counter.toString(36).padStart(4, "0");
  return `${prefix}_${time}${count}${randomChunk(4)}`;
}
