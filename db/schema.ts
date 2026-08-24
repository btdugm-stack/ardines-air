import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  email: text("email").notNull().unique(), role: text("role").notNull(),
  points: integer("points").notNull().default(0),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(), user_id: text("user_id").notNull(),
  expires_at: text("expires_at").notNull(),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), sku: text("sku").notNull().unique(),
  name: text("name").notNull(), category: text("category").notNull(),
  unit: text("unit").notNull(), price: integer("price").notNull(),
  stock: integer("stock").notNull(), reserved: integer("reserved").notNull().default(0),
  minStock: integer("min_stock").notNull().default(5),
  accent: text("accent").notNull().default("#0B7A75"),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), orderNo: text("order_no").notNull().unique(),
  userId: text("user_id"), customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(), address: text("address").notNull().default(""),
  fulfillment: text("fulfillment").notNull(), status: text("status").notNull(),
  paymentStatus: text("payment_status").notNull(),
  paymentMethod: text("payment_method").notNull().default("cod"),
  total: integer("total").notNull(),
  pointsEarned: integer("points_earned").notNull().default(0), createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_orders_created").on(table.createdAt),
  index("idx_orders_status").on(table.status),
]);

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(), productId: text("product_id").notNull(),
  productName: text("product_name").notNull(), unit: text("unit").notNull(),
  qty: integer("qty").notNull(), unitPrice: integer("unit_price").notNull(),
  subtotal: integer("subtotal").notNull(),
}, (table) => [
  index("idx_order_items_order").on(table.orderId),
]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(),
  qty: integer("qty").notNull(), movementType: text("movement_type").notNull(),
  referenceId: text("reference_id"), reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(), category: text("category").notNull(),
  description: text("description").notNull(), amount: integer("amount").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loyaltyLedger = sqliteTable("loyalty_ledger", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  points: integer("points").notNull(), movementType: text("movement_type").notNull(),
  orderId: text("order_id"), createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("loyalty_ledger_order_movement_unique").on(table.orderId, table.movementType),
]);
