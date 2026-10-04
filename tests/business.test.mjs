import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_METHODS, allowedTransitions, normalizePaymentMethod,
  parseAmount, parseQty, pointsFor, shippingFor,
} from "../lib/business.ts";

test("parseQty menolak nilai non-numerik", () => {
  assert.equal(parseQty("abc"), null);
  assert.equal(parseQty(NaN), null);
  assert.equal(parseQty(undefined), null);
  assert.equal(parseQty(null), null);
  assert.equal(parseQty(""), null);
});

test("parseQty menolak qty < 1", () => {
  assert.equal(parseQty(0), null);
  assert.equal(parseQty(-5), null);
  assert.equal(parseQty("-2"), null);
});

test("parseQty menerima qty valid dan membulatkan ke bawah", () => {
  assert.equal(parseQty(2), 2);
  assert.equal(parseQty("3"), 3);
  assert.equal(parseQty(1.9), 1);
  assert.equal(parseQty(2.0), 2);
});

test("parseAmount menolak nilai non-numerik dan <= 0", () => {
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(NaN), null);
  assert.equal(parseAmount(0), null);
  assert.equal(parseAmount(-1000), null);
  assert.equal(parseAmount(undefined), null);
});

test("parseAmount menerima nominal valid (trunc)", () => {
  assert.equal(parseAmount("50000"), 50000);
  assert.equal(parseAmount(25000), 25000);
  assert.equal(parseAmount(1.7), 1);
});

test("pointsFor: 1 poin per Rp10.000", () => {
  assert.equal(pointsFor(26000), 2);
  assert.equal(pointsFor(10000), 1);
  assert.equal(pointsFor(9999), 0);
  assert.equal(pointsFor(0), 0);
});

test("shippingFor: Rp5.000 untuk delivery, gratis lainnya", () => {
  assert.equal(shippingFor("delivery"), 5000);
  assert.equal(shippingFor("pickup"), 0);
  assert.equal(shippingFor("lain"), 0);
});

test("allowedTransitions sesuai alur status", () => {
  assert.deepEqual(allowedTransitions("new", "delivery"), ["confirmed", "cancelled"]);
  assert.deepEqual(allowedTransitions("confirmed", "delivery"), ["delivering", "cancelled"]);
  assert.deepEqual(allowedTransitions("confirmed", "pickup"), ["completed", "cancelled"]);
  // Pesanan lama dengan status yang sudah tidak dibuat tetap bisa dilanjutkan.
  assert.deepEqual(allowedTransitions("preparing", "delivery"), ["delivering", "cancelled"]);
  assert.deepEqual(allowedTransitions("preparing", "pickup"), ["completed", "cancelled"]);
  assert.deepEqual(allowedTransitions("ready", "delivery"), ["delivering", "cancelled"]);
  assert.deepEqual(allowedTransitions("ready", "pickup"), ["completed", "cancelled"]);
  assert.deepEqual(allowedTransitions("delivering", "delivery"), ["completed", "cancelled"]);
});

test("allowedTransitions: status terminal tidak punya transisi", () => {
  assert.deepEqual(allowedTransitions("completed", "delivery"), []);
  assert.deepEqual(allowedTransitions("cancelled", "delivery"), []);
  assert.deepEqual(allowedTransitions("unknown", "delivery"), []);
});

test("normalizePaymentMethod: whitelist + default cod", () => {
  assert.equal(normalizePaymentMethod("cod"), "cod");
  assert.equal(normalizePaymentMethod("transfer"), "transfer");
  assert.equal(normalizePaymentMethod("qris"), "qris");
  assert.equal(normalizePaymentMethod("e-wallet"), "cod");
  assert.equal(normalizePaymentMethod(undefined), "cod");
  assert.equal(normalizePaymentMethod(""), "cod");
  assert.deepEqual(PAYMENT_METHODS, ["cod", "transfer", "qris"]);
});
