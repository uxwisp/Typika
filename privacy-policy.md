# Privacy Policy for Typika

**Last updated:** May 24, 2026

---

## 1. Overview

Typika ("the Extension") is a browser extension that lets you inspect fonts on web pages by hovering over text. This policy explains what data is collected and how it is used.

## 2. Data We Collect

The Extension uses [Plausible Analytics](https://plausible.io) — a privacy-focused analytics service — to collect anonymous usage statistics. The following events are sent to Plausible when they occur:

- `pageview` — when the Extension is first installed
- `pageview` — when the browser starts and the Extension loads
- `activate` — when the user activates the Extension on a page

No personal information (such as your name, email, or browsing history) is collected or transmitted.

## 3. Data Transmitted to Third Parties

When the events above are triggered, a request is made to `https://plausible.io/api/event`. This request includes:

- The event name (`install`, `startup`, or `activate`)
- Your IP address, which is processed by Plausible solely to determine approximate country-level location and is then immediately anonymized — it is never stored in identifiable form

Plausible is GDPR-compliant and does not use cookies, does not track users across sites, and does not sell data. See [Plausible's privacy policy](https://plausible.io/privacy).

## 4. Data We Do Not Collect

The Extension does **not**:

- Read, store, or transmit the content of web pages you visit
- Collect your browsing history
- Use cookies or fingerprinting
- Transmit font names, URLs, or any page content to any server

All font inspection happens locally in your browser.

## 5. Permissions

The Extension requests the following Chrome permissions:

| Permission | Purpose |
|---|---|
| `activeTab` | To inspect fonts on the currently active tab when you activate the Extension |
| `scripting` | To run the font inspection script on the page |
| `search` | To open a search for a font name when you click on it |
| `contextMenus` | To add options to the Extension's right-click menu |

## 6. Changes to This Policy

If this policy changes materially, we will update the **Last updated** date above. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## 7. Contact

If you have questions about this policy, contact: [design.kirillg+typika@gmail.com](mailto:design.kirillg+typika@gmail.com)
