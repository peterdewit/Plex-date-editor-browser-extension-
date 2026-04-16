# Plex Date Bump

Chrome/Chromium extension to move the current Plex item back in **Recently Added** by updating the item's `addedAt` value through Plex's web/API endpoint.

## What changed in v1.1.0

This version does **not rely on browser cookies** for Plex API requests. It sends the request using `X-Plex-Token` only, which avoids HTTP 400 failures on servers where many unrelated services share the same host/IP and browser cookie scope.

## What it does

When you are viewing an item in Plex Web, click the extension and choose either:
- move back 90 / 180 / 365 days, or
- set a specific past date.

The extension then:
1. extracts the current item's metadata ID from the page,
2. reads the item's metadata from Plex,
3. gets the library section ID and media type,
4. sends a `PUT` request to Plex to set `addedAt.value`.

## Install

1. Extract the zip.
2. In Chrome/Brave/Edge go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `plex-date-bump-extension` folder.

## First use

If you use Plex through `app.plex.tv`, open the extension and save:
- **Plex server base URL** such as `http://192.168.0.140:32400`
- **Plex token**

If you use Plex through the direct server URL, the server base is detected automatically.

## Use

1. Open Plex Web.
2. Open the **details page** for the item you want to push back.
3. Click the extension icon.
4. Choose a preset or a custom date.
5. Click **Apply to current Plex item**.
6. Refresh Plex if needed.

## Notes

- Designed for Plex Web in the browser.
- Requests omit browser cookies and use token auth.
- If Plex changes its page structure, metadata ID detection may need adjustment.
- For bulk changes, a script or database approach is still better.
