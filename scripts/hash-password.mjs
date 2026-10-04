#!/usr/bin/env node
/* Buat hash password admin untuk Workers Secret ADMIN_PASSWORD_HASH.
 *
 *   node scripts/hash-password.mjs "password-baru"
 *
 * Keluarannya: pbkdf2$<iterasi>$<salt-base64>$<hash-base64>
 * Salin nilai itu ke secret:
 *   npx wrangler secret put ADMIN_PASSWORD_HASH
 *   npx wrangler secret put ADMIN_EMAIL
 *
 * Begitu kedua secret terisi, MODE DEMO mati: akun dummy admin & member
 * berhenti berfungsi dan kredensialnya tidak lagi tampil di layar login.
 */
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 210_000; // sejalan dengan anjuran OWASP untuk PBKDF2-SHA256

const password = process.argv[2];
if (!password) {
  console.error('Pemakaian: node scripts/hash-password.mjs "password-baru"');
  process.exit(64);
}
if (password.length < 12) {
  console.error("Password minimal 12 karakter.");
  process.exit(65);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256,
);

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`);
