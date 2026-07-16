# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose sleep
diary data, credentials, or another person's system. Report it privately with
GitHub's **Report a vulnerability** feature on the Security tab.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. Please allow a reasonable amount of time for a fix before public
disclosure.

## Data and credentials

Sleep Tracker is self-hosted and stores diary data in a local SQLite database.
The database and `.env` files are intentionally excluded from version control.
Never commit a real database, SMTP password, or AI-provider API key.

When Anthropic is selected as the AI provider, relevant sleep entries and
profile context are sent to Anthropic for analysis. Ollama can be used when a
fully local model is preferred.

## Medical limitations

This project is an educational self-tracking tool, not a medical device. It
does not diagnose or treat insomnia and is not a substitute for care from a
qualified health professional.
