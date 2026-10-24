# Dealer | Property, with proof.

Dealer is a Rwanda-focused property marketplace and deal-workspace foundation. It connects people searching for houses, apartments, rooms, commercial property and land with people advertising them, while keeping enquiries, private conversations, evidence records and commission discussions connected to each property.

The repository is named **dealer** and the interface is currently branded **Dealer**. Before a public launch, confirm naming and trademark availability. The earlier name Komisiyoneri is already used by a property service in Rwanda; do not assume that brand is available.

> **Deployment status:** this is an actively developed, API-connected foundation, not a certified production conveyancing or financial service. The main workflows have API routes, but the project still needs automated integration tests, external security review, malware scanning for uploads, email verification and recovery, rate limiting, monitored backups, production TLS and legal review before handling real customers or documents.

## Table of contents

- [Product capabilities](#product-capabilities)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Run locally with Docker Desktop](#run-locally-with-docker-desktop)
- [Open the app](#open-the-app)
- [Install the app on desktop or mobile](#install-the-app-on-desktop-or-mobile)
- [Environment variables](#environment-variables)
- [How the workflows work](#how-the-workflows-work)
- [HTTP API reference](#http-api-reference)
- [Data model](#data-model)
- [Development without Docker](#development-without-docker)
- [Checks and troubleshooting](#checks-and-troubleshooting)
- [Security, privacy and legal boundaries](#security-privacy-and-legal-boundaries)
- [Roadmap before a public launch](#roadmap-before-a-public-launch)
- [Contributing](#contributing)

## Product capabilities

### Marketplace
- Browse **published** properties only. Unreviewed or rejected submissions are not exposed through the public listing endpoint.
- Filter by sale/rent, district and property type; search titles, descriptions and localities; sort by price or recency.
- View locality, asking price, description and the disclosed review state.
- Save and remove favourites using account-backed records that can follow the user across devices.
- Show explicit empty and API-offline states instead of inventing inventory and presenting it as real property.

### User workspace
- Register and sign in using email and password.
- Passwords are hashed using BCrypt; the API returns a signed, expiring bearer token.
- Submit property listings for human review, and see the owner's submissions and their status.
- Request a property viewing or send a question/offer lead.
- Open property-specific conversations and send authenticated messages.
- Create deal workspaces, propose a commission percentage and written terms, acknowledge the fee terms, and record deal-stage history.
- Upload evidence PDFs and images privately, list permitted document metadata, and download through an authorization-checked API route.
- Check whether an evidence hash exists in the platform audit collection.
- Use the responsive layout on desktop, tablet and mobile sizes. A web app manifest and service worker provide PWA installation support on compatible browsers.

### Administrative workspace
- Public registration cannot create an administrator account.
- Optional environment-based bootstrap creates the first administrator if the configured email is not already present.
- Users can submit an agent profile with service districts, experience, professional bio and explicit public-phone consent. Only approved agent profiles appear in the public agent directory.
- Authenticated administrators can inspect pending property listings and agent applications, approve, reject or request changes with a note. Agent approval grants the in-platform `agent` role only; it is not a government licence or legal qualification.

### Important limits
- Listing review is an internal moderation step, **not a land-title verification or legal ownership guarantee**.
- The document endpoint checks file size, allowed MIME type and basic file signatures, but does not scan for malware. Do not use it for real national IDs, title documents or contracts until production-grade storage, scanning, retention and access controls have been reviewed.
- The commission workspace records proposed terms and acknowledgements. It does not create a legally vetted agreement, hold money, run escrow or execute a payment.
- Evidence is hashed and logged in MongoDB. A hash can establish that a particular byte sequence matches a recorded digest; it cannot prove that a document is genuine or that the property belongs to the person who uploaded it.
- The in-app agent directory and application review flow are implemented; identity checking, professional references and proof of regulated qualifications remain future work.
- The Solidity/blockchain integration is **not deployed or wired into the running application**. Do not describe current evidence records as blockchain-verified.
- The mobile PWA can be installed from a supported browser. An Electron packaging path is provided for Windows, macOS and Linux desktop builds, but this repository does not yet ship prebuilt or signed installer artifacts, nor native Android APK/AAB or iOS App Store packages.

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Web client | React, TypeScript, Vite, Lucide | Responsive marketplace, workspace, forms and interactions |
| Installable app surface | Web App Manifest, service worker | Browser installation and a small cached app shell |
| HTTP API | Dart 3, Shelf, Shelf Router | Validation, account/session handling and workflow endpoints |
| Data store | MongoDB 8 | Accounts, property listings, favourites, leads, conversations, messages, deals and audit records |
| Password hashing | BCrypt | One-way password hash storage |
| API token | HMAC-SHA256 signed bearer token | Eight-hour session expiry |
| Private files | Local private volume in Docker | Evidence file bytes, served only through an authorized API handler |
| Web container | Nginx Alpine | Static SPA hosting, route fallback, compression and security headers |
| Local orchestration | Docker Compose | API, frontend, MongoDB and persistent storage |

### Request flow

1. The browser loads the React application from the web container.
2. frontend/src/api.ts calls the Dart API at VITE_API_URL.
3. Public listing requests read only records with status published.
4. Protected requests include the bearer token in the Authorization header.
5. The API checks the token and, for protected routes, verifies the user's access to the target property, conversation, deal or document.
6. MongoDB stores structured records; uploaded files live in the private evidence volume. File paths are never exposed by API responses.
7. Important submission, review, deal and upload actions create audit events.

## Repository layout

    dealer/
    ├── backend/
    │   ├── bin/server.dart          # Dart HTTP API and workflow handlers
    │   ├── pubspec.yaml             # Dart packages
    │   └── Dockerfile               # Compiled Dart API image
    ├── frontend/
    │   ├── src/
    │   │   ├── api.ts               # Typed API client and session handling
    │   │   ├── App.tsx              # Marketplace and workspace screens
    │   │   ├── main.tsx             # React entry and service-worker registration
    │   │   └── styles.css           # Responsive design system
    │   ├── public/
    │   │   ├── icon.svg
    │   │   ├── manifest.webmanifest
    │   │   └── sw.js
    │   ├── Dockerfile               # Optimized static web build
    │   └── nginx.conf               # SPA fallback and response headers
    ├── desktop/
    │   ├── main.cjs                 # Secure Electron shell
    │   └── package.json             # Desktop installer targets
    ├── .github/workflows/quality.yml # Frontend build and Dart analysis
    ├── .env.example                 # Environment template; no production secrets
    ├── docker-compose.yml           # Local multi-container stack
    └── README.md

## Run locally with Docker Desktop

### 1. Prerequisites

- Windows 10/11, macOS or Linux.
- Docker Desktop with Docker Compose v2 available (run docker compose version).
- Git, if cloning from GitHub.
- Internet access on first run to pull container images and packages.

Docker runs the API and database in containers. You do not need to install Dart or MongoDB directly on your host for the Docker workflow.

### 2. Clone the project

Windows PowerShell:

    git clone https://github.com/cedrick-web/dealer.git
    cd dealer
    Copy-Item .env.example .env
    notepad .env

If the repository is already cloned, enter its folder and pull the latest changes:

    cd path\to\dealer
    git pull origin main

Do not overwrite an existing .env containing values you need. If .env already exists, edit it and add missing variables instead of copying over it.

### 3. Configure secrets

Open .env and replace every CHANGE_ME value. The application needs a strong JWT_SECRET and MongoDB password. Generate random hexadecimal values in PowerShell:

    # 64 hexadecimal characters for JWT_SECRET
    ((1..2 | ForEach-Object { [guid]::NewGuid().ToString('N') }) -join '')

    # 32 hexadecimal characters for MONGO_ROOT_PASSWORD
    [guid]::NewGuid().ToString('N')

Copy the generated values into .env without adding quotes. Use a long alphanumeric Mongo password to avoid special-character problems in the Mongo connection URI.

Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to the administrator login you intend to use. The password must have at least 14 characters. On first startup, the API creates this administrator only if the email does not already exist. Changing those environment values later does not reset an existing user's password.

### 4. Build and start the stack

    docker compose config
    docker compose up --build -d
    docker compose ps

First-time startup downloads base images and Dart/npm dependencies. Check logs if a container does not become healthy:

    docker compose logs --tail 150 api
    docker compose logs --tail 100 frontend
    docker compose logs --tail 100 mongo

Follow API logs continuously:

    docker compose logs -f api

### 5. Verify service responses

PowerShell:

    Invoke-RestMethod http://localhost:8080/health
    Invoke-RestMethod http://localhost:8080/api/v1/districts
    Invoke-RestMethod http://localhost:8080/api/v1/listings

Expected URL map:

| Service | Local URL | Use |
|---|---|---|
| Web app | http://localhost:5173 | Browse the application |
| API health | http://localhost:8080/health | API and MongoDB check |
| Public listing API | http://localhost:8080/api/v1/listings | Published properties |
| District catalogue | http://localhost:8080/api/v1/districts | District dropdown options |
| MongoDB | Not published to host | Private container network only |

The URLs describe the configured development stack, not a claim that a build has already succeeded on your machine.

### 6. Stop or restart

    docker compose stop
    docker compose start
    docker compose down

The normal docker compose down command preserves named MongoDB and document volumes. **docker compose down -v permanently deletes the local database and uploaded private documents.** Use it only when you intentionally want a destructive reset.

## Open the app

Open http://localhost:5173 after containers start. The API status appears in the app header.

To test the complete workflow:

1. Register an ordinary user.
2. Submit a property from Create listing. It should appear under My listings as pending review, not in public Discover.
3. Sign out and sign in as the bootstrap administrator.
4. Open Review queue, inspect the submission and approve it with a note.
5. Sign back in as an ordinary user and refresh Discover.
6. Save a published property, open it and request a viewing.
7. Open Message owner and send a message to create a property-specific conversation.
8. Propose a deal and commission terms. Test fee acknowledgement and advance the stage as the involved parties.
9. Upload a small PDF or image from the account that owns the listing. Open Evidence checker to check the hash returned by the upload response.

Do not use real identity documents or title certificates while the environment is still under development.

## Install the app on desktop or mobile

This project includes PWA metadata and a service worker. With the app served over HTTPS in deployment (or localhost during development):

- **Desktop Chrome/Edge:** open the app, then use the browser's install-app control or browser menu's install option when available.
- **Android:** open the HTTPS app in Chrome and use Install app or Add to Home screen.
- **iPhone/iPad:** open the HTTPS app in Safari and use Share then Add to Home Screen. iOS PWA capabilities differ from desktop Chromium.

The service worker caches a limited app shell and static assets. **API data is intentionally not cached** because private conversations, deal records and property evidence must not be exposed to an offline shared-device cache. Offline mode does not allow messaging, listing creation, file upload or deal updates.

For reliable PWA installation in production, deploy via HTTPS and check browser dev tools for manifest and service-worker errors. This is an installable web app, not a native package or app-store release.

## Build the desktop app

The desktop directory contains an Electron shell that loads the same production React build. The renderer runs with Node integration disabled, context isolation enabled and Chromium sandboxing enabled. External HTTPS links are handed to the system browser instead of being opened inside an unrestricted embedded page.

### Windows desktop development

Keep the API and MongoDB running with Docker Compose in one terminal:

    docker compose up --build -d mongo api

In a second terminal, start the Vite development server:

    cd frontend
    npm install
    $env:VITE_API_URL = "http://localhost:8080"
    npm run dev

In a third PowerShell terminal, run the Electron shell:

    cd desktop
    npm install
    $env:DEALER_DEV_URL = "http://localhost:5173"
    npm start

The desktop shell uses the same API account and listings as the browser. For the default local stack, configure WEB_ORIGIN as http://localhost:5173,dealer://app. The packaged shell serves its UI at the secure dealer://app origin so authenticated API requests can pass the API's origin allowlist without using an unrestricted file:// origin. If the API is not running, its connection status shows offline and server-backed actions will fail with a clear message.

### Build a Windows installer

From the repository root, create the web build first:

    cd frontend
    npm install
    $env:VITE_API_URL = "http://localhost:8080"
    npm run build

Then create the Electron installer:

    cd ../desktop
    npm install
    npm run build:win

The installer output is written to desktop/release/. The build bundles the static web files, not MongoDB or the Dart API. Each installed desktop client still needs to reach an API. For other users or a public release, build the frontend with the HTTPS URL of a deployed API instead of localhost; never put database credentials or JWT signing secrets in the frontend build.

Build macOS DMG artifacts on a macOS build machine with npm run build:mac; build Linux AppImage artifacts on a Linux machine with npm run build:linux. Sign and notarize desktop artifacts and publish checksums before distributing them publicly. This repository supplies the packaging configuration, not prebuilt or signed installation binaries.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| MONGO_ROOT_USERNAME | Yes | MongoDB root/bootstrap username in Compose |
| MONGO_ROOT_PASSWORD | Yes | Strong alphanumeric MongoDB password |
| MONGO_DATABASE | No | Logical database name; default is dealer |
| JWT_SECRET | Yes | Long random HMAC signing secret; keep it private |
| API_PORT | No | API listen port; default is 8080 |
| WEB_ORIGIN | Yes for deployment | Comma-separated exact allowed origins; local defaults include http://localhost:5173 and dealer://app for the packaged desktop client |
| VITE_API_URL | Yes for deployment | Public API base URL baked into the web build |
| BOOTSTRAP_ADMIN_EMAIL | Optional | Email for creating the first administrator |
| BOOTSTRAP_ADMIN_PASSWORD | Optional | First administrator password, minimum 14 characters |
| DOCUMENT_STORAGE | No | Private file storage path inside the API container |

Keep .env out of version control. .env.example is only a template. Never put database credentials, JWT signing keys or private documents into frontend environment variables, source code, browser storage or public GitHub files.

## How the workflows work

### Listing states

- pending_review: newly submitted, visible to the owner and administrator review queue only.
- published: visible in public Discover and eligible for enquiries, messaging, favourites and deal proposals.
- changes_requested: the review team requires correction.
- rejected: not publicly visible.

Public queries always filter to published. Review decisions are stored with an actor, timestamp and optional note in the listing record and audit events.

### Private evidence

Supported uploads: PDF, JPEG, PNG and WebP, up to 8 MiB per file. Files are assigned server-generated IDs and written to the private private_documents volume. The metadata API removes the storage path before returning a response. Download requests require the caller to be the listing owner, uploader or a participant in a deal attached to the listing.

For a real launch, move file storage to managed object storage with private buckets, short-lived signed URLs or a controlled download service, encryption at rest, malware scanning, retention controls and documented deletion procedures. The local filesystem implementation is appropriate for integration development, not a substitute for a reviewed document-security programme.

### Conversations and leads

- Leads are separate records and can be viewing requests, questions or offers.
- Conversations are tied to one published listing and only their two participants can retrieve or send messages.
- The current UI displays conversation participant labels generically; a production contact directory and unread/read receipt system remain future work.

### Deals and commission terms

- A deal links a listing and two participants.
- The creator proposes a commission percentage (currently constrained to 0–15%) and descriptive text terms.
- Each party can acknowledge the in-app terms.
- Participants can advance the deal through proposed, viewing, offer, due_diligence, agreement, completed or cancelled. Stage changes append an activity record.
- The current app does not calculate a payable invoice, transfer funds, hold deposits or confirm legal completion. Payment handling must use a properly licensed provider and be reviewed against applicable Rwandan regulations.

## HTTP API reference

Base URL in Docker development: http://localhost:8080

JSON errors use an error field and an appropriate HTTP status. Protected endpoints expect an Authorization header with a Bearer session token and a JSON Content-Type for JSON requests.

### Health and discovery

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | /health | Public | API and MongoDB ping |
| GET | /api/v1/districts | Public | District catalogue |
| GET | /api/v1/listings | Public | Published property search; supports district, type, purpose, maxPrice, page and limit |
| GET | /api/v1/listings/:id | Public | Published property detail |
| GET | /api/v1/agents | Public | Approved agent directory; phone appears only with explicit consent |
| GET | /api/v1/trust/verify/:hash | Public | Check if a digest exists in the audit log |

Example listing search:

    Invoke-RestMethod "http://localhost:8080/api/v1/listings?purpose=sale&district=Gasabo&limit=12"

### Authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | /api/v1/auth/register | Public | Register an ordinary member |
| POST | /api/v1/auth/login | Public | Verify credentials and return token |
| GET | /api/v1/auth/me | Bearer | Return current profile |

Registration body:

    {
      "name": "Example Person",
      "email": "person@example.com",
      "password": "replace-with-a-unique-long-password",
      "phone": "+250..."
    }

### Listings and moderation

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | /api/v1/listings | Bearer | Submit a listing into pending_review |
| GET | /api/v1/me/listings | Bearer | Current user's listing submissions |
| GET | /api/v1/admin/listings/pending | Admin | Property review queue |
| GET | /api/v1/me/agent-profile | Bearer | Read the current user's latest agent application |
| POST | /api/v1/agents/apply | Bearer | Submit a profile for agent review |
| GET | /api/v1/admin/agents/pending | Admin | Agent application review queue |
| PATCH | /api/v1/admin/agents/:id/review | Admin | Approve, reject or request changes to an agent application |
| PATCH | /api/v1/admin/listings/:id/review | Admin | Approve, reject or request changes |

Listing submission body example:

    {
      "title": "Three-bedroom house with yard",
      "description": "Describe its condition, utilities, location and known limitations in detail.",
      "propertyType": "house",
      "purpose": "sale",
      "location": { "district": "Gasabo", "sector": "Kinyinya" },
      "price": { "amount": 185000000, "currency": "RWF", "period": "once" }
    }

Review request body:

    { "decision": "approve", "note": "Listing details reviewed; official ownership still requires independent verification." }

Valid decisions are approve, reject and request_changes.

### Saved properties, enquiries and conversations

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | /api/v1/me/favorites | Bearer | List saved listing IDs |
| PUT | /api/v1/favorites/:listingId | Bearer | Save a published listing |
| DELETE | /api/v1/favorites/:listingId | Bearer | Remove saved listing |
| POST | /api/v1/leads | Bearer | Create a viewing request, question or offer |
| GET | /api/v1/me/leads | Bearer | Leads where the user is requester or owner |
| GET | /api/v1/me/conversations | Bearer | Current user's conversations |
| POST | /api/v1/conversations | Bearer | Open or reuse the conversation for a listing |
| GET | /api/v1/conversations/:id/messages | Participant | Read a conversation |
| POST | /api/v1/conversations/:id/messages | Participant | Send a message |

Lead body example:

    {
      "listingId": "published-listing-publicId",
      "type": "viewing",
      "message": "Please let me know which afternoons are available.",
      "preferredAt": "2026-11-03T14:00"
    }

Allowed lead types are viewing, question and offer. Message body:

    { "text": "Hello. Could we arrange a viewing this week?" }

### Deal workspaces

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | /api/v1/me/deals | Participant | Read the current user's deals |
| POST | /api/v1/deals | Bearer | Propose a deal against a published listing |
| PATCH | /api/v1/deals/:id/stage | Participant | Record a milestone transition and note |
| POST | /api/v1/deals/:id/accept-fee | Participant | Record the current user's fee acknowledgement |

Create-deal body:

    {
      "listingId": "published-listing-publicId",
      "commissionPercent": 3,
      "commissionTerms": "The parties propose the fee and payment trigger described here in plain language."
    }

### Private property documents

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | /api/v1/listings/:listingId/documents | Listing owner | Upload an allowed file as Base64 JSON |
| GET | /api/v1/listings/:listingId/documents | Owner or deal participant | Read document metadata |
| GET | /api/v1/documents/:id/download | Owner, uploader or deal participant | Download document bytes |

Upload body expects fileName, contentType and base64. The client reads a file and converts it to Base64 before POSTing. Keep uploads small; the server caps the decoded file at 8 MiB and the request at about 11 MiB. A hash is returned for later checking.

## Data model

MongoDB collections created by the API:

| Collection | Core fields | Notes |
|---|---|---|
| users | publicId, name, email, passwordHash, role, status | BCrypt hash only; public registration creates member |
| listings | publicId, ownerId, title, location, price, status, verification | Only published is public |
| favorites | userId, listingId, createdAt | Account-linked shortlist |
| leads | listingId, requesterId, ownerId, type, status | Viewing/question/offer records |
| conversations | publicId, listingId, participants, updatedAt | Private per-listing threads |
| messages | conversationId, senderId, text, createdAt | Read/write authorization checks |
| deals | participants, commissionPercent, commissionTerms, feeAcceptedBy, stage, history | Application workflow and acknowledgement |
| documents | publicId, listingId, uploadedBy, fileName, contentType, sizeBytes, filePath | filePath is removed from API responses |
| agent_applications | publicId, userId, name, phone, showPhone, bio, districts, experienceYears, status | Human-reviewed agent profiles; public directory only includes approved profiles |
| audit_events | eventId, type, subjectId, actorId, evidenceHash, createdAt | Event trail and content digest lookup |

Database indexes and retention policies should be explicitly configured and tested before large-scale deployment. The current build does not promise that the audit collection is immutable against a database administrator.

## Development without Docker

These steps assume Dart SDK 3.x, Node.js 22+ and a reachable MongoDB database.

### Backend

PowerShell:

    cd backend
    dart pub get
    $env:API_PORT = "8080"
    $env:MONGO_URI = "mongodb://localhost:27017/dealer"
    $env:JWT_SECRET = "replace-with-a-long-random-secret"
    dart run bin/server.dart

If MongoDB enforces authentication, use a correctly URL-encoded credential URI. The server exits instead of running with fake in-memory data when MONGO_URI is not configured.

### Frontend

Open a second terminal:

    cd frontend
    npm install
    $env:VITE_API_URL = "http://localhost:8080"
    npm run dev

Vite will display the local development URL. In development the app is served with hot-module replacement and does not use the Nginx production container. VITE_API_URL is a public browser setting, not a secret.

### Build and static analysis

    # From frontend/
    npm run build

    # From backend/
    dart analyze

    # From repository root
    docker compose config
    docker compose up --build

Run these checks after each substantial change. The GitHub Actions workflow at .github/workflows/quality.yml runs the frontend production build and Dart static analysis on pushes and pull requests to main. Check the Actions tab for the actual result of the latest run; a committed workflow is not proof that a build passed.

## Checks and troubleshooting

**API health returns an error or the browser says API offline**
- Check docker compose ps and docker compose logs --tail 150 api.
- Ensure MongoDB is healthy and the API container can reach the mongo service.
- Confirm JWT_SECRET is set and MONGO_ROOT_PASSWORD matches the credentials used by the persistent Mongo volume.
- If you changed the root password after MongoDB was first initialized, updating .env alone does not update the existing database user's password.

**Frontend loads, but API calls fail**
- Confirm the browser can reach VITE_API_URL; localhost in a browser means the device running that browser, not the server container or a different computer.
- WEB_ORIGIN must match the actual web app origin exactly.
- After changing VITE_API_URL, rebuild the frontend: docker compose up --build -d frontend.

**Sign-up works but an admin cannot log in**
- Check BOOTSTRAP_ADMIN_EMAIL and the minimum 14-character BOOTSTRAP_ADMIN_PASSWORD.
- Bootstrap only creates an admin if the email does not exist. It does not promote or reset an existing account.
- Inspect API logs; do not enable public admin registration.

**A listing I submitted does not appear in Discover**
- This is the intended moderation flow. Confirm its status under My listings and review it with the administrator account.

**Evidence upload fails**
- Use PDF, JPEG, PNG or WebP under 8 MiB. Ensure the service can write to /data/private-documents.
- The current UI only exposes the upload control to the listing owner. For a real launch, add malware scanning and operational file-retention controls.

**A port is already in use**
- Change the host-side port mapping in docker-compose.yml (left side), then rebuild/restart. Keep the container port unchanged unless its configuration is also updated.

**Data must be reset**
- docker compose down -v removes named persistent volumes. Use only if intentionally deleting all local users, listings, deal records and private uploads.

## Security, privacy and legal boundaries

This project intentionally avoids several unsafe assumptions common in marketplace prototypes:

1. **Server-side access checks:** role and participant checks live in the Dart API, not only in hidden UI buttons.
2. **Password handling:** passwords are BCrypt-hashed. Passwords are never intentionally returned by the API.
3. **Short-lived bearer tokens:** the custom signed token expires after eight hours. There is no refresh-token or revocation list yet; sign-out clears this browser's token but does not revoke a stolen token.
4. **Private evidence:** file bytes are not served from a public static directory. The API removes storage paths from responses and authorizes downloads.
5. **Moderation boundary:** users cannot publish their own listing by setting a request field; public listing reads require server status published.
6. **Audit honesty:** SHA-256 records content equality and a platform event; it does not authenticate the source, prove ownership or imply blockchain consensus.
7. **Payment boundary:** the application records fee proposals and status changes; it does not hold funds or act as escrow.
8. **Official records:** confirm parcel UPI, registered owner, restrictions and transfer process through the National Land Authority/Irembo and qualified professionals.

Before a public launch, add HTTPS end-to-end, credential rate limits and lockout monitoring, email verification, password reset, optional MFA, refreshed/revocable sessions, server validation and size limits on every endpoint, structured logs with sensitive-value redaction, storage encryption, malware scanning, documented retention and deletion, secure database backups and restore drills, legal/privacy notices, incident response, accessibility testing, independent penetration testing, and verified payment integration where legally permitted.

## Roadmap before a public launch

- [ ] Add automated Dart unit and API integration tests using a disposable MongoDB database.
- [ ] Add frontend component tests, keyboard-navigation tests and responsive browser tests.
- [ ] Add API rate limits, account verification, password reset and revocable sessions.
- [ ] Extend agent onboarding with evidence-backed identity checks, professional references and auditable reviewer checklists before making any regulated qualification claims.
- [ ] Add signed contracts, consent versioning, downloadable receipts and dispute resolution designed with a legal professional.
- [ ] Add managed private object storage, antivirus/malware scanning, data retention and recovery procedures.
- [ ] Add real payment-provider integration only after reviewing applicable licensing and regulatory requirements; do not implement an unlicensed escrow.
- [ ] Extend CI with automated integration tests, browser tests and container vulnerability scanning; add observability, alerts, backups and restore drills.
- [ ] Complete a privacy impact assessment and threat model for property documents and private messages.
- [ ] Confirm product naming and trademark rights before marketing.
- [ ] If blockchain anchoring remains required, design an auditable chain adapter, publish the contract address and source verification process, and document what is anchored and what is deliberately not stored on-chain. Never publish personal documents or identifying data directly on-chain.

## Contributing

1. Create a feature branch.
2. Keep domain validation and authorization in the Dart API.
3. Keep API calls in frontend/src/api.ts rather than scattering untyped fetch calls through UI components.
4. Add tests and update this README when endpoints or environment variables change.
5. Never commit .env, secrets, database snapshots, user documents or private production logs.
6. Run npm run build, dart analyze and the Docker Compose checks before opening a pull request.

---

**Built for an accountable property journey in Rwanda. Verify the evidence, write the agreement, and use official channels for the legal transfer.**
