# Café POS

CAFE POS is a local-first desktop point-of-sale application for a single café terminal. It is built with Electron, React, TypeScript, Vite, and SQLite (`better-sqlite3`). The bundled café branding is Chai Fusion Café; the café name and receipt details can be changed in Settings.

The renderer never opens SQLite directly. It calls a typed API exposed by the Electron preload bridge; the main process validates requests, enforces permissions, and performs database and hardware operations. Each installation uses its own local database. There is no peer discovery, LAN order forwarding, or device-to-device synchronization.

## Contents

- [Features](#features)
- [Order and waiter workflow](#order-and-waiter-workflow)
- [Kitchen queue](#kitchen-queue)
- [History and receipt previews](#history-and-receipt-previews)
- [Analytics](#analytics)
- [Products and inventory](#products-and-inventory)
- [Accounts and security](#accounts-and-security)
- [Local database and backups](#local-database-and-backups)
- [Printing and branding](#printing-and-branding)
- [Settings and appearance](#settings-and-appearance)
- [Architecture and project map](#architecture-and-project-map)
- [Development](#development)
- [Packaging](#packaging)
- [Limitations](#limitations)

## Features

| Page | Main capabilities | Access |
| --- | --- | --- |
| Billing | Search the menu, build a cart, choose walk-in/dine-in/takeaway, select a table, assign a waiter/server, review the order, and save it. | Admin and cashier |
| Kitchen | Monitor current-shift tickets, move orders through Pending/Cooking/Ready, undo one status step, and print chef tokens. | Admin and cashier |
| Tables | View floor status, change table availability, and begin a dine-in order. | Admin and cashier |
| Menu | Manage finished sellable products, prices, variants, stock, availability, and unit cost. Changes require an Admin PIN. | Signed-in staff; mutations require authorization |
| History | Search orders and tokens, inspect itemized receipts, preview customer receipts or chef tokens, print/export, and request a protected void. | Admin and cashier; void requires authorization |
| Analytics | Sales and store performance, plus searchable employee sales, bill-count, average-bill, and dish comparisons. | Admin/manager |
| Settings | Café profile, printer, staff credentials, floor setup, shift handover, audit log, local backup/restore/reset, and restart. | Admin/manager |

The interface also includes first-run setup and login, responsive tab navigation, a table picker, shared receipt preview framing, Admin PIN prompts, loading/error notifications, and a renderer error boundary.

## Order and Waiter Workflow

1. On sign-in, Billing loads products, tables, local settings, and local sales statistics through `window.api`.
2. Staff build a cart and select an order channel. Dine-in orders require a table. Stock shown in the renderer is checked again by the database when the order is saved.
3. The **Waiter / Server** input defaults to the signed-in staff member’s display name. Staff can enter another name when a different floor server took the order.
4. Billing calculates the subtotal and configured tax, then opens a preview. A draft has no database ID, does not reserve a token, and does not change inventory.
5. Saving sends the order through the preload bridge to the main-process `pos:createOrder` handler. SQLite validates the items, prices, table, and total, then atomically assigns the active-shift token, records the order and staff attribution, marks a dine-in table occupied, deducts stock, and writes an audit event.
6. The signed-in cashier remains the authenticated operator for audit purposes. The selected waiter/server name is stored separately in the `orders.server_name` column and receipt snapshot; employee metrics use that assigned name.
7. Voiding a saved order requires an Admin PIN grant. The order remains in history with its void status, inventory is restored, and an audit event is recorded. Discarding an unsaved draft is also authorized and audit-logged but does not affect inventory.
8. **Ready for Next Order** clears the draft and resets the waiter/server input to the signed-in employee.

Tokens increment within the active shift and reset during shift handover, not at midnight. A draft’s `PREVIEW` token is not reserved. Guest headcounts are not captured or reported.

## Kitchen Queue

New saved orders enter the active local shift’s kitchen queue as `pending`. The Kitchen page refreshes the queue every three seconds and shows ticket time, token, channel/table, item names, variants, and quantities. Prices are omitted from the kitchen ticket.

Allowed status changes are `pending → cooking`, `cooking → pending`, `cooking → ready`, and `ready → cooking`. The database validates each one-step change and logs it, so staff can undo an accidental transition without allowing skipped stages. Voided orders do not appear in the queue. Ready tickets remain visible; there is no separate served/cleared stage.

## History and Receipt Previews

History loads up to 500 recent orders and links each order ID to its shift token. Staff can filter by channel and search order/token numbers or item names. Selecting an order opens tabs for:

- **Customer Receipt:** café identity, token, server, itemized prices, subtotal, tax, and total, with PDF/image export and receipt printing.
- **Chef Token:** a price-free kitchen ticket with item names, variants, quantities, server, and order details, with PDF/image export and KOT printing.

Both previews use the same outer layout, action placement, status-message placement, and scrolling behavior. Only their printable paper/ticket formatting differs. Admins/managers can request a void from the inspector; it requires an authorized PIN and a reason.

PDF export is handled by Electron after validating the generated HTML and opening a save dialog. Image export is generated in the renderer as a PNG. The customer and chef PDF formats target 80 mm paper.

## Analytics

The Analytics page has shared Today, This Week, This Month, and Custom date-range controls. The selected range is sent to the main process for both sales and employee metrics; custom ranges are limited to one year. Data refreshes every 15 seconds and can be refreshed manually.

**Sales Analytics** includes total sales, bills issued, average bill, gross profit, occupied tables, order-channel breakdowns, and best sellers. **Employee Sales Analytics** includes a name/ID search and responsive employee cards. Each card compares sales volume, bill count, and average bill with progress bars, lists channel and gross-profit values, and ranks that employee’s top dishes. The desktop layout shows three employee cards per row; it collapses to fewer columns on narrower screens.

Employee attribution uses the waiter/server name saved on each order. Older orders without a waiter assignment fall back to the cashier snapshot or appear as legacy/unassigned. Repeated waiter names are grouped by normalized name. Metrics are bill/order counts, not guest counts. Gross profit excludes tax, applies the order discount, and is marked incomplete if saved item cost data is unavailable.

Audit records are stored in SQLite and viewable from Settings. Main-process diagnostic logs are written to the private Electron user-data `logs` directory; the active log rotates at 5 MiB with one previous file retained.

## Products and Inventory

The `products` table tracks finished sellable goods, not raw ingredients. Product records include name, category, sale price, optional unit cost, integer stock, optional variant, availability, and a low-stock threshold. Checkout deducts sold units in the same transaction as order creation; a successful void restores them.

A new database is seeded with sample café products, ten tables, `Rs.` currency, an 8% tax rate, and default local settings. Existing menu and settings data are retained during normal startup migrations.

There is no raw-material/recipe (BOM), ingredient-consumption, supplier, purchase-order, or waste-management system. Costs are optional; historical profit cannot be reconstructed for items that were saved without cost data.

## Accounts and Security

- First-run setup creates the initial admin account; there are no built-in default credentials. Admins can create cashier accounts with a username, display name, and PIN/password.
- Credentials are salted and hashed with Node’s `scrypt`. Sessions are held in the Electron main process and bound to the originating renderer window.
- The shared role type includes `manager`, but SQLite currently permits persisted `admin` and `cashier` accounts. The initial manager/operator account is stored as `admin`.
- Analytics, Settings, shift handover, backup, restore, and reset are protected by main-process role checks as well as UI visibility.
- Menu mutations and order voids use short-lived, one-use Admin PIN grants scoped to the requested action and current session/window. The main process consumes each grant before applying the mutation. Renderer-supplied actor names are not trusted for privileged operations.
- Failed PIN attempts are audit-logged and rate-limited. Grant acceptance/rejection, checkout, voids, menu changes, shift handovers, and kitchen status transitions are also recorded.
- Electron enables context isolation and disables Node integration in the renderer. The preload bridge exposes only the typed POS API.

## Local Database and Backups

The live SQLite file is `pos_production.db` in Electron’s per-user application-data directory. If that file does not exist but the older `cafe_pos.sqlite` file does, startup migrates the legacy file. When Electron’s `userData` path is unavailable in CLI tooling, the database module falls back to `<current-working-directory>/data`.

SQLite uses WAL mode, `synchronous=NORMAL`, foreign keys, and a five-second busy timeout. The main schema covers products, auth users, tables, orders, settings, shifts, the active shift, and audit logs; a legacy token tracker may remain in upgraded databases. Migrations preserve order history, add current order fields such as waiter/server attribution, and remove legacy counter/sync/guest-count data.

Each device operates independently on its own local database. There is no LAN sync server, peer discovery, order forwarding, or automatic reconciliation. Moving data between devices is a manual backup/restore operation.

Settings provides these local data operations:

- **Export:** create a consistent SQLite backup using the SQLite backup API and verify its integrity before writing it to the selected destination.
- **Restore:** validate a selected Café POS database backup, preserve a rollback copy during replacement, then reload the application.
- **Reset:** create and verify a recovery backup in the private `backups` folder before resetting the terminal to first-run defaults.

## Printing and Branding

Customer receipts and chef tokens have separate ESC/POS formats. The configured printer interface can send raw TCP jobs to a network thermal printer IP and port (default port `9100`); auto-print can be enabled for customer receipts at checkout. Both customer and chef jobs use the configured endpoint. Separate kitchen-printer routing and direct USB printer support are not implemented. With no physical printer configured, previews can be exported as PDF or PNG for printing through another application.

The Chai Fusion Café logo is used for the app window/tray and renderer branding. Source assets are `build/icon.png`, `build/icon.ico`, `build/icon.svg`, and `src/renderer/public/icon.png`; the renderer PNG is used by the navigation, login/setup screen, receipt modal, and customer receipt. Update these assets together when replacing the bundled mark.

The application is intended to run as an Electron desktop app. In a browser without Electron’s `window.api`, local authentication, database operations, device printing, and PDF export are unavailable.

## Settings and Appearance

Settings includes café name/address/phone, currency and tax, application text scale, floor table count, printer selection and endpoint, auto-print, account credentials, cashier creation, shift handover, audit logs, local backup/restore/reset, and application restart. Saving privileged settings requires authorization.

The theme control toggles the root `dark` class and persists the preference to local storage and SQLite. Tailwind uses class-based dark mode, with shared CSS remapping common light surfaces. Receipt and chef-ticket paper remains white in dark mode for legibility and printing.

## Architecture and Project Map

```text
src/
	main/
		index.ts                 Electron lifecycle, secure sessions, IPC validation, dialogs
		logger.ts                Private rotating main-process logs
		db/database.ts           SQLite schema, migrations, seed data, transactions, reports
		printer/escpos.ts        Customer receipt and chef-token ESC/POS generation/output
	preload/
		index.ts                 Typed contextBridge API used by the renderer
	renderer/
		index.html               Vite renderer document
		public/icon.png          Renderer and receipt logo
		src/
			main.tsx               React entry point and error boundary
			App.tsx                Login/session state and page routing
			index.css              Global styles and theme mappings
			pages/                 Login, Billing, Kitchen, Tables, Menu, History, Analytics, Settings
			components/            Tab navigation, modals, receipt layouts/previews, loader, toasts
	types/
		auth.ts                  User/session/authorization contracts
		pos.ts                   Products, orders, settings, metrics, and API data contracts
scripts/
	prepare-native.js          Prepare the platform/Electron better-sqlite3 binary
	after-pack.js              Linux AppImage startup wrapper and sandbox cleanup
build/
	icon.png, icon.ico, icon.svg
```

The renderer’s page components call `window.api`. `src/preload/index.ts` maps those methods to IPC channels. `src/main/index.ts` validates sessions, roles, arguments, and Admin PIN grants before calling the database DAO or printer. `src/main/db/database.ts` owns persistence and transaction boundaries; UI code should not open SQLite directly.

## Development

Requirements: Node.js and npm compatible with Electron 34, plus the platform’s native runtime requirements. The `postinstall` script prepares a `better-sqlite3` binary for the current platform when a cached binary is available or can be downloaded.

```sh
npm install
npm run dev
npx tsc --noEmit
npm run build
```

`npm run dev` and `npm run electron:dev` invoke the Vite/Electron development workflow. The Vite server defaults to port `5173` and can select another available port if needed. `npm run build` builds the renderer and the Electron main/preload bundles into `dist/` and `dist-electron/`.

Native dependency helper:

```sh
npm run rebuild
```

There are currently no automated test, lint, or end-to-end scripts in `package.json`. TypeScript checking and production builds are the configured verification commands.

## Packaging

```sh
npm run electron:linux   # Linux x64 AppImage
npm run electron:build   # Windows x64 NSIS installer
```

Packaging prepares the matching native SQLite binary, builds the app, and invokes `electron-builder`. Windows uses `build/icon.ico`; Linux uses `build/icon.png`. The Linux post-pack step creates a startup wrapper for restricted/FUSE environments. Current configured outputs are written under `release/`.

## Limitations

- POS data is local to each installation. There is no online service, inter-device sync, remote backup, or automatic merge.
- Stock tracks finished product units only; there is no recipe-based raw-material inventory, supplier purchasing, or waste tracking.
- The Billing interface currently records cash paid equal to the amount due. The shared types and database have card/split payment fields, but cashier entry for card, split payments, and discounts is not implemented.
- Auto-print and KOT print use the one configured network printer endpoint; separate customer/kitchen printer selection and direct USB printing are not available.
- Guest counts and fixed operating expenses are not recorded. Employee performance reports bill volume; gross profit is not net profit and depends on saved product costs.
- Legacy orders without a specific waiter/server assignment can only be attributed using their saved cashier data or shown as legacy/unassigned.
- No automated test suite is configured yet.
