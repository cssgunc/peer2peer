# TDD: Peer2Peer

| **Author**         | Caleb Han                                                          |
| ------------------ | ------------------------------------------------------------------ |
| **Last Updated**   | Sep 30, 2026                                                       |
| **Status**         | Draft                                                              |
| **Reviewers**      | Mason Mines                                                        |
| **Relevant Links** | P/PS + Design: Peer2Peer · Peer2Peer Tech Spec · Prototype Site · Repo |

**Decision markers** (used throughout)

- `!!` Undetermined. Needs input from Peer2Peer
- `!?` Decided by CSSG, but confirm with Peer2Peer
- `??` Undecided. Engineering call, to be made by CSSG

---

## 1. Purpose

This document describes the technical design for the Peer2Peer platform: a mobile-first public website, an anonymous messaging line, and a responder portal for handling conversations. It turns the P/PS + Design into a data model, API, and set of component designs the team can build against.

Anonymity is the constraint every other decision is checked against. If a design choice makes the build easier but weakens anonymity, anonymity wins.

## 2. Context

See the Background and Problem Description sections of the P/PS + Design. The points that most shape this design:

- Responders must never see who they are talking to, and their access ends when their shift does
- Some identifying information may need to be stored for escalation, but only where responders can't reach it
- Content changes every semester and is edited by non-developers
- Peer2Peer needs usage numbers for funding, without analytics ever touching message content
- Independent hosting (not UNC), on a budget of a few hundred dollars a month at most
- The messaging channel (SMS or in-website chat) is not yet chosen

## 3. Goals & Non-Goals

### 3.1 Goals

Each goal has a measurable check that doubles as an acceptance criterion.

| # | Goal | Success check |
| - | ---- | ------------- |
| G1 | Anonymous messaging between a student and an on-shift responder | Responder-facing API responses contain no phone number, IP, or stable texter ID (enforced by tests on every portal DTO) |
| G2 | Channel-agnostic portal | Adding SMS after web chat requires a new channel adapter and webhook route only, with no changes to portal code or conversation tables |
| G3 | Mobile-first public site | Lighthouse mobile performance ≥ 90 and accessibility = 100 on every public page; WCAG 2.1 AA contrast |
| G4 | Coordinator-managed content | Hours, stats, resources, FAQs, and crisis numbers editable in the portal; changes are live on the public site within 60 seconds |
| G5 | Line and website analytics | Coordinators can see conversation counts, first-response time, conversation length, topic and outcome trends, and site traffic, with no message content in any analytics store |
| G6 | Data minimization | Message bodies are encrypted at rest and purged on the retention schedule; aggregate metrics survive the purge |
| G7 | Stay within budget | Infrastructure ≈ $20/month plus domain (web chat); SMS costs track the P/PS estimates |

### 3.2 Non-Goals

- Crisis intervention or clinical tooling. The platform points emergencies to 911, CAPS, and 988
- Writing the privacy policy, escalation protocol, or training. We build to what Peer2Peer and CAPS decide
- Native mobile apps
- Multiple concurrent responders at launch (the design supports it; the UI and assignment logic target one)
- UNC Onyen / SSO sign-in

---

## 4. Proposed Design

### 4.1 Target Users

**Student (texter)**
- UNC students and the general public, mostly on phones
- User goal: decide whether Peer2Peer fits, then start an anonymous conversation or find another resource
- No account. Identified to the system only by an anonymous session (web chat) or a hashed phone number (SMS)

**Responder**
- Trained peer responders, signed in for a shift
- User goal: see incoming conversations, reply, end conversations, and file the post-conversation form
- Can see only conversations assigned to them, only while on shift

**Coordinator**
- Peer2Peer leadership (e.g. Jada)
- User goal: manage responder accounts, edit site content, view analytics, and (if the privacy policy allows) open escalation records
- Has every responder permission plus the coordinator tools
- `!?` Whether coordinators also take shifts as responders. The design allows it

### 4.2 System Architecture

```
                    ┌─────────────────────────────── DigitalOcean App Platform ──────────────────────────────┐
                    │                                                                                         │
 Student (browser) ─┼──▶ Next.js frontend ──(server fetch / rewrites /api/*)──▶ FastAPI backend ──▶ Postgres  │
 Responder/Coord.  ─┼──▶   (public site + portal UI)                            │  REST + WebSocket   (managed)│
                    │                                                           │                             │
 Student (SMS) ─────┼──▶ Twilio ──(webhook, signed)────────────────────────────▶│                             │
                    │         ◀──(REST API, outbound SMS)─────────────────────────┘                             │
                    └─────────────────────────────────────────────────────────────────────────────────────────┘
                      Privacy-friendly web analytics (Plausible / Umami) ◀── page views only, no cookies
```

- **Frontend (Next.js 16, App Router):** serves the public site and the portal. Public pages are server-rendered and cached; content edits trigger on-demand revalidation
- **Backend (FastAPI):** the only thing that talks to the database. Owns auth, messaging, content, and analytics queries
- **Same-origin API:** the frontend proxies `/api/*` and `/ws/*` to the backend (Next.js rewrites or App Platform routing), so session cookies are first-party, `SameSite=Strict`, and there's no CORS surface
- **Channel adapters:** every inbound message, from any channel, is normalized into the same `Message` shape before the portal sees it (see 4.6.3)
- **Single backend instance at launch.** Real-time fan-out is in-process. If we ever run more than one instance, swap in Postgres `LISTEN/NOTIFY` behind the same interface (see 4.6.4)

### 4.3 Major Features

#### 4.3.1 Public Site

All public pages are mobile-first, meet WCAG 2.1 AA, and render the crisis-resources footer (911, CAPS 24/7, 988) from editable content.

**Home**
- Live status banner: "Responders are online" when at least one responder is on shift with a recent heartbeat; otherwise "Offline", the next open time from the hours schedule, and crisis resources (see 4.6.5)
- Tagline, what the line is and isn't, hours
- Primary CTAs: Start a conversation (→ Text Us) and Find resources
- How It Works steps with a sample conversation (content block)
- What Is Peer Support? (content block; `!!` stays on Home or moves to About)
- Impact statistics, hidden unless at least one statistic is published
- Launch countdown, shown while `line_launch_at` is set and in the future

**FAQ**
- "Is Peer2Peer right for me?" guide: two lists ("good fit" / "another resource is better"), each item editable
- Collapsible FAQ entries grouped by category
- `!!` Anonymity and safety answers are held as drafts until the privacy policy is final. Coordinators publish them

**Resources**
- National and UNC resources, filterable by tag (Crisis/Urgent, Ongoing Care, Peer & Community, Training)
- Client-side search over name, description, and tags (the list is small, so this needs no search backend)
- Each resource: name, description, link and/or phone, tags
- UNC resources stay unpublished until they agree to be listed (`is_published` flag)

**About Us**
- History, pillars and values, responder training. All content blocks

**Contact**
- Anonymous feedback form: one free-text field, no name or email, rate-limited, IP never stored (see 4.6.8)
- "Become a Peer Responder" button linking to the Google Form (URL is a site setting)
- Email (peer2peernc@unc.edu) and Instagram (@uncpeer2peer), both site settings

**Text Us**
- How to reach the line, repeated from Home, as a standalone page for flyers and QR codes
- Web chat: the chat window lives here (see 4.6.2)
- SMS: the phone number, with a `sms:` link on mobile
- Shows the same online/offline state as the banner

**Authentication (public):** none.

#### 4.3.2 Responder Portal

**Sign-in & shifts**
- Email + password. No public sign-up; coordinators create accounts
- After sign-in, a responder explicitly starts a shift. Only on-shift responders get assigned conversations and count toward "online"
- Ending the shift (or signing out, or idling out) ends access to all conversations
- Idle sign-out after `!?` 30 minutes without activity; the portal warns 2 minutes before

**Inbox**
- Queued and active conversations assigned to the responder, newest activity first
- Each conversation is labeled "Texter N", where N is a per-conversation counter. The label is **not** stable across conversations, so a responder can't recognize a returning texter
- Unread indicators and a new-conversation sound/notification (browser Notification API, opt-in)

**Conversation view**
- Full message history for the current conversation, live-updating over WebSocket
- Typing indicator (`??` nice-to-have)
- "End conversation" button. The texter can also end it; `!?` inactive conversations auto-close after 30 minutes
- Ended conversations leave the inbox once the post-conversation form is submitted
- Escalation protocol and resource guide open in a side panel at any time

**Post-conversation form**
- Required after every ended conversation before the responder can pick up a new one `!?`
- Topics (multi-select from a coordinator-managed list), outcome (single-select, coordinator-managed), confidence (1 to 5)
- No free-text fields

**Escalation**
- `!!` Entirely dependent on the CAPS protocol. The design reserves an `escalation` record, a coordinator-only view, and access logging (see 4.6.7). The responder-side action is a button that opens the protocol and creates the record

#### 4.3.3 Coordinator Tools

Everything a responder has, plus:

- **Accounts:** create, deactivate, reset password, change role. Deactivation immediately revokes all sessions
- **Content:** hours (weekly schedule + date exceptions), site settings, content blocks, FAQs, fit-guide items, resources and tags, statistics, crisis numbers, topics and outcomes for the post-conversation form
- **Analytics:** line dashboard (see 4.6.9) and a link to the web analytics dashboard
- **Feedback inbox:** read and delete anonymous feedback submissions
- **Escalation records:** `!!` view only if the privacy policy allows; every view writes an audit log entry
- **Audit log:** read-only list of sensitive actions

### 4.4 Tech Stack

The repo scaffold already pins the core stack. Additions are listed with their purpose.

**Backend**
- Framework: FastAPI (Python 3.14), REST + native WebSockets
- Database: PostgreSQL 18 (DigitalOcean Managed)
- ORM / migrations: SQLAlchemy 2.1, Alembic
- Password hashing: Argon2id via `pwdlib[argon2]`
- Field encryption: `cryptography` (AES-GCM) for message bodies and escalation data
- Rate limiting: small in-process limiter (`app/security/rate_limit.py`), no library. IPs stay in memory only; fine with a single instance (see 4.2)
- Scheduled jobs (retention purge, auto-close): `??` DigitalOcean scheduled job component vs. an in-process scheduler (APScheduler)
- SMS (only if chosen): `twilio` SDK
- Testing: pytest (+ httpx client, WebSocket test client)

**Frontend**
- Framework: Next.js 16 (App Router), React 19, TypeScript
- Styling: Tailwind CSS 4
- Components: `??` shadcn/ui (Radix primitives give us accessible accordions, dialogs, and tabs for free)
- Server state in portal: `??` TanStack Query
- Markdown rendering for content blocks: `react-markdown` (no raw HTML allowed)
- Charts for the analytics dashboard: `??` Recharts
- Testing: Vitest + Testing Library; `??` Playwright for a few end-to-end flows (chat round-trip, sign-in)

**Deploy**
- Containerization: Docker (dev container already in place)
- Host: DigitalOcean App Platform (frontend service + backend service) and Managed PostgreSQL, HTTPS included
- Backups: managed daily backups with 7-day point-in-time recovery
- Web analytics: `??` Plausible (hosted, ~$9/month) vs. Umami (self-hosted on the same DB, $0 extra). Both are cookieless
- Domain: `!!` reuse Peer2Peer's existing domain or register the .org from the quote

### 4.5 Data Model

Conventions: `id` is `UUID` (v7, time-ordered) unless noted, so IDs don't leak counts. All timestamps are `TIMESTAMPTZ` in UTC. Enums are Postgres enums managed through Alembic. Every table has `created_at`; mutable tables also have `updated_at`.

**Data classification.** Each table is tagged so reviewers can see where sensitive data lives.

| Tag | Meaning |
| --- | ------- |
| 🔴 Sensitive | Message content or anything that could identify a texter. Encrypted, retention-limited, never exported to analytics |
| 🟡 Internal | Staff data or conversation metadata. Portal-only |
| 🟢 Public | Site content served to anyone |

#### 4.5.1 Accounts & Access

**Account** 🟡
Responder and coordinator accounts.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| email | CITEXT | Unique; UNC email `!?` |
| display_name | VARCHAR(100) | Shown to other staff only, never to texters |
| password_hash | VARCHAR(255) | Argon2id |
| role | ENUM | `responder` \| `coordinator` |
| is_active | BOOLEAN | Deactivated accounts can't sign in |
| must_change_password | BOOLEAN | Set on creation and reset |
| last_login_at | TIMESTAMPTZ | Nullable |
| created_at / updated_at | TIMESTAMPTZ | |

**AuthSession** 🟡
Server-side sessions, so sign-out and deactivation revoke access immediately.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| account_id | UUID | FK → Account.id |
| token_hash | BYTEA | SHA-256 of the cookie token; the raw token is never stored |
| created_at | TIMESTAMPTZ | |
| last_seen_at | TIMESTAMPTZ | Drives idle timeout |
| expires_at | TIMESTAMPTZ | Absolute cap `!?` 12 hours |
| revoked_at | TIMESTAMPTZ | Nullable |

