CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`qty` integer NOT NULL,
	`movement_type` text NOT NULL,
	`reference_id` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loyalty_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`movement_type` text NOT NULL,
	`order_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loyalty_ledger_order_movement_unique` ON `loyalty_ledger` (`order_id`,`movement_type`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_method` text DEFAULT 'cod' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_created` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
ALTER TABLE `products` ADD `accent` text DEFAULT '#0B7A75' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);