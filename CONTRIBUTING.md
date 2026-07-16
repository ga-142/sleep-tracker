# Contributing

Thanks for helping improve Sleep Tracker.

## Local development

1. Copy `.env.example` to `.env` and leave optional secrets blank.
2. Run `docker compose up --build`.
3. Open <http://localhost:8081>.
4. Run the verification suite with `./scripts/check.sh` before submitting a
   pull request.

## Pull requests

- Keep changes focused and explain the user-facing reason for them.
- Add or update tests for calculation and API behavior.
- Never include real health data, credentials, or generated databases.
- Preserve the distinction between deterministic calculations and AI-written
  explanations.
- Avoid presenting unvalidated behavior as medical advice.

For substantial behavior changes, open an issue first so the clinical and
technical assumptions can be discussed.
