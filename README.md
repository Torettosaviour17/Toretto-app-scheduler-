# After Dark Scheduler

Single-owner JavaScript scheduler for Code After Dark. A mobile planner and a bearer-authenticated API share a persistent SQLite delivery queue. Schedule any future date, cancel queued deliveries, and see a separate result for each destination. The dashboard uses Nigerian local time.

## Run

Use Node.js 24+. Set SCHEDULER_KEY to a random secret of at least 24 characters in your environment and run npm start. Open http://localhost:3000 and enter that key. Run npm test for the offline checks.

For continuous delivery use one always-on Node process, persistent DATA_DIR storage and an HTTPS reverse proxy. Set HOST=0.0.0.0 if your hosting environment requires it. Back up the SQLite database. A stopped worker processes overdue queued posts when restarted.

## Connect publishing accounts

Configure the host environment directly; keep tokens out of Git and chat. Set META_GRAPH_VERSION to the Graph API version configured for your app. Set META_TOKEN to an authorized token for your managed Facebook Page and linked professional Instagram account. Set FACEBOOK_PAGE_ID and/or INSTAGRAM_ACCOUNT_ID. For X text posts use X_USER_TOKEN with write permission. Tokens must be renewed when they expire. This first version uses provisioned tokens; it has no self-service OAuth onboarding.

Facebook accepts text and public image URLs, Instagram accepts public image URLs, and X accepts text. Each network enforces its own posting policies and limits. A due job without credentials or a rejected delivery enters review. If the process stops after claiming a job, it remains sending: check the social account before submitting another copy.

## Scheduling API

POST /api/posts with Authorization: Bearer <scheduler key> and application/json:
```json
{"channels":["facebook","instagram"],"caption":"What are you saving for?","media":"https://your-host.example/flyer.jpg","at":"2027-01-04T16:30:00+01:00"}
```
GET /api/posts lists delivery state; DELETE /api/posts/:id cancels a queued destination. For future agent integration expose the API over HTTPS behind a dedicated authenticated connector. Video generation and video publishing are future integrations. No Metricool account is needed to use this application.