**Shift** 🟡
A responder's on-shift window. Drives assignment and the "online" banner.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| account_id | UUID | FK → Account.id |
| started_at | TIMESTAMPTZ | |
| last_heartbeat_at | TIMESTAMPTZ | Updated by the portal every 30s |
| ended_at | TIMESTAMPTZ | Nullable; null = on shift |
| ended_reason | ENUM | `manual` \| `signed_out` \| `idle` \| `heartbeat_lost` \| `deactivated` |

Partial unique index on `(account_id) WHERE ended_at IS NULL`: one open shift per account.

**AuditLog** 🟡
Append-only record of sensitive actions.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | BIGINT | PK, identity |
| actor_account_id | UUID | FK → Account.id; nullable for system actions |
| action | VARCHAR(100) | e.g. `account.create`, `account.deactivate`, `escalation.view`, `feedback.delete` |
| target_type | VARCHAR(50) | |
| target_id | UUID | Nullable |
| metadata | JSONB | Never contains message content or contact info |
| created_at | TIMESTAMPTZ | |

#### 4.5.2 Messaging

**Texter** 🔴
The pseudonymous identity behind a conversation. Lets a returning SMS texter or a reconnecting browser land in the same open conversation. Never exposed to responders.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| channel | ENUM | `web` \| `sms` |
| identity_hash | BYTEA | Unique per channel. Web: SHA-256 of the session token. SMS: HMAC-SHA256 of the E.164 number with a server secret. Raw phone numbers are never stored here |
| created_at | TIMESTAMPTZ | |
| last_seen_at | TIMESTAMPTZ | |

Texter rows are deleted by the retention job once they have no remaining conversations with messages.

**Conversation** 🟡
One conversation between a texter and (at most) one responder. Metadata survives the retention purge so analytics keep working.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| texter_id | UUID | FK → Texter.id; nullable, set to NULL on purge |
| channel | ENUM | `web` \| `sms` (copied so analytics survive purge) |
| label_number | INTEGER | The N in "Texter N". Per-day counter `!?`; not tied to the texter |
| status | ENUM | `queued` \| `active` \| `closed` |
| assigned_account_id | UUID | FK → Account.id; nullable while queued |
| opened_at | TIMESTAMPTZ | First inbound message |
| assigned_at | TIMESTAMPTZ | Nullable |
| first_response_at | TIMESTAMPTZ | Nullable; first responder message |
| closed_at | TIMESTAMPTZ | Nullable |
| closed_by | ENUM | `texter` \| `responder` \| `inactivity` \| `system` |
| opened_after_hours | BOOLEAN | Arrived while no one was on shift |
| message_count | INTEGER | Denormalized; survives purge |
| messages_purged_at | TIMESTAMPTZ | Nullable; set by the retention job |

**Message** 🔴
Individual messages. Bodies are encrypted at the application layer.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| conversation_id | UUID | FK → Conversation.id, `ON DELETE CASCADE` |
| sender | ENUM | `texter` \| `responder` \| `system` |
| sender_account_id | UUID | FK → Account.id; nullable (only for `responder`) |
| body_ciphertext | BYTEA | AES-GCM; nonce prepended |
| key_version | SMALLINT | Supports key rotation |
| provider_message_id | VARCHAR(64) | Nullable; Twilio SID for idempotency and delivery status |
| delivery_status | ENUM | `received` \| `sent` \| `delivered` \| `failed`; nullable for web |
| created_at | TIMESTAMPTZ | |

**ConversationReport** 🟡
The post-conversation form.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| conversation_id | UUID | FK → Conversation.id; unique |
| account_id | UUID | FK → Account.id; the responder who filed it |
| outcome_id | UUID | FK → ReportOption.id (kind = `outcome`) |
| confidence | SMALLINT | CHECK 1–5 |
| submitted_at | TIMESTAMPTZ | |

**ConversationReportTopic** 🟡
Many-to-many between reports and topics.

| Column | Type | Notes |
| ------ | ---- | ----- |
| report_id | UUID | FK → ConversationReport.id; composite PK |
| option_id | UUID | FK → ReportOption.id (kind = `topic`); composite PK |

**ReportOption** 🟡
Coordinator-managed choices for the form. Options are retired (not deleted) so historical reports stay valid.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| kind | ENUM | `topic` \| `outcome` |
| label | VARCHAR(100) | e.g. "Academic stress", "Referred to a resource" |
| display_order | INTEGER | |
| is_active | BOOLEAN | |

**Escalation** 🔴 `!!`
Placeholder shaped around the P/PS requirements; final fields depend on the CAPS protocol and privacy policy.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| conversation_id | UUID | FK → Conversation.id |
| created_by_account_id | UUID | FK → Account.id |
| status | ENUM | `open` \| `handed_off` \| `closed` `!!` |
| protected_payload | BYTEA | Encrypted with a **separate** key from messages. For SMS, may hold the phone number; `!!` what goes here is a policy decision |
| created_at / updated_at | TIMESTAMPTZ | |

Escalated conversations are exempt from the normal retention purge until the escalation is closed `!!`.

#### 4.5.3 Site Content

**SiteSetting** 🟢
Key-value store for single values. Values are JSONB and validated per key by a Pydantic schema, so a typo can't break the site.

| Column | Type | Notes |
| ------ | ---- | ----- |
| key | VARCHAR(100) | PK. e.g. `tagline`, `contact_email`, `instagram_handle`, `responder_form_url`, `sms_number`, `line_launch_at`, `timezone` |
| value | JSONB | |
| updated_by | UUID | FK → Account.id |
| updated_at | TIMESTAMPTZ | |

**WeeklyHours** 🟢
Recurring open hours. Multiple rows per day allowed (e.g. split shifts).

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| day_of_week | SMALLINT | 0 = Monday … 6 = Sunday |
| opens_at | TIME | Local time in `timezone` setting (America/New_York) |
| closes_at | TIME | May be earlier than `opens_at` for past-midnight windows |

**HoursException** 🟢
Holidays, breaks, and one-off changes.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| date | DATE | Unique |
| is_closed | BOOLEAN | |
| opens_at / closes_at | TIME | Nullable; used when not closed |
| note | VARCHAR(200) | e.g. "Closed for Fall Break" |

**ContentBlock** 🟢
Editable Markdown for prose sections (How It Works, What Is Peer Support?, About Us sections, etc.). Slugs are fixed in code; coordinators edit the body only.

| Column | Type | Notes |
| ------ | ---- | ----- |
| slug | VARCHAR(100) | PK. e.g. `home.how-it-works`, `about.history` |
| title | VARCHAR(200) | |
| body_md | TEXT | Markdown; rendered without raw HTML |
| updated_by | UUID | FK → Account.id |
| updated_at | TIMESTAMPTZ | |

