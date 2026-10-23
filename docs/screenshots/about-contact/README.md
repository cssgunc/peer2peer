# About and Contact previews

Captured from the production frontend at 375px and 1280px with mocked public API responses. About uses the backend's default titles and placeholder bodies. Contact uses the default contact email and Instagram handle, plus `https://example.edu/responders` as a preview responder form URL.

The settings endpoint from issue #49 is not yet in this checkout. The screenshots show how Contact and the footer render when that endpoint is available. When settings cannot be loaded, the pages show a generic message and the feedback form remains available.

- [About, mobile](about-375.png)
- [About, desktop](about-1280.png)
- [Contact, mobile](contact-375.png)
- [Contact, desktop](contact-1280.png)

Browser checks confirmed no horizontal overflow, Submit and responder controls at least 44px tall, matching Contact/footer links, the feedback counter, success clearing the text, and 429/500 errors preserving it. Feedback requests contained only the body and omitted a synthetic session cookie.
