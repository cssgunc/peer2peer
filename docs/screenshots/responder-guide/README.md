# Responder guide previews

[Implementation and testing notes](../../responder-guide.md)

Captured from the production frontend using a synthetic staff session and fixture API responses. The sample guide text and example.edu resource link demonstrate Markdown rendering; the actual guide retains its existing placeholder until Peer2Peer supplies the protocol. No staff account or guide content was saved to the database for these previews.

- [Guide page, 1280px](guide-page-1280.png)
- [Full-screen guide panel, 375px](guide-panel-375.png)
- [Right-side guide panel, 1280px](guide-panel-1280.png)

Browser checks passed at 320px, 375px, and 1280px: the Guide button stays within the viewport, mobile panels cover the screen, desktop panels slide in from the right, and controls are at least 44px tall. Escape and the visible Close button dismiss the panel and restore focus to Guide without changing the URL. The page and repeated panel openings share one request. A longer fixture guide scrolls while the close button stays visible, with no horizontal overflow or browser errors.

Vitest integration tests also verify that opening and closing the panel preserves a mounted conversation draft, while page tests cover loading, Markdown content, and retrying a failed request.
