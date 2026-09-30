# Café POS QA Report

**Run date:** 2026-09-29  
**Scope:** Current standalone Café POS source tree  
**QA mode:** Build/type gates executed; workflow behavior reviewed against source. Interactive application and database E2E scenarios were not executed.

## Executive Summary

| Verification | Result | Evidence |
| --- | --- | --- |
| Production build | **PASS** | `npm run build` completed for renderer, Electron main, and preload bundles. |
| Strict TypeScript | **PASS** | `npx tsc --noEmit --noUnusedLocals` completed with no diagnostics. |
| Automated test suite | **NOT CONFIGURED** | `package.json` has no test, lint, or E2E script; no `*.test.*` or `*.spec.*` files were found. |
| Interactive E2E | **NOT RUN** | The development renderer selected port 5174 because 5173 was occupied. The integrated browser could not connect to the local endpoint, so no live UI/database assertions were made. The QA-launched development process was stopped. |

The application builds and type-checks cleanly, and the implementation paths for most requested features are present. **Full acceptance is not confirmed.** Source review identified gaps in database-level duplicate-checkout idempotency, occupied-table enforcement, and waiter reset after clearing a cart. These and all runtime-only scenarios remain open pending fixes and an executable integration/E2E environment.

## Status Definitions

- **PASS (automated):** A command was executed and completed successfully.
- **REVIEWED:** The implementation path was inspected; this is not proof of runtime behavior.
- **PARTIAL:** A UI or code-level safeguard exists, but it does not cover the full requested edge case.
- **GAP:** The requested guarantee is not enforced by the reviewed backend path.
- **NOT RUN:** Requires interactive runtime or a test harness that was unavailable for this run.

## Test Categories and Matrix

### Security

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| First-run setup | When no admin exists, require manager username/PIN creation; reject mismatched confirmation and invalid lengths. | **REVIEWED** in `LoginPage.tsx`, `src/main/index.ts`, and `src/main/db/database.ts`; runtime not run. |
| Password/PIN storage | Store salted `scrypt` hashes; compare hashes with a timing-safe comparison. | **REVIEWED** in `src/main/db/database.ts`; runtime/database assertions not run. |
| Session binding | A session token is valid only for its originating renderer `webContents`; stale/foreign tokens are rejected. | **REVIEWED** in `src/main/index.ts`; IPC rejection not exercised live. |
| Role checks | Restrict analytics, Settings, backup, reset, restore, and shift handover to manager roles; reject unauthorized IPC calls. | **REVIEWED** in `src/main/index.ts`; role matrix not executed. |
| Admin PIN throttling | Five failed PIN attempts within 60 seconds are recorded; subsequent attempts are throttled and audited. Successful authorization clears the failure window. | **REVIEWED** in `src/main/index.ts`; failed-attempt sequence and audit rows not executed. |
| Override grant safety | Grants are one-use, expire after 60 seconds, and are bound to session, renderer, and operation scope. | **REVIEWED** in `src/main/index.ts`; replay/scope/expiry attacks not executed. |
| Account creation | Manager credentials are verified in the main process before creating a cashier; renderer-supplied actor identity is ignored. | **REVIEWED** in `src/main/index.ts`; account creation not executed. |

