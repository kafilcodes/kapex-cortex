import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

let lastTime = -1;
let lastRand: number[] = [];

function encodeTime(t: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/**
 * 26-char ULID: 48-bit ms timestamp + 80 random bits, monotonic within a process
 * (same millisecond → random part incremented), so lexicographic order = creation order.
 */
export function ulid(now: number = Date.now()): string {
  let rand: number[];
  if (now <= lastTime) {
    now = lastTime;
    rand = [...lastRand];
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) { rand[i]++; break; }
      rand[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    rand = Array.from(bytes, (b) => b % 32);
    rand[0] = rand[0] % 16; // headroom so increments never overflow in practice
  }
  lastTime = now;
  lastRand = rand;
  return encodeTime(now) + rand.map((d) => ALPHABET[d]).join("");
}