**Faq** 🟢

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| category | VARCHAR(100) | e.g. "Anonymity", "Safety", "Hours" |
| question | VARCHAR(300) | |
| answer_md | TEXT | |
| display_order | INTEGER | |
| is_published | BOOLEAN | Drafts hidden from the public site |

**FitGuideItem** 🟢
Items in the "Is Peer2Peer right for me?" guide.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| fit | ENUM | `good_fit` \| `other_resource` |
| text | VARCHAR(300) | |
| resource_id | UUID | Nullable FK → Resource.id; link to the better resource |
| display_order | INTEGER | |

**Resource** 🟢

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| name | VARCHAR(200) | |
| description | VARCHAR(1000) | |
| url | VARCHAR(500) | Nullable |
| phone | VARCHAR(50) | Nullable |
| is_unc | BOOLEAN | UNC vs. national |
| is_crisis | BOOLEAN | Also shown in the site-wide crisis footer |
| is_published | BOOLEAN | UNC resources stay unpublished until they agree to be listed |
| display_order | INTEGER | |

**ResourceTag** 🟢 and **ResourceTagLink** 🟢
Tags (Crisis/Urgent, Ongoing Care, Peer & Community, Training) and their many-to-many link to resources.

| Table | Columns |
| ----- | ------- |
| ResourceTag | `id` UUID PK, `name` VARCHAR(100) unique, `display_order` INTEGER |
| ResourceTagLink | `resource_id` FK, `tag_id` FK; composite PK |

**Statistic** 🟢
Impact numbers on the homepage. Manually entered at first; later seeded from analytics.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| label | VARCHAR(200) | e.g. "Conversations this semester" |
| value | VARCHAR(50) | Display string, e.g. "120+" |
| display_order | INTEGER | |
| is_published | BOOLEAN | Impact section is hidden when nothing is published |

**FeedbackSubmission** 🔴
Anonymous feedback from the Contact page. Treated as sensitive because it is free text.

| Column | Type | Notes |
| ------ | ---- | ----- |
| id | UUID | PK |
| body | TEXT | Max 2,000 chars |
| created_at | TIMESTAMPTZ | Truncated to the day to reduce correlation with traffic logs |
| read_at | TIMESTAMPTZ | Nullable |

`!!` Retention for feedback.

#### 4.5.4 Relationships (summary)

```
Account 1─* AuthSession
Account 1─* Shift
Account 1─* Conversation (assigned)
Texter  1─* Conversation 1─* Message
Conversation 1─0..1 ConversationReport *─* ReportOption (topics)
ConversationReport *─1 ReportOption (outcome)
Conversation 1─* Escalation
Resource *─* ResourceTag
FitGuideItem *─0..1 Resource
```

### 4.6 Component Details

#### 4.6.1 Authentication & Sessions (staff)

- Email + password, Argon2id hashing. Passwords ≥ 12 characters, checked against a common-password list
- On sign-in, the backend creates an `AuthSession` and sets an opaque token cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`
- Every authenticated request checks: session not revoked, not expired, `last_seen_at` within the idle window, account active. Then it bumps `last_seen_at` (throttled to once a minute)
- Idle timeout closes the session **and** the open shift
- Deactivating an account revokes all its sessions and ends its shift in the same transaction
- Sign-in is rate-limited per email and per IP (IP held in memory only, never persisted)
- CSRF: `SameSite=Strict` plus same-origin API. `!?` Add a double-submit token for state-changing routes as defense in depth
- Role checks via FastAPI dependencies: `require_staff`, `require_on_shift`, `require_coordinator`
- `??` MFA (TOTP) for coordinators. Recommended given escalation access; could be a stretch goal

Why server-side sessions instead of JWTs: the requirement that access ends when a shift ends (or an account is deactivated) needs instant revocation, which JWTs don't give without a denylist.

#### 4.6.2 Texter Session (web chat)

- When a student opens the chat, `POST /api/chat/sessions` creates a random 256-bit token. The backend stores only its hash (`Texter.identity_hash`) and returns the token
- The token lives in `sessionStorage` `!?`, so closing the tab ends the texter's identity. This protects students on shared or borrowed devices. Tradeoff: a student who closes the tab can't come back to the same conversation
- The token authenticates the WebSocket and the REST fallback. It grants access to that texter's current conversation only
- Before the first message, the chat shows a short notice: what Peer2Peer is and isn't, crisis numbers, and a link to the privacy policy `!!`
- "End conversation" on the texter side closes the conversation and clears the token
- Abuse controls: per-token and per-IP (in-memory) rate limits; `??` Cloudflare Turnstile on session creation if spam becomes a problem (it's cookieless, but adds a third party)

#### 4.6.3 Messaging Pipeline & Channel Adapters

All channels feed one pipeline:

```
inbound (web WS / Twilio webhook)
   → ChannelAdapter.parse_inbound()        # → (identity_hash, body, provider_id)
   → find_or_create Texter
   → find open Conversation or open a new one (→ assignment, 4.6.6)
   → encrypt + store Message
   → publish event to assigned responder's portal socket
   → if after hours / no responder: send auto-reply (4.6.5)

outbound (responder sends)
   → store Message → ChannelAdapter.send()  # web: push over texter WS; sms: Twilio REST
