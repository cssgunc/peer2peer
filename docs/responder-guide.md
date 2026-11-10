# Responder guide

Issue [#122](https://github.com/cssgunc/peer2peer/issues/122) adds two ways for staff to read the escalation protocol and resource guide: the `/portal/guide` page and a Guide button in the portal top bar. The button opens a right-side panel without navigating or unmounting the current page, so a conversation draft stays in place. The panel fills mobile screens and keeps its Close button visible while the content scrolls. Escape closes the panel and returns focus to Guide.

## API and content

`GET /api/portal/guide` requires a valid staff session through `require_staff`. Both responders and coordinators can access it without starting a shift. Missing, invalid, or expired sessions receive a 401 response.

The route returns the `portal.guide` content block as `ContentBlockDTO`: `slug`, `title`, `body_md`, and `updated_at`. It uses the existing `get_block` service, returning saved content when available and the registered default otherwise. Reading the default does not create a database row. The public `/api/content/portal.guide` route continues to return 404.

The default text remains a placeholder until Peer2Peer and CAPS supply the protocol. Both views render the title from the content block and its body through the existing safe Markdown component.

## Frontend data

`useGuide` in `frontend/src/lib/portal/queries.ts` uses the query key `["guide"]` for both views. The panel fetches only when opened unless the full page has already populated the cache. Cached data stays fresh across page and panel mounts; inactive queries use React Query's default garbage-collection window. Signing out clears the portal query cache.

Both views show a loading status and offer a retry if the request fails. The portal provider handles expired-session redirects. No new analytics, message logging, dependencies, or database migrations are introduced.

## Verification

Run the full repository checks from the root:

```bash
make check
```

Focused tests:

```bash
cd backend
uv run pytest tests/test_portal_guide.py tests/test_content_blocks.py
```

```bash
cd frontend
npx vitest run src/app/portal/guide/page.test.tsx src/components/portal/GuidePanel.test.tsx src/components/portal/PortalShell.test.tsx
```

The backend tests cover session enforcement, both staff roles, saved and default content, and the public API restriction. Frontend tests cover Markdown, loading and retry states, top-bar opening, Escape, the close button, focus restoration, a preserved conversation draft, and one shared request across the page and repeated panel openings.

For a manual check, sign in to the portal, open Guide from the navigation, then open and close the top-bar panel with both Escape and Close. Confirm focus returns to Guide and the URL stays unchanged. At mobile widths, confirm the panel fills the screen and long content scrolls while Close remains visible.

[Production-build screenshots and browser-check notes](screenshots/responder-guide/README.md) use synthetic staff and content fixtures. Browser checks passed at 320px, 375px, and 1280px.