### Billing and Inventory

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| Menu search/category filter | Filter displayed products by query/category and preserve the correct item identity and price in the cart. | **REVIEWED** in `BillingPage.tsx`; UI interaction not run. |
| Cart quantity/removal | Adjust quantities against recipe-derived capacity, prevent displayed ingredient overdraw, and remove lines when quantity reaches zero. | **REVIEWED** in `BillingPage.tsx`; interaction not run. Database ingredient stock is revalidated at save time. |
| Order channels | Walk-in and takeaway omit tables; dine-in requires a selected table. | **REVIEWED** in `BillingPage.tsx` and `src/main/index.ts`; channel cases not run. |
| Waiter/server default and override | Default to the signed-in staff display name; validate and persist an override to the order and receipt snapshot; preserve authenticated cashier identity separately. | **REVIEWED** in `BillingPage.tsx`, `src/main/index.ts`, and `src/main/db/database.ts`; saved-row attribution not exercised. |
| Total/product validation | Reject malformed items, missing recipes, stale prices, unavailable products, insufficient ingredients, invalid table IDs, and mismatched tax/total calculations. | **REVIEWED** in `src/main/index.ts` and `src/main/db/database.ts`; invalid-payload cases not executed. |
| Atomic checkout | Verify BOM requirements before token allocation/order insertion, then write order, table status, ingredient deductions, and audit rows in one immediate transaction; rollback all writes on failure. | **REVIEWED** in `src/main/db/database.ts`; forced-failure rollback not executed. |
| Recipe ingredient deduction | Aggregate BOM quantities across cart lines, deduct integer grams/milliliters/each with the order, and write sale movement/audit entries. | **REVIEWED** in `src/main/db/database.ts`; database fixture not executed. |
| Insufficient raw material | Reject the full checkout with ingredient name and available/required quantities; preserve token, order, table, and raw stock. | **REVIEWED** in `src/main/db/database.ts` and `BillingPage.tsx`; rollback not executed. |
| Raw purchase and cost ledger | Add integer base-unit stock and integer minor-unit spend atomically; attribute supplier and audit actor, then include purchase in date-range spend totals. | **REVIEWED** in `RawInventoryPage.tsx`, `src/main/index.ts`, and `src/main/db/database.ts`; purchase fixture not executed. |
| Recipe COGS estimate | Estimate consumed ingredient cost from purchase history using integer weighted-average costs; ignore voided sales and mark missing-cost history incomplete. | **REVIEWED** in `src/main/db/database.ts` and `AnalyticsPage.tsx`; totals not compared to fixtures. |
| Inventory Spending access/range | Restrict report IPC to admin/manager roles and apply the shared valid-date and one-year range validation. | **REVIEWED** in `src/main/index.ts`; unauthorized request not submitted. |
| Authorized ingredient management and BOM edits | Require Admin PIN grants for raw-material CRUD and menu/BOM mutations; persist audit records and prevent duplicate or invalid recipes. | **REVIEWED** in `src/main/index.ts`, `src/main/db/database.ts`, and renderer forms; live authorization not exercised. |
| Void raw-material restoration | Restore quantities from the order's original sale movement ledger even if its product recipe changed later; prevent repeated restoration on a second void. | **REVIEWED** in `src/main/db/database.ts`; movement fixture not executed. |
| Rapid duplicate checkout | Disable the UI save action while saving and prevent a second save after success. The database has a unique `order_uuid` check. | **PARTIAL.** The UI has `saving`/`saveSuccess` guards, but `pos:createOrder` generates a new UUID for every IPC request. A repeated request does not reuse an idempotency key and can create a second order. Backend retry/double-submit behavior is not safe by idempotency contract. |
| Occupied-table lock | Reject a stale or concurrent dine-in checkout when a table is unavailable/occupied, unless multi-order-on-occupied-table is an explicitly supported business rule. | **GAP / BUSINESS RULE NEEDED.** The database validates that the table exists but does not check its current `status` before inserting. Table status can also be changed independently through `updateTableStatus`. No concurrency test was run. |
| Waiter reset after abandoning a cart | Clearing/abandoning a bill should not silently apply a previous manually selected waiter to a new order. | **GAP.** `clearCart` clears cart and table state, but does not reset `serverName`. It resets on **Ready for Next Order** only. |

### KDS Queue and Undo

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| Queue refresh | Refresh active-shift non-voided tickets every three seconds, ordered by kitchen stage/time. | **REVIEWED** in `KitchenPage.tsx` and `src/main/db/database.ts`; live polling not timed. |
| Valid transitions | Permit `pending → cooking`, `cooking → ready`, and one-step Undo transitions `cooking → pending` and `ready → cooking`. | **REVIEWED** in `src/main/db/database.ts`; transitions not submitted to a live database. |
| Ship / Serve | Move a Ready ticket to `completed`, audit actor/token, and remove it from the live KDS queue while preserving order history. | **REVIEWED** in `KitchenPage.tsx`, `src/main/index.ts`, and `src/main/db/database.ts`; live transition not executed. |
| Existing database status migration | Upgrade the orders status constraint to include `completed` without changing saved order rows. | **REVIEWED** in `src/main/db/database.ts`; legacy-schema fixture not executed. |
| Invalid transitions | Reject skipped transitions, updates for missing/voided orders, and other out-of-sequence status changes. | **REVIEWED** in `src/main/db/database.ts`; rejection cases not executed. |
| Transition audit | Record actor, token, old status, and new status for accepted state changes. | **REVIEWED** in `src/main/db/database.ts`; audit rows not queried. |
| KOT price exclusion | Ensure chef-ticket preview/export contains item and quantity details but no prices. | **REVIEWED** in `ChefTokenPreview.tsx` and ESC/POS generation; exported artifacts not inspected. |

