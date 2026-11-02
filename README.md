# LaunchPad × AMD Beauty

A mobile-first web app for the AMD Beauty Peptide Lip Tint launch night. Guests browse the new shades and vote in a live poll. Ushers check guests in at the door. Organizers manage guests, staff and the poll from one dashboard.

Built with React and Vite on the front end and a small Node server that uses only built-in modules (`node:http`, `node:sqlite`, `node:crypto`).

## Three experiences

| Who | Flow | Access |
| --- | --- | --- |
| Attendee | `/` → `/showcase` → `/poll` → `/results` | Public, no login |
| Usher | `/staff/login` → `/usher` | Usher account |
| Admin | `/admin/login` → `/admin` | Admin account |

Staff pages are not linked from the public site, and the API checks the user's role on every request.

### Attendee

- **Landing:** the pink-splash launch screen with a **Get started** button.
- **Products:** a swipeable carousel of the four shades on phones, or a grid on desktop. Each shade has its own detail view.
- **Live poll:** three questions with a progress bar, a review step and one submission per device. Answers in progress survive a page refresh.
- **Waiting screen:** shown while the poll is closed. It has a practice question that is not counted, and it switches to the poll as soon as the organizer opens it.
- **Thank you and results:** results update live once the organizer makes them visible.
- **Display settings:** light and dark themes, larger text and a high-contrast mode.

### Usher

- Search guests by name or organization, or enter a guest's code.
- Check a guest in with one tap. Duplicate check-ins are caught. An admin can undo a mistaken check-in from the guest list.
- The guest list updates live across every usher's device.

### Admin

- **Overview:** attendance (checked in and expected), poll open and closed, results shown or hidden, live results and a poll-vote reset.
- **Guests:** add, edit and remove guests, generate new entry codes and undo check-ins. A guest with the same phone number, or the same name and organization, cannot be added twice.
- **Ushers:** create accounts, deactivate them (this signs them out immediately) and reset passwords.

## Getting started

Requires **Node 22.13 or newer**, for the built-in `node:sqlite` (`npm install` refuses older versions). Check with `node -v`; with nvm, run `nvm use 24`.

```bash
npm ci
npm run server   # API on http://localhost:3001 (creates server/data/ on first run)
npm run dev      # app on http://localhost:5173 (proxies /api to the server)
```

Run the two commands in separate terminals, then open http://localhost:5173. If another Vite project already uses that port, start this one with `npx vite --port 5180 --strictPort` and open that address instead.

### First sign-in

On first run the server creates two staff accounts with random temporary passwords:

| Username | Role | Sign in at |
| --- | --- | --- |
| `amd.admin` | Admin | `/admin/login` |
| `amd.usher01` | Usher | `/staff/login` |

The passwords are written to `server/data/dev-credentials.txt`. That file is gitignored and readable only by your user, and passwords are never printed to the console. Each account must choose a new password at first sign-in. Passwords need at least 10 characters and must not contain the username. Delete the credentials file once both passwords are changed.

Eight sample guests (codes `AMD-1001` to `AMD-1008`) are added so check-in can be tried straight away. In production (`NODE_ENV=production`) they are skipped unless `SEED_SAMPLE_GUESTS=1`. A new database starts with the poll **closed** and results **hidden**; open them from the admin overview when the launch starts.

Lost the admin password? Run `npm run reset-admin` on the server. It writes a new temporary password to the credentials file.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run server` | API server on port 3001 |
| `npm run reset-admin` | Sets a new temporary admin password (written to the credentials file) |
| `npm run seed` | Creates staff accounts and sample guests on an empty database |
| `npm run build` | Production build into `dist/` |
| `npm start` | Serves `dist/` and the API from one process (production mode) |
| `npm test` | API tests against a throwaway database |
| `npm run lint` | ESLint |

## Production

```bash
npm run build
npm start        # port 3001 by default
```

`npm start` marks session cookies as `Secure`, so the app must be served over HTTPS, for example behind a reverse proxy.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | (unset) | Set to `production` by `npm start` |
| `DATA_DIR` | `server/data` | Folder for the database and dev credentials file |
| `DB_FILE` | `$DATA_DIR/launchpad.db` | SQLite database path |
| `PUBLIC_ORIGIN` | (unset) | Public address of the app, e.g. `https://launchpad.example.com`. Used as the base of guest invitation links, and as an allowed origin when a reverse proxy rewrites the `Host` header. **Set this before sending invitations.** Without it, links use whatever address the admin opened the dashboard on. |
| `TRUST_PROXY` | (unset) | Set to `1` behind a reverse proxy so sign-in rate limiting uses the visitor's address (last `X-Forwarded-For` entry) instead of the proxy's. Without it, everyone shares the proxy's limit. |
| `SEED_SAMPLE_GUESTS` | (unset) | Set to `1` to add the sample guests to an empty production database |
| `INVITE_KEY` | (unset) | 32 random bytes, base64-encoded, used to encrypt stored invitation links. If unset, a key is created at `$DATA_DIR/invite.key`. |

## Security

- Passwords are hashed with scrypt. Sessions use random tokens stored as SHA-256 hashes, in `HttpOnly` cookies that last 8 hours.
- Roles are checked on the server for every request. Admin and usher accounts can only sign in through their own portal.
- Deactivating an usher or resetting a password takes effect on that user's next request.
- Sign-in is rate limited: 5 failures per username and IP address, or 20 per IP address, within 15 minutes.
- Requests that change data must come from the same origin, so cross-site requests are rejected.
- The poll is anonymous: one vote per browser, identified by a cookie. Someone clearing cookies or using a private window can vote again, so treat results as a live pulse, not an audited count.

## Project structure

```
server/
  index.js        HTTP server, API routes, live events (SSE), static files in production
  auth.js         password hashing, sessions, rate limiting
  db.js           SQLite schema and settings
  seed.js         first staff accounts and sample guests
  test/           API tests (node --test)
src/
  App.jsx         routing and role guards
  App.css         design tokens, light and dark themes, glass components
  styles/         attendee extras: text size, high contrast, waiting screen
  pages/          Landing, Showcase, Poll, Waiting, Results, Usher, Admin, Login, ...
  components/     Header, TopBar, AccessibilityBar, ResultsList, Icons, ...
  hooks/          useRoute, useAuth, useApiData, useLive, useTheme, useA11y
  api/client.js   fetch wrapper for /api
  data/           poll questions and product details
public/images/    product artwork
```

## Data

The SQLite database lives at `server/data/launchpad.db` and is gitignored. It stores staff accounts, sessions, guests, check-ins, poll settings and votes. Live updates reach the browser through Server-Sent Events at `/api/events`.

To change the poll questions, edit [src/data/polls.js](src/data/polls.js). Both the app and the server read it. Votes are stored by option label.

## Credits

- **Frontend development:** Marie ([@adisacodes](https://github.com/adisacodes))
- **UI/UX design:** Derrick Ayieko
