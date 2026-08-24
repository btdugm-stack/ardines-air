# 🎯 Quick Reference: Unused Files List

## Summary
- **Total Files**: 49
- **Unused/Dead Code**: 2 files (4%)
- **Partially Used**: 3 files (6%)
- **Actively Used**: 44 files (90%)

---

## 🔴 MUST DELETE (Dead Code)

### 1. `app/chatgpt-auth.ts` (87 lines)
- **Problem**: Completely unused - no imports found anywhere
- **Exports**: 4 functions (getChatGPTUser, requireChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath)
- **Severity**: HIGH - Remove immediately
- **Action**: Delete file
- **Impact**: 0 breaking changes (nothing uses it)

---

## ⚠️ CONSIDER ACTION (Partially Used/Examples)

### 2. `examples/d1/app/api/notes/route.ts` (59 lines)
- **Problem**: Example/reference code only, not production
- **Severity**: LOW - Reference code
- **Action Options**:
  - Option A: Delete if not needed
  - Option B: Move to `docs/examples/`
  - Option C: Keep but mark clearly in README
- **Recommendation**: Move to docs

### 3. `examples/d1/db/schema.ts` (9 lines)
- **Problem**: Duplicate schema example, not used
- **Severity**: LOW - Reference code
- **Action**: Same as above (move to docs with notes example)

### 4. `db/index.ts` - getDb() function
- **Problem**: Exported but NOT imported in API route
- **Severity**: MEDIUM - Code quality issue
- **Current Usage**: 0 (API route uses direct drizzle() call)
- **Action**: Update `app/api/app/route.ts` to import and use `getDb()`
- **Effort**: 2 minutes
- **Impact**: Better code organization

---

## 📊 Detailed File Usage

### Entry Points ✅
```
app/page.tsx
  └─> app/store-app.tsx (Main UI - 255 lines)
       └─> calls: POST /api/app (all server logic)
       └─> imports: lib/business.ts ✅
       └─> imports: next/image ✅

worker/index.ts (Workers runtime entry)
  └─> uses: handleImageOptimization ✅

app/api/app/route.ts (Server API - 457 lines)
  └─> imports: lib/business.ts ✅
  └─> MISSING: Should import db/index.ts getDb() ⚠️
  └─> Currently: Direct drizzle(env.DB, { schema }) call
```

### Critical Files ✅
- `app/store-app.tsx` - Main UI component (255 lines)
- `app/api/app/route.ts` - All server logic (457 lines)
- `lib/business.ts` - Business validations & calculations
- `db/schema.ts` - Database schema definition
- `app/globals.css` - All styling (3,453 lines)

### Configuration ✅
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript config
- `vite.config.ts` - Build config
- `next.config.ts` - Next.js config
- `drizzle.config.ts` - Database migrations
- `.openai/hosting.json` - Deployment config

### Build Scripts ✅
- `scripts/build-verified.sh` - Build process
- `scripts/install-ci.sh` - Installation
- `scripts/sites-env.sh` - Environment setup
- `build/sites-vite-plugin.ts` - Vite plugin (used)

### Tests ✅
- `tests/business.test.mjs` - Business logic tests
- `tests/rendered-html.test.mjs` - HTML render tests

### Documentation ✅
- `README.md` - Project guide
- `AUDIT-REPORT.md` - Security findings
- `.github/copilot-instructions.md` - AI agent guide
- `UI-ENHANCEMENT-REPORT.md` - Design documentation
- `SUMMARY.md` - Project overview

---

## Action Priority

### 🔴 HIGH - Do This First
```bash
# Delete dead code
rm app/chatgpt-auth.ts
git add -A
git commit -m "refactor: remove unused chatgpt-auth.ts dead code"
```

### 🟡 MEDIUM - Do This Next
```bash
# Refactor API route to use getDb() helper
# File: app/api/app/route.ts
# Change: const db = drizzle(env.DB, { schema });
# To: import { getDb } from "../../db"; const db = getDb();
```

### 🟢 LOW - Consider Later
```bash
# Organize examples
mv examples/d1 docs/examples/d1
echo "# D1 Database Example\nSee app/api/app/route.ts for actual usage." > docs/examples/d1/README.md
```

---

## Impact Assessment

| Action | Effort | Risk | Value | Priority |
|--------|--------|------|-------|----------|
| Delete chatgpt-auth.ts | 1 min | None | High | 🔴 ASAP |
| Refactor getDb() usage | 2 min | None | High | 🟡 Soon |
| Move examples to docs | 3 min | None | Medium | 🟢 Later |

---

## Unused Imports Found

### In app/chatgpt-auth.ts:
```typescript
import { headers } from "next/headers";        // ✅ Used
import { redirect } from "next/navigation";    // ✅ Used
```

### In app/store-app.tsx:
```typescript
import Image from "next/image";                // ✅ Used (1x in hero)
```

### No other unused imports found ✅

---

## Code Quality Indicators

✅ No circular dependencies  
✅ No broken imports  
⚠️ 1 unused export (getDb in db/index.ts)  
❌ 1 dead code file (chatgpt-auth.ts)  
❌ 2 example files (not production)  

**Overall**: GOOD (85% actively used code)

---

## Next Steps

1. Review full report: `CODE-ANALYSIS-REPORT.md`
2. Delete `app/chatgpt-auth.ts`
3. Refactor `app/api/app/route.ts` to use `getDb()`
4. Decide on `examples/d1/` location
5. Run tests: `npm test`
6. Git commit changes

---

**Generated**: August 24, 2026  
**Full Report**: See `CODE-ANALYSIS-REPORT.md`