### History and Dual Receipts

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| Order/token search | Search recent orders by token/order number and item text; filter by channel. | **REVIEWED** in `HistoryPage.tsx`; searches not entered interactively. History requests up to 500 orders. |
| Order inspection | Show order ID, linked shift token, channel/table, date, total, and saved items. | **REVIEWED** in `HistoryPage.tsx` and receipt preview components; UI not exercised. |
| Customer receipt | Show branding, server, itemized prices, subtotal/tax/total; expose reprint and PDF/image export. | **REVIEWED** in `ThermalReceiptPreview.tsx`; no print/export was produced. |
| Chef token | Show price-free kitchen ticket; expose KOT print and PDF/image export. | **REVIEWED** in `ChefTokenPreview.tsx`; no print/export was produced. |
| Matched preview structure | Keep a shared outer layout/action/header/scroll structure while varying paper formatting only. | **REVIEWED** in `ReceiptPreviewLayout.tsx`, `ThermalReceiptPreview.tsx`, and `ChefTokenPreview.tsx`; visual comparison not automated. |
| Protected void | Require reason and scoped PIN grant; mark order voided, restore inventory, free table when eligible, and preserve audit entry. | **REVIEWED** in `HistoryPage.tsx`, `src/main/index.ts`, and `src/main/db/database.ts`; void flow not run. |

### Analytics

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| Date ranges | Apply Today/Week/Month/Custom range to sales and employee metrics; reject invalid or over-one-year ranges. | **REVIEWED** in `AnalyticsPage.tsx` and `src/main/index.ts`; date-boundary queries not executed. |
| Sales metrics | Calculate sales, bills, average bill, channel totals/counts, best sellers, gross profit, and occupied tables. | **REVIEWED** in `src/main/db/database.ts` and `AnalyticsPage.tsx`; numbers not compared to fixture data. |
| Employee attribution | Attribute order count, sales, AOV, and dish performance to saved waiter/server name; fall back to legacy cashier attribution. | **REVIEWED** in `src/main/db/database.ts`; aggregate totals not verified with seeded fixtures. Duplicate normalized waiter names are grouped together. |
| Employee comparison/search | Render comparative bars, three desktop cards per row, filter by staff name/ID, and show empty/no-match states. | **REVIEWED** in `AnalyticsPage.tsx`; responsive visual and interaction tests not run. |
| Profit completeness | Exclude tax, account for discount, and display incomplete when item costs are missing. | **REVIEWED** in `src/main/db/database.ts`; calculations not checked against known-value fixtures. |

### Settings, Appearance, and Local Database Operations

| Scenario | Expected behavior | Result |
| --- | --- | --- |
| Theme | Toggle light/dark theme; persist to local storage and SQLite, and reload stored theme. | **REVIEWED** in `App.tsx` and Settings flow; persistence/restart not run. |
| Café profile/settings | Update profile, tax/currency, text scale, table count, and printer configuration with main-process validation and authorization. | **REVIEWED** in `SettingsPage.tsx` and `src/main/index.ts`; actual values not changed. |
| Staff management | Change credentials and create cashier accounts only after manager verification. | **REVIEWED** in `SettingsPage.tsx` and `src/main/index.ts`; account operations not run. |
| Backup export | Use SQLite backup API, integrity-check the temporary copy, and safely replace destination via staged write. | **REVIEWED** in `src/main/db/database.ts`; no backup file generated. |
| Restore | Validate the selected database and retain/restore a rollback copy if replacement fails. | **REVIEWED** in `src/main/db/database.ts`; no restore attempted. |
| Reset | Verify a pre-reset recovery file before resetting; restore original DB on reset failure. | **REVIEWED** in `src/main/db/database.ts`; reset not attempted. |
| Local-only operation | Keep orders/settings in the terminal’s user-data SQLite file; no peer discovery or sync routes. | **REVIEWED** by source inventory and current project map; multi-device/network isolation not exercised. |

