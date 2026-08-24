# Depot Air Mineral UMKM — AI Coding Agent Instructions

## Project Overview

**Stack**: Next.js 16 + React 19 + Vite 8 + vinext + Cloudflare Workers + D1 (SQLite)  
**Purpose**: Point-of-sale web app for water depot business (galon/bottled water, ice) with customer, member, and admin workflows

**Architecture**: Hybrid SSR+RSC app using vinext (Vite-powered Next.js) that deploys to Cloudflare Workers. Single-page app shell (`app/store-app.tsx`) handles all client views; API routes in `app/api/app/route.ts` handle business logic backed by D1 database.

## Critical Architecture Patterns

### 1. Hybrid Build System (vinext + Vite + Workers)

- **DO NOT** use `next dev` or standard Next.js commands — this project uses **vinext**, not regular Next.js
- Dev server: `npm run dev` → runs `vite` (configured in `vite.config.ts`)
- Build: `npm run build` → executes `scripts/build-verified.sh` (timeout-protected vinext build)
- The app runs on Cloudflare Workers runtime (`worker/index.ts` is the entry point)
- Local development uses Miniflare to simulate Workers + D1 database
- All environment setup is managed by `scripts/sites-env.sh` (sets HOME, npm cache, WRANGLER paths to `.sites-runtime/`)

### 2. Database & State Management

**Schema source of truth**: `db/schema.ts` (Drizzle ORM)  
**Runtime migrations**: `app/api/app/route.ts` runs schema setup on first request via `ensureReady()`

- D1 binding accessed via `env.DB` from `cloudflare:workers`
- Schema includes: users, sessions, products, orders, order_items, inventory_movements, expenses, loyalty_ledger
- Stock model: `available = stock - reserved` (reserved set on checkout, consumed when order status → preparing)
- Migrations in `drizzle/` are generated via `npm run db:generate` but runtime uses auto-setup

**Key pattern**: Always check `ensureReady()` before DB operations. This creates tables, seeds initial products, and handles schema migrations for existing databases.

### 3. Single-File Client App Architecture

`app/store-app.tsx` (255 lines) implements **all** client views as a state machine:
- Views: `"shop" | "track" | "member" | "admin"`
- No router — navigation via `setView()` state changes
- All API calls use `callApi()` helper (fetch wrapper with error handling)
- Cart state managed in component (object keyed by product ID)

**Pattern for new features**: Add actions to API route, update view logic in appropriate section of StoreApp component.

### 4. API Route Structure (`app/api/app/route.ts`)

Single POST endpoint handling all actions via `action` parameter:

```typescript
// Public actions (no auth)
"store", "track_order", "create_order"

// Member actions (session required)
"login_member", "logout_member", "member_dashboard"

// Admin actions (admin session required)  
"login_admin", "logout_admin", "admin_dashboard", "update_order_status",
"verify_payment", "cancel_order", "adjust_stock", "add_expense",
"create_product", "update_product", "delete_product"
```

**Critical validations** (hard-learned from audit):
- Use `parseQty()` and `parseAmount()` from `lib/business.ts` for all numeric inputs
- Never return raw error messages to client — log server-side, return generic errors
- Check `Number.isFinite()` before using numbers in SQL
- Validate payment methods against `PAYMENT_METHODS` whitelist

### 5. Stock & Order State Machine

**Order statuses**: `new → confirmed → preparing → ready → delivering/completed` (or `cancelled` from any)
- Allowed transitions defined in `lib/business.ts:allowedTransitions()`
- Stock reserved on checkout, consumed on "preparing" status
- Cancellation before "preparing" releases reservation; after "preparing" returns physical stock

**Inventory movements tracked**: reserve, sale, return, adjustment (see `inventory_movements` table)

## Development Workflows

### Running the App

```bash
npm install                # Standard install (DO NOT use install:ci on Windows)
npm run dev               # Start Vite dev server (port 5173)
npm run build             # Production build with timeout protection
npm run start             # Start production server
npm test                  # Run business logic + rendered HTML tests
```

**Database reset**: Delete `.wrangler/` directory, restart dev server (auto-seeds)

### Testing

Test files in `tests/`:
- `business.test.mjs` — Pure business logic (no runtime deps), uses Node.js native test runner
- `rendered-html.test.mjs` — End-to-end HTML validation with graceful skip for portability

**Pattern**: Business logic extracted to `lib/business.ts` specifically to enable pure-function testing without Workers runtime

### Windows Compatibility Notes

