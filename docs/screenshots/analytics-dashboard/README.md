# Line analytics dashboard previews

Captured from the production frontend using a synthetic coordinator session and fixture API responses. Every number and topic or outcome label is made up; nothing came from or was saved to the database. The portal socket was blocked, so the header shows "Reconnecting…".

- [Desktop, 1280px](analytics-1280.png): the default last 30 days, with all six tiles, conversations per day, topic and outcome bars, and the average confidence.
- [Mobile, 375px](analytics-375.png): the same view. Topic and outcome labels stay readable because those charts use horizontal bars.
- [Custom range, SMS only, 1280px](analytics-custom-sms-1280.png): a two-week custom range filtered to SMS, where every topic and outcome group and the confidence average fall below the threshold of 5. It shows the small-group notes and the note that the CSV covers all channels.

Browser checks at 375px and 1280px found no horizontal overflow and no page errors.
