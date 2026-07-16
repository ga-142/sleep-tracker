# Architecture

Sleep Tracker is intentionally small enough to run on one machine while
keeping the web, application, and persistence layers separate.

## Request flow

1. Nginx serves the static frontend and proxies `/api` requests.
2. Flask validates entry and range inputs before calling the data layer.
3. SQLite stores diary entries, application settings, and chat history in a
   named Docker volume.
4. Dashboard aggregates and exports are calculated from the same filtered
   entry set so their numbers stay consistent.
5. AI calls are optional. The backend constructs context from the requested
   period and streams the provider response to the browser.

## Design decisions

### Deterministic metrics

Sleep metrics are calculated in Python, not by an AI model. This makes the
dashboard and exported reports reproducible and testable. The assistant only
explains data that has already been calculated.

### Inclusive ranges

The frontend turns presets into explicit local calendar dates. The backend
uses inclusive `start` and `end` filters for entries, aggregates, downloads,
email reports, and assistant sessions.

### Local-first storage

SQLite fits a single-user diary and requires no external database service.
The database lives outside the container filesystem in `sleep_data`, so image
rebuilds do not erase it.

### Provider choice

Anthropic offers a hosted assistant while Ollama provides a local option. The
core tracker has no dependency on either provider and works without AI
configuration.

## Trust boundaries

- There is no user authentication. Bind the app only to a trusted machine or
  protect it with an authenticated reverse proxy.
- Selecting Anthropic sends relevant diary and profile context to Anthropic.
- Selecting Ollama sends that context to the configured Ollama endpoint.
- SMTP and AI credentials are write-only in normal settings responses.
- This is an educational project, not a medical device or clinical decision
  support system.
