---
name: markonverter-ozon-live-check
description: Refresh trusted Ozon cookies from the user's Arc browser and run Markonverter's real Ozon live smoke probe. Use when asked whether live Ozon checks work, when `npm run qa:ozon:live` returns `LIVE_OZON_BLOCKED`, when Ozon cookies/session state may be stale, or before claiming a real Ozon page loaded with the unpacked extension.
---

# Markonverter Ozon Live Check

## Core Rule

Always refresh Arc Ozon cookies and Ozon localStorage before trusting a live Ozon result in this checkout.

The deterministic extension regression harness is `npm run qa:ozon`. The real-page reachability probe is separate and can still return `LIVE_OZON_BLOCKED` after a correct cookie refresh because Ozon may block the automated browser, network, VPN, or fingerprint. Do not report fake-harness success as live Ozon success.

Never print, paste, commit, or summarize cookie or localStorage values. It is OK to report counts, domains, origin names, filenames, and `LIVE_OZON_*` statuses.

## Commands

From `/Users/gogla/PycharmProjects/markonverter`:

```bash
rtk python3 .codex/skills/markonverter-ozon-live-check/scripts/export_arc_ozon_cookies.py
```

If macOS prompts for Keychain access to `Arc Safe Storage`, the user must approve or enter their password. The script reads only Ozon rows from Arc's cookie DB and overwrites:

```text
/Users/gogla/PycharmProjects/markonverter/.secrets/ozon-cookies.txt
```

Then export Ozon storage state. This combines the refreshed cookies with Arc localStorage entries for `https://www.ozon.ru` and `https://ozon.kz`:

```bash
rtk node .codex/skills/markonverter-ozon-live-check/scripts/export_arc_ozon_storage_state.mjs
```

It overwrites:

```text
/Users/gogla/PycharmProjects/markonverter/.secrets/ozon-arc-storage-state.json
```

Run the saved live probe with that storage state:

```bash
rtk zsh -lc 'set -a; source .env.ozon.local; set +a; npm run qa:ozon:live'
```

Expected green result:

```text
LIVE_OZON_OK ... panel=attached ...
```

Blocked results are valid evidence, not a failed export by themselves:

```text
LIVE_OZON_BLOCKED ... cookiesImported=true ...
```

## If It Is Still Blocked

Confirm the refreshed file exists without printing it:

```bash
rtk ls -l .env.ozon.local .secrets/ozon-cookies.txt .secrets/ozon-arc-storage-state.json
```

Optionally check only domain/name metadata:

```bash
rtk node --input-type=module -e 'import { readFileSync } from "node:fs"; const state=JSON.parse(readFileSync(".secrets/ozon-arc-storage-state.json","utf8")); console.log({cookies:state.cookies.length, origins:state.origins.map(o=>({origin:o.origin, localStorage:o.localStorage.length}))});'
```

If the saved URL is `www.ozon.ru` and Ozon redirects through KZ SSO, also try the same product path on `www.ozon.kz`:

```bash
rtk zsh -lc 'set -a; source .env.ozon.local; set +a; url=${OZON_QA_URL/https:\/\/www.ozon.ru/https:\/\/www.ozon.kz}; OZON_QA_URL="$url" npm run qa:ozon:live'
```

If both return `LIVE_OZON_BLOCKED`, state that Arc cookies and localStorage were refreshed and imported, but Ozon still blocked the automated live browser. For extension behavior, run the deterministic harness separately:

```bash
rtk npm run qa:ozon
```

## Notes

- `.env.ozon.local` and `.secrets/ozon-cookies.txt` are gitignored local secrets.
- `.secrets/ozon-arc-storage-state.json` is also a gitignored local secret.
- The export script uses macOS Keychain item service `Arc Safe Storage`, account `Arc`.
- The cookie DB is normally `/Users/gogla/Library/Application Support/Arc/User Data/Default/Cookies`.
- Arc Ozon localStorage is normally `/Users/gogla/Library/Application Support/Arc/User Data/Default/Local Storage/leveldb`.
- Cookie-only live checks may still fail after login; use `OZON_QA_STORAGE_STATE` when Ozon redirects through SSO or KZ domain state.
- Chrome/alternate browser channels are not a substitute for a valid result unless the extension service worker loads and the command returns `LIVE_OZON_OK`.