## Edge Cases and Safeguards

| Edge case | Current safeguard | QA disposition |
| --- | --- | --- |
| Wrong/unauthorized PIN override | Main process checks role/session/scope, throttles repeated failures, audits failures/throttling, and issues expiring one-use grants. | Source-reviewed; attack sequence not runtime-tested. |
| Order product/stock changes during checkout | Main process rechecks product identity, price, availability, and quantity; conditional stock update and order/token writes share a transaction. | Source-reviewed; concurrent checkout not runtime-tested. |
| Repeated save click | Modal sets a saving state and disables Save; successful save disables the action. | UI guard reviewed. Repeated IPC requests are not idempotent because the main process generates a fresh UUID per request. |
| Stale waiter after Next Order | Ready-for-next resets waiter to signed-in employee. | Source-reviewed. Clearing a cart alone does not reset waiter; stale assignment remains possible. |
| Occupied table selected from stale UI | Database verifies table existence and transactionally marks it occupied. | Availability is not rechecked at save; occupancy lock is not established. Clarify whether additional orders on occupied tables are intended. |
| Invalid KDS transition | Database accepts only adjacent forward/undo transitions, rejects voided/missing orders, and audits successful changes. | Source-reviewed; runtime transition matrix not executed. |
| Backup/restore/reset failure | Temporary staging, integrity validation, WAL checkpoints, rollback files, and cleanup are implemented. | Source-reviewed; induced I/O failures were not tested. |
| Legacy database/order | Startup migration preserves order history, adds missing fields, and strips obsolete counter/sync/guest-count schema. | Source-reviewed; representative legacy database migration not executed. |

## Runtime Test Execution Plan

These acceptance checks are still required in an Electron runtime with an isolated test user-data directory. Do not use a staff production database for destructive backup/restore/reset tests.

1. Start from an empty temporary user-data directory; create the first admin, inspect that only a salted hash is persisted, and verify first-run setup disappears after creation.
2. Sign in as admin and cashier. Attempt each manager-only IPC action as cashier and verify rejection. Submit six invalid Admin PIN attempts inside one minute and verify the sixth is throttled and audit rows exist.
3. Create test products with known price/cost/stock; exercise search, category filter, cart increment/decrement/removal, and all three channels. Save a waiter override and compare database column, receipt snapshot, and employee aggregation. Force a stock conflict during checkout and verify order/token/stock rollback.
4. Test rapid double-click and repeated IPC checkout with the same logical bill; assert exactly one order/token/stock deduction. Test occupied-table behavior and stale UI state against the intended multiple-order business rule.
5. Verify KDS polling, each valid transition, every invalid transition, Undo, voided-ticket exclusion, and audit rows. Measure the poll interval around three seconds.
6. Seed historical orders and verify history search/filter/item details. Generate customer receipt and chef token in preview/PDF/PNG; confirm customer prices/branding and no prices on KOT. Void one order with a valid grant and verify stock/table/audit outcomes; reject invalid and replayed grants.
7. Seed orders across date boundaries and multiple waiters; compare Today/Week/Month/Custom sales and employee metrics to independent SQL totals. Test employee search, no-match state, and desktop/tablet/mobile card layout.
8. Toggle themes and restart; update café profile/staff/settings; export and validate a backup; restore it; reset only in temporary user data; verify rollback behavior with an intentionally invalid backup and simulated file failure.

## Verification Status

The production build and strict TypeScript gate pass. Source inspection confirms implementation paths for authentication, checkout transactions, waiter attribution, KDS transition rules, dual previews, analytics, and safe backup operations.

**The requested full end-to-end test run is not complete.** No automated test runner exists, and the integrated browser could not connect to the Vite development endpoint. The tests marked **REVIEWED** above are code-path verification only, not executed acceptance tests. Duplicate-request idempotency, occupied-table locking, and waiter reset on cart clear require resolution or an explicit accepted policy before all client edge-case requirements can be marked fully satisfied.
