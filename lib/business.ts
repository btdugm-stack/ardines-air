// Logika bisnis murni (tanpa dependensi runtime Cloudflare) agar bisa diuji
// dengan node:test via type stripping (node --experimental-strip-types).

export const PAYMENT_METHODS = ["cod", "transfer", "qris"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Validasi jumlah item pesanan. Return qty integer >= 1, atau null jika tidak valid. */
export function parseQty(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/** Validasi nominal (rupiah). Return integer > 0, atau null jika tidak valid. */
export function parseAmount(raw: unknown): number | null {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Poin loyalty: 1 poin per kelipatan Rp10.000. */
export function pointsFor(total: number): number {
  return Math.floor(total / 10000);
}

/** Ongkir: Rp5.000 untuk pengantaran, gratis untuk ambil sendiri. */
export function shippingFor(fulfillment: string): number {
  return fulfillment === "delivery" ? 5000 : 0;
}

/** Transisi status yang diizinkan dari status saat ini. */
export function allowedTransitions(status: string, fulfillment: string): string[] {
  switch (status) {
    case "new": return ["confirmed", "cancelled"];
    case "confirmed": return ["preparing", "cancelled"];
    case "preparing": return ["ready", "cancelled"];
    case "ready": return [fulfillment === "delivery" ? "delivering" : "completed", "cancelled"];
    case "delivering": return ["completed", "cancelled"];
    default: return [];
  }
}

/** Normalisasi metode pembayaran; default "cod". */
export function normalizePaymentMethod(raw: unknown): PaymentMethod {
  return PAYMENT_METHODS.includes(raw as PaymentMethod) ? (raw as PaymentMethod) : "cod";
}
