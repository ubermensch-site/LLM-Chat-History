# Scenario 2 live-route authority

Authenticated QA on `a1ed35717f9665ff51f2093e8dba83b243c7d8db` still showed a stable titled two-message conversation plus a provisional `Untitled conversation` containing the same user prompt and a stranded partial assistant capture.

Root cause: the background stale-provisional guard was based on `sender.tab.url`, which can describe the sending/replaced document rather than the tab's actual current route. A late provisional observation can therefore reach storage after the tab has already advanced to a stable `/c/<id>` route.

Required fix: resolve the live tab route with `chrome.tabs.get(tabId)` before accepting provisional provider observations, and do not allow turn snapshots/upserts to release an existing stable tab-session claim. Only an explicit provisional conversation observation on an actually current new-chat route may start the next provisional archive.