```

- `ChannelAdapter` is a small Python protocol with `parse_inbound`, `send`, and `handle_status_callback`. `WebChatAdapter` ships first; `TwilioSmsAdapter` is added only if SMS is chosen
- **SMS specifics (if chosen):**
  - Inbound webhook `POST /api/webhooks/twilio/sms` verifies `X-Twilio-Signature` and rejects anything unsigned
  - The phone number is HMAC'd immediately. The raw number exists only in request memory and in the outbound send call. For outbound, the adapter needs the number, so `!!` either (a) store it encrypted in a separate `SmsContact` table readable only by the adapter, or (b) use Twilio Conversations so Twilio holds the mapping. This is the core SMS privacy decision
  - Idempotency on `provider_message_id` (Twilio retries webhooks)
  - STOP/HELP keywords handled by Twilio Advanced Opt-Out
  - Twilio's own message log retention: `!?` set to the shortest Twilio allows, and document it in the privacy policy
- Messages are capped at 2,000 characters (web) to bound storage and abuse

#### 4.6.4 Real-Time Updates

- **Portal ↔ backend:** one WebSocket per portal tab (`/ws/portal`), authenticated by the session cookie. Server pushes `conversation.created`, `conversation.updated`, `message.created`, `shift.ended`. Client sends heartbeats every 30s (these also drive `Shift.last_heartbeat_at`)
- **Texter ↔ backend:** one WebSocket per chat (`/ws/chat`), authenticated by the texter token. Server pushes `message.created`, `conversation.closed`, `status.changed`
- **Fallback:** if a socket drops, the client reconnects with backoff and fetches missed messages via REST (`?after=<message_id>`), so no message is lost
- **Fan-out:** an in-process `EventBus` interface. At launch this is a dict of connected sockets. `??` If we scale past one backend instance, implement the same interface on Postgres `LISTEN/NOTIFY` instead of adding Redis
- **Status banner:** public, so no socket. `GET /api/status` is cached for 15 seconds at the edge and polled by the page every 30 seconds

#### 4.6.5 Hours, Online Status & After-Hours Replies

- `is_online` = at least one open `Shift` with `last_heartbeat_at` within 90 seconds. Posted hours never make the site say "online" by themselves (the P/PS suggestion)
- `next_open_at` is computed from `WeeklyHours` + `HoursException` in `America/New_York`
- A shift whose heartbeat stops for 5 minutes is closed with `heartbeat_lost`, and its active conversations go back to the queue
- **After-hours / no-responder auto-reply:** when a message opens a conversation and `is_online` is false, the system replies once with the next open time and crisis resources. The conversation is created with `opened_after_hours = true`
- `!!` What happens to after-hours conversations: stay queued until the next shift, or auto-close with the auto-reply. Recommendation: auto-close. A student who wrote at 3am shouldn't get a reply 10 hours later with no context, and a queued message from someone in distress would sit for hours with no one watching

#### 4.6.6 Conversation Assignment

- On a new conversation, pick the on-shift responder with the fewest active conversations (ties → longest since last assignment). With one responder, that's just them
- If no responder is available, the conversation is `queued` (or auto-closed, per 4.6.5)
- When a shift starts, queued conversations are assigned in `opened_at` order
- Assignment runs in a transaction with `SELECT … FOR UPDATE SKIP LOCKED` on queued conversations, so it stays correct once there are multiple responders
- `??` Per-responder cap on concurrent conversations (setting, default 3)

#### 4.6.7 Privacy, Encryption & Retention

**What responders can see.** Portal DTOs contain only: conversation ID, "Texter N" label, channel, timestamps, status, and message bodies. Never `texter_id`, identity hashes, phone numbers, or IPs. A test asserts this against every portal response schema.

**Encryption at rest**
- DigitalOcean Managed Postgres encrypts disks
- On top of that, message bodies are encrypted in the application with AES-GCM using `MESSAGE_KEY` (env var, 256-bit). Escalation payloads use a separate `ESCALATION_KEY`
- `key_version` on each row allows rotation without re-encrypting everything at once
- This means a leaked database backup doesn't expose message content, and deleting a key crypto-shreds everything encrypted with it

**Retention** `!!` (period set by the privacy policy)
- A daily job:
  1. deletes `Message` rows for conversations closed more than N days ago (except open escalations)
  2. sets `Conversation.texter_id = NULL` and `messages_purged_at = now()`
  3. deletes orphaned `Texter` rows
  4. deletes expired `AuthSession` rows
- Conversation metadata and reports stay, so analytics keep working after content is gone

**Logging**
- Uvicorn access logs are disabled; the app logs its own request lines without IP, query string, or body
- `??` DigitalOcean App Platform's edge may log client IPs. Confirm what's retained and for how long, and put that in the privacy policy
- Error tracking (if added) scrubs request bodies and headers
- A `pytest` check fails if any log record during the test suite contains a message body

**Escalation access** `!!`
- Coordinator-only route; every read writes an `AuditLog` entry with the actor and escalation ID
- Protected payload decrypted only in that route

#### 4.6.8 Content Management

- Coordinator edits go through `/api/admin/*`, validated by Pydantic
- After each save, the backend calls a Next.js revalidation route (`POST /api/revalidate`, shared secret) with the affected cache tags (`hours`, `resources`, `faqs`, etc.). Public pages are otherwise statically cached, which keeps them fast and cheap
- Markdown fields render with `react-markdown` and no raw HTML, so content edits can't inject scripts
- Content editor UI: plain forms with a Markdown text area and live preview. `??` A richer editor (e.g. TipTap) is a stretch goal

#### 4.6.9 Analytics

**Line analytics** (coordinator dashboard, computed from our own tables)
- Conversations per day/week/semester, by channel
- Median and p90 time to first response (`first_response_at - opened_at`)
- Median conversation length (`closed_at - opened_at`) and message count
- After-hours attempts (demand outside open hours, useful for justifying more hours)
- Topic and outcome distributions, confidence averages, from `ConversationReport`
- Queries are plain SQL aggregates. `??` Add a materialized daily rollup if they get slow (unlikely at expected volume)
- Small-number suppression `!?`: hide any breakdown bucket with fewer than 5 conversations in a period, so rare topics in a small window can't point to a specific conversation
- CSV export of aggregates for grant reports

**Website analytics**
- `??` Plausible vs. self-hosted Umami. Both are cookieless, don't track individuals, and give unique visitors, sources, and session length
- Excluded paths: the chat page's message events and all `/portal/*` routes
- No analytics script loads inside the portal or chat window

### 4.7 API Model

All routes are under `/api`. JSON in and out. Errors use `{ "detail": string, "code": string }`. Timestamps are ISO 8601 UTC.

#### 4.7.1 DTOs

Grouped by audience. Create and Update DTOs share fields unless noted; Update DTOs make every field optional (PATCH semantics).

**Public output**

- **StatusDTO**: `is_online: bool`, `next_open_at: datetime | null`, `line_launched: bool`, `line_launch_at: datetime | null`
- **HoursDTO**: `timezone: str`, `weekly: List[{day_of_week: int, opens_at: time, closes_at: time}]`, `exceptions: List[{date, is_closed, opens_at, closes_at, note}]` (next 60 days)
- **SiteSettingsDTO**: `tagline`, `contact_email`, `instagram_handle`, `responder_form_url`, `sms_number: str | null`, `channels: List["web" | "sms"]`
- **ContentBlockDTO**: `slug`, `title`, `body_md`, `updated_at`
- **FaqDTO**: `id`, `category`, `question`, `answer_md`
- **FitGuideDTO**: `good_fit: List[FitGuideItemDTO]`, `other_resource: List[FitGuideItemDTO]`
- **FitGuideItemDTO**: `id`, `text`, `resource_id: uuid | null`
- **ResourceDTO**: `id`, `name`, `description`, `url | null`, `phone | null`, `is_unc`, `is_crisis`, `tags: List[str]`
- **StatisticDTO**: `id`, `label`, `value`

**Texter (web chat)**

- **ChatSessionDTO**: `token: str`, `conversation_id: uuid | null`
- **ChatMessageDTO**: `id`, `sender: "texter" | "responder" | "system"`, `body`, `created_at`
- **ChatConversationDTO**: `id`, `status`, `messages: List[ChatMessageDTO]`

Note: `ChatMessageDTO` never includes the responder's name.

**Portal (responder)**

- **MeDTO**: `id`, `email`, `display_name`, `role`, `must_change_password`, `shift: ShiftDTO | null`
- **ShiftDTO**: `id`, `started_at`
- **InboxItemDTO**: `conversation_id`, `label: str` ("Texter 14"), `channel`, `status`, `opened_at`, `last_message_at`, `unread_count`, `needs_report: bool`
- **PortalMessageDTO**: `id`, `sender`, `body`, `created_at`, `delivery_status | null`
- **PortalConversationDTO**: `conversation_id`, `label`, `channel`, `status`, `opened_at`, `closed_at | null`, `messages: List[PortalMessageDTO]`
- **ReportOptionsDTO**: `topics: List[{id, label}]`, `outcomes: List[{id, label}]`

**Coordinator**

- **AccountDTO**: `id`, `email`, `display_name`, `role`, `is_active`, `last_login_at`, `on_shift: bool`
- **LineAnalyticsDTO**: `range: {start, end}`, `conversations_total`, `by_channel: dict`, `first_response_seconds: {median, p90}`, `duration_seconds: {median}`, `after_hours_attempts`, `topics: List[{label, count}]`, `outcomes: List[{label, count}]`, `confidence_avg`, `series: List[{date, conversations}]`
- **FeedbackDTO**: `id`, `body`, `created_on: date`, `read: bool`
- **AuditLogDTO**: `id`, `actor_display_name | null`, `action`, `target_type`, `target_id`, `created_at`
- **EscalationDTO** `!!`: shape pending protocol

**Input**

- **SignInDTO**: `email`, `password`
- **ChangePasswordDTO**: `current_password`, `new_password`
- **SendMessageDTO**: `body: str` (1–2,000 chars)
- **SubmitReportDTO**: `topic_ids: List[uuid]` (≥ 1), `outcome_id: uuid`, `confidence: int` (1–5)
- **CreateAccountDTO**: `email`, `display_name`, `role`. The server generates a temporary password `!?` or sends an invite link (needs an email provider, see open questions)
- **UpdateAccountDTO**: `display_name?`, `role?`, `is_active?`
- **UpdateHoursDTO**: `weekly: List[{day_of_week, opens_at, closes_at}]` (replaces the full schedule)
- **HoursExceptionInputDTO**: `date`, `is_closed`, `opens_at?`, `closes_at?`, `note?`
- **UpdateSiteSettingDTO**: `value: Any` (validated per key)
- **UpdateContentBlockDTO**: `title`, `body_md`
- **FaqInputDTO**: `category`, `question`, `answer_md`, `display_order`, `is_published`
- **FitGuideItemInputDTO**: `fit`, `text`, `resource_id?`, `display_order`
- **ResourceInputDTO**: `name`, `description`, `url?`, `phone?`, `is_unc`, `is_crisis`, `is_published`, `display_order`, `tag_ids: List[uuid]`
- **ResourceTagInputDTO**: `name`, `display_order`
- **StatisticInputDTO**: `label`, `value`, `display_order`, `is_published`
- **ReportOptionInputDTO**: `kind`, `label`, `display_order`, `is_active`
- **ReorderDTO**: `ids: List[uuid]` (used by every orderable collection)
- **FeedbackInputDTO**: `body: str` (1–2,000 chars)

#### 4.7.2 Public Routes (no auth)

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| GET | /api/status | None | StatusDTO | Edge-cached 15s |
| GET | /api/hours | None | HoursDTO | |
| GET | /api/settings | None | SiteSettingsDTO | Public keys only |
| GET | /api/content/:slug | None | ContentBlockDTO | |
| GET | /api/faqs | None | List[FaqDTO] | Published only |
| GET | /api/fit-guide | None | FitGuideDTO | |
| GET | /api/resources | Query: tag, unc | List[ResourceDTO] | Published only; search is client-side |
| GET | /api/resource-tags | None | List[ResourceTagDTO] | |
| GET | /api/statistics | None | List[StatisticDTO] | Published only |
| POST | /api/feedback | FeedbackInputDTO | 204 | Rate-limited; no IP stored |

#### 4.7.3 Texter Routes (texter token)

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| POST | /api/chat/sessions | None | ChatSessionDTO | Rate-limited; `??` Turnstile |
| GET | /api/chat/conversation | Query: after | ChatConversationDTO | Current conversation; reconnect catch-up |
| POST | /api/chat/messages | SendMessageDTO | ChatMessageDTO | REST fallback; WS is primary |
| POST | /api/chat/conversation/end | None | 204 | Closes conversation, invalidates token |
| WS | /ws/chat | Token in first frame | events | See 4.6.4 |

Token is sent as `Authorization: Bearer <token>` (REST) or the first WebSocket frame, never in a URL, so it can't end up in logs.

#### 4.7.4 Channel Webhooks

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| POST | /api/webhooks/twilio/sms | Twilio form payload | TwiML (empty) | Signature-verified; only if SMS is chosen |
| POST | /api/webhooks/twilio/status | Twilio form payload | 204 | Delivery status updates |

#### 4.7.5 Portal Routes (staff session)

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| POST | /api/auth/sign-in | SignInDTO | MeDTO | Sets session cookie; rate-limited |
| POST | /api/auth/sign-out | None | 204 | Revokes session, ends shift |
| GET | /api/auth/me | None | MeDTO | |
| POST | /api/auth/password | ChangePasswordDTO | 204 | Revokes other sessions |
| POST | /api/portal/shift/start | None | ShiftDTO | Triggers assignment of queued conversations |
| POST | /api/portal/shift/end | None | 204 | Requeues active conversations `!?` |
| GET | /api/portal/inbox | None | List[InboxItemDTO] | On shift only |
| GET | /api/portal/conversations/:id | Query: after | PortalConversationDTO | Assigned responder only |
| POST | /api/portal/conversations/:id/messages | SendMessageDTO | PortalMessageDTO | |
| POST | /api/portal/conversations/:id/end | None | 204 | |
| POST | /api/portal/conversations/:id/read | None | 204 | Clears unread |
| GET | /api/portal/report-options | None | ReportOptionsDTO | Active options only |
| POST | /api/portal/conversations/:id/report | SubmitReportDTO | 201 | Once per conversation |
| POST | /api/portal/conversations/:id/escalate | `!!` | `!!` | Creates Escalation; shape pending protocol |
| GET | /api/portal/guide | None | ContentBlockDTO | Escalation protocol + resource guide (`portal.guide` block) |
| WS | /ws/portal | Session cookie | events | See 4.6.4 |

"Assigned responder only" means a 404 (not 403) for any other conversation, so IDs can't be probed.

#### 4.7.6 Coordinator Routes (coordinator session)

All routes below require `role = coordinator`. Every write is audit-logged.

**Accounts**

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| GET | /api/admin/accounts | Query: role, is_active | List[AccountDTO] | |
| POST | /api/admin/accounts | CreateAccountDTO | AccountDTO + temp password | `!?` invite flow instead |
| PATCH | /api/admin/accounts/:id | UpdateAccountDTO | AccountDTO | Deactivation revokes sessions + ends shift |
| POST | /api/admin/accounts/:id/reset-password | None | temp password | |

No DELETE: accounts are deactivated so reports keep their author.

**Content** (same pattern for each collection)

| Method | Route | Input | Output |
| ------ | ----- | ----- | ------ |
| PUT | /api/admin/hours | UpdateHoursDTO | HoursDTO |
| POST / PATCH / DELETE | /api/admin/hours/exceptions[/:id] | HoursExceptionInputDTO | HoursExceptionDTO |
| GET / PUT | /api/admin/settings[/:key] | UpdateSiteSettingDTO | SiteSettingsDTO (all keys) |
| GET / PUT | /api/admin/content[/:slug] | UpdateContentBlockDTO | ContentBlockDTO |
| GET / POST / PATCH / DELETE | /api/admin/faqs[/:id] | FaqInputDTO | FaqDTO (incl. drafts) |
| GET / POST / PATCH / DELETE | /api/admin/fit-guide[/:id] | FitGuideItemInputDTO | FitGuideItemDTO |
| GET / POST / PATCH / DELETE | /api/admin/resources[/:id] | ResourceInputDTO | ResourceDTO (incl. unpublished) |
| GET / POST / PATCH / DELETE | /api/admin/resource-tags[/:id] | ResourceTagInputDTO | ResourceTagDTO |
| GET / POST / PATCH / DELETE | /api/admin/statistics[/:id] | StatisticInputDTO | StatisticDTO |
| GET / POST / PATCH | /api/admin/report-options[/:id] | ReportOptionInputDTO | ReportOptionDTO (retire via `is_active`) |
| PUT | /api/admin/:collection/reorder | ReorderDTO | List[…] |

**Analytics, feedback, audit, escalation**

| Method | Route | Input | Output | Notes |
| ------ | ----- | ----- | ------ | ----- |
| GET | /api/admin/analytics/line | Query: start, end, channel | LineAnalyticsDTO | Small-number suppression applied |
| GET | /api/admin/analytics/line.csv | Query: start, end | CSV | Aggregates only |
| GET | /api/admin/feedback | Query: unread | List[FeedbackDTO] | |
| PATCH | /api/admin/feedback/:id | `{ read: bool }` | FeedbackDTO | |
| DELETE | /api/admin/feedback/:id | None | 204 | |
| GET | /api/admin/audit-log | Query: action, actor, page | Paginated List[AuditLogDTO] | |
| GET | /api/admin/escalations[/:id] | None | EscalationDTO | `!!`; every read logged |

### 4.8 Frontend Structure

```
src/app/
  (public)/
    page.tsx                 Home
    faq/page.tsx
    resources/page.tsx
    about/page.tsx
    contact/page.tsx
    text-us/page.tsx         Chat window (web) or SMS instructions
  portal/
    sign-in/page.tsx
    page.tsx                 Inbox + conversation (split view on desktop, stacked on mobile)
    guide/page.tsx
    admin/                   Coordinator only
      accounts/ content/ hours/ resources/ faqs/ analytics/ feedback/ audit/
  api/revalidate/route.ts    On-demand revalidation hook
src/components/
  layout/ (Header, Footer with CrisisResources, StatusBanner)
  chat/ (ChatWindow, MessageList, Composer)
  portal/ (Inbox, ConversationView, ReportForm, ShiftToggle, IdleWarning)
  content/ (Markdown, FaqAccordion, ResourceFilter, FitGuide, Countdown)
src/lib/
  api.ts                     Typed fetch client
  ws.ts                      Reconnecting WebSocket with catch-up
```

- `??` Generate TypeScript types from FastAPI's OpenAPI schema (`openapi-typescript`) so DTOs stay in sync
- Portal routes are protected by a Next.js middleware check on the session cookie plus the backend's own checks (the backend is the source of truth)
- The `/text-us` and `/portal` routes set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`

### 4.9 Security

| Threat | Mitigation |
| ------ | ---------- |
| Responder learns texter identity | No identifiers in portal DTOs (tested); per-conversation labels; phone numbers HMAC'd |
| Former responder retains access | Server-side sessions; deactivation and shift end revoke immediately |
| Stolen DB backup | App-level encryption of message bodies and escalation data; keys only in env |
| Shared-device exposure (student) | Texter token in `sessionStorage`; "End conversation" clears it; no-store caching |
| XSS via content or messages | React escaping; Markdown without raw HTML; strict CSP |
| CSRF on portal | `SameSite=Strict` cookies, same-origin API, `!?` double-submit token |
| Spam / flooding the line | Rate limits on session creation, messages, feedback; `??` Turnstile |
| Forged SMS webhooks | Twilio signature verification |
| IDOR on conversations | Scoped queries by assigned responder; 404 on mismatch |
| Brute-force sign-in | Rate limits + Argon2id; `??` coordinator MFA |
| Sensitive data in logs | No access logs with IPs; log-scrubbing test |

Security headers on every response: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin` (portal and chat: `no-referrer`), `Permissions-Policy`.

### 4.10 Testing Strategy

- **Backend unit/integration (pytest):** every route, role checks, assignment logic, hours/next-open computation (including DST changes and past-midnight windows), retention job, encryption round-trip, Twilio signature verification
- **Anonymity tests:** a parametrized test walks every portal and texter response model and fails if it contains fields like `texter_id`, `identity_hash`, `phone`, or `ip`; a logging test fails if message bodies appear in logs
- **WebSocket tests:** FastAPI test client for message round-trip, reconnect catch-up, and shift-end disconnect
- **Frontend (Vitest + Testing Library):** components, filters, countdown, chat reducer
- **End-to-end (`??` Playwright):** student sends a message → responder receives it → reply → end → report submitted
- **Accessibility:** `axe` checks in component tests; Lighthouse CI on public pages
- CI (already in repo): lint, typecheck, tests, `alembic check`

### 4.11 Deployment & Operations

- **Environments:** local (dev container), `??` staging (a second, smaller App Platform app for Peer2Peer to review), production
- **Secrets** (App Platform env vars): `DATABASE_URL`, `MESSAGE_KEY`, `ESCALATION_KEY`, `IDENTITY_HMAC_KEY`, `REVALIDATE_SECRET`, Twilio credentials (if SMS)
- **Migrations** run as a pre-deploy job
- **Backups:** managed daily + 7-day PITR. Note: backups contain encrypted message bodies, which expire with the retention window plus 7 days
- **Monitoring:** App Platform health checks on `/api/health`; `??` uptime alert (free tier of an uptime service) to the Peer2Peer email, since a silent outage during a shift is the worst failure mode
- **Handoff:** `!!` who owns the platform after Spring 2027. The design favors managed services and few moving parts to keep that burden small

---

## 5. Milestones

Development is complete by the end of Fall 2026. Spring 2027 is for testing, the soft launch, and launch. Dates are proposals and still need to be checked against the CSSG showcase date and the UNC academic calendar.

### 5.1 Fall 2026: Development

| Phase | Scope | Target |
| ----- | ----- | ------ |
| 1a: Foundation | Repo, CI, dev container (done); accounts, sessions, and roles; content tables and coordinator CRUD API; deploy pipeline to DigitalOcean (production + `??` staging); visual design tokens (logo colors, contrast-checked) | Oct 1 – Oct 18 |
| 1b: Public site | All public pages; coordinator content editing UI; crisis footer; status banner (hours-based until 1c); launch countdown; web analytics; feedback form | Oct 19 – Nov 8 |
| 1c: Line & portal | Web chat adapter; messaging pipeline and WebSockets; shifts, heartbeats, and live status; assignment; after-hours auto-reply; post-conversation form; guide panel; line analytics dashboard; retention job; escalation scaffolding (model, button, audit logging) | Nov 9 – Dec 6 (includes Thanksgiving break) |
| Dev complete | Feature freeze. Everything in scope runs end to end on staging, with placeholder values wherever a Peer2Peer policy decision is still open | Dec 7 (last day of classes) |

- The public site can go live with the countdown once 1b ships and Peer2Peer's final copy is in `!?` (depends on the P/PS open decision about launching the site before the line)
- Policy-dependent pieces (retention period, escalation behavior, anonymity/safety FAQ copy) are built as settings, placeholders, or drafts in Fall, so Spring only has to fill in values, not write new features

### 5.2 Spring 2027: Testing & Launch

| Phase | Scope | Target |
| ----- | ----- | ------ |
| 2a: Integration & testing | Apply the final privacy policy and CAPS escalation protocol; end-to-end tests; accessibility audit (WCAG 2.1 AA); security review; load test of the chat path; responder dry runs on staging during training | Jan 12 – Feb 7 |
| 2b: Soft launch | Trial with a small group (e.g. partner mental health organizations); fix issues; confirm real costs; decide whether to add SMS | Feb 8 – Mar 21 (includes spring break) |
| 2c: Launch prep | Final fixes and copy; coordinator training on content editing and analytics; handoff docs and runbook | Mar 22 – Apr 4 |
| Launch | Open to all UNC students | `!?` Early–mid April 2027, leaving several weeks of real usage with CSSG support before the semester ends |

### 5.3 Schedule Dependencies

These are the dates by which a Peer2Peer decision has to land to keep the schedule. Each maps to a row in Section 6.

| Needed by | Decision | Why |
| --------- | -------- | --- |
| Oct 18 | Domain (#7) | Production deploy and HTTPS |
| Nov 8 | SMS or in-website chat (#1) | 1c builds the chosen channel adapter. If SMS, Twilio A2P registration takes weeks and must start now |
| Nov 8 | After-hours behavior (#5) | Built in 1c |
| Nov 8 | Final site copy | Public site goes live with the countdown |
| Jan 12 | Privacy policy and retention (#2), escalation protocol (#3), open hours (#6) | 2a applies them before anyone outside CSSG uses the line |
| Feb 7 | Soft launch group confirmed | 2b starts |
| Mar 21 | Post-launch maintenance owner (#8) | Handoff docs in 2c are written for that person |

## 6. Open Questions

| # | Question | Marker | Owner | Blocks |
| - | -------- | ------ | ----- | ------ |
| 1 | SMS or in-website chat | `!!` | Peer2Peer | Channel adapter, Text Us page, 4.6.3 |
| 2 | Retention period for messages, feedback, and escalations | `!!` | Peer2Peer (privacy policy) | 4.6.7, FAQ copy |
| 3 | Escalation protocol: what is stored, who is contacted, how hand-off works | `!!` | Peer2Peer + CAPS | Escalation model and routes |
| 4 | SMS only: store encrypted phone numbers ourselves, or let Twilio Conversations hold them | `!!` | Peer2Peer + CSSG | 4.6.3 |
| 5 | After-hours messages: auto-close vs. queue until next shift | `!!` | Peer2Peer | 4.6.5 |
| 6 | Open hours | `!!` | Peer2Peer | Hours seed data |
| 7 | Domain: existing or new .org | `!!` | Peer2Peer | Deploy |
| 8 | Who maintains the platform after Spring 2027 | `!!` | Peer2Peer + CSSG | Handoff docs |
| 9 | Idle timeout (30 min) and inactive-conversation auto-close (30 min) | `!?` | Peer2Peer | Settings defaults |
| 10 | Post-conversation form required before next conversation | `!?` | Peer2Peer | Portal UX |
| 11 | Texter token in `sessionStorage` (closing tab ends conversation) | `!?` | Peer2Peer | 4.6.2 |
| 12 | Account creation: temp password vs. email invite (needs an email provider) | `!?` | CSSG | 4.7.6 |
| 13 | Small-number suppression threshold for analytics (5) | `!?` | Peer2Peer | 4.6.9 |
| 14 | Plausible vs. Umami | `??` | CSSG | 4.6.9, budget |
| 15 | shadcn/ui, TanStack Query, Recharts, Playwright | `??` | CSSG | Frontend setup |
| 16 | Scheduled jobs: App Platform job vs. in-process scheduler | `??` | CSSG | Retention, auto-close |
| 17 | Coordinator MFA at launch or stretch | `??` | CSSG | 4.6.1 |
| 18 | Turnstile on chat session creation | `??` | CSSG | 4.6.2 |
| 19 | Staging environment (extra ~$20/month) | `??` | CSSG + Peer2Peer | 4.11 |

## 7. Stretch Goals

- Post-chat survey for students (one or two optional questions after the conversation ends)
- Multiple concurrent responders with a shared queue view and transfers between responders
- Second messaging channel (e.g. SMS after launching with web chat); the adapter design makes this incremental
- Coordinator MFA (if not in launch scope)
- Site-wide search across FAQs, resources, and content blocks
- Rich-text content editor
- Canned responses / quick-reply snippets for responders (coordinator-managed)
- Responder shift scheduling view (who's covering which hours)
- Automatic impact statistics on the homepage from line analytics, with coordinator approval before publishing