- Scripts in `scripts/` use bash — Git Bash or WSL required
- `npm run install:ci` requires `flock` (Linux-only) — use `npm install` instead on Windows
- Environment variables in `vite.config.ts` set as defaults (no POSIX env syntax in scripts)

## Project-Specific Conventions

### 1. Auth & Sessions

- **Admin**: Server-side sessions (cookie: `depot_session`), password check in API route
  - Demo credentials hardcoded for local dev: `admin@segardepot.local` / `Admin123!`
- **Member**: Simulated Google OAuth for local dev (`app/chatgpt-auth.ts` exists but not used in current flow)
  - Real auth: Click "Demo" button creates session without OAuth
- Sessions expire after 7 days; cleanup on login via `DELETE WHERE expires_at <= now`

### 2. Business Logic Constants

All in `lib/business.ts`:
- Shipping: Rp 5,000 for delivery, free for pickup
- Loyalty points: 1 point per Rp 10,000 spent (floor division)
- Points awarded when order status = completed AND payment = paid
- Payment methods: `["cod", "transfer", "qris"]`

### 3. CSS Architecture

`app/globals.css` — **Fully custom CSS, zero utility classes**
- Design system vars: `--ink`, `--navy`, `--teal`, `--lime`, `--paper`, etc.
- Responsive breakpoints: 1100px (desktop/mobile nav), 720px (tablet), 440px (small mobile)
- Mobile nav: Bottom bar at <1100px (4 buttons), desktop nav hidden
- Print styles for receipts: `@media print` targets `.receipt-print`

**Pattern**: Use semantic class names matching component structure (e.g., `.product-card`, `.hero-visual`, `.admin-sidebar`)

### 4. Icon System

`Icon` component in `store-app.tsx` — inline SVG paths for each icon name
- Available icons: drop, cart, user, chart, box, search, truck, plus, minus, logout, print, wallet, check, menu, edit, trash
- Add new icons by extending the `paths` object with SVG path elements

### 5. Error Handling Pattern

**API Route**:
```typescript
try {
  // operation
} catch (error) {
  console.error("Detailed error:", error); // Server log
  return json({ error: "Generic user message." }, { status: 500 });
}
```

**Client**:
```typescript
try {
  await callApi("/api/app", { method: "POST", body: JSON.stringify(data) });
} catch (e) {
  setNotice(e instanceof Error ? e.message : "Generic fallback");
}
```

## Integration Points

### Cloudflare Bindings

- `env.DB` — D1 database (configured in `.openai/hosting.json` as `"d1": "DB"`)
- `env.ASSETS` — Static assets (not available in Miniflare dev, see M5 fix in AUDIT-REPORT.md)
- `env.IMAGES` — Image optimization API (Cloudflare specific)

Access via `import { env } from "cloudflare:workers"` (requires `@cloudflare/workers-types`)

### External Dependencies

- **Drizzle ORM**: Schema in `db/schema.ts`, config in `drizzle.config.ts`
  - Generate migrations: `npm run db:generate` (wraps drizzle-kit)
  - But migrations applied manually in runtime via schemaStatements in API route
- **vinext**: Vite plugin for Next.js RSC, handles routing and bundling
  - Config: `vite.config.ts` imports vinext and Cloudflare plugin
  - Custom plugin: `build/sites-vite-plugin.ts` packages `.openai/hosting.json` and migrations to `dist/`

## Common Pitfalls & Solutions

1. **Type errors for Cloudflare imports**: Ensure `@cloudflare/workers-types` installed and in `tsconfig.json` types array
2. **Database not initialized**: Check `.wrangler/` exists and `ensureReady()` ran (happens on first API call)
3. **NaN values crash DB inserts**: Always use `parseQty()` / `parseAmount()` from business.ts, never Math.floor() directly on user input
4. **Cart state lost on view change**: Cart persists in component state, only cleared on successful order or manual reset
5. **Stock goes negative**: Reserved stock prevents overselling; cancellation logic returns stock correctly per status
6. **Mobile nav missing**: Below 1100px, desktop nav hidden and `.mobile-nav` (bottom bar) should appear — check CSS media query

## File Navigation

**Critical files**:
- `app/store-app.tsx` — All client UI and state
- `app/api/app/route.ts` — All server API logic
- `lib/business.ts` — Pure business logic functions
- `db/schema.ts` — Database schema
- `app/globals.css` — All styles
- `vite.config.ts` — Build configuration
- `worker/index.ts` — Workers entry point

**Audit & docs**: See `AUDIT-REPORT.md` for detailed security findings and fixes applied
