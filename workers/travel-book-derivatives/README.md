# ALB-03.2 external derivative worker

Container worker for HEIC/HEIF Travel Book derivatives.

## Contract

- `GET /health` -> `{"ok":true}`
- `POST /process`
  - Authorization: `Bearer $ALB03_WORKER_SECRET`
  - body: `{"asset_id":"UUID","actor_id":"UUID"}`
  - claims the existing ALB-03 ingestion through `alb03_claim_v1`
  - reads the already-preserved immutable `original` from the private `travel-book` bucket
  - validates its SHA-256
  - decodes HEIC/HEIF outside Supabase Edge
  - writes immutable `preview.png` and `thumbnail.png`
  - read-backs and verifies both
  - finalizes atomically through `alb03_finish_v1`

The worker never receives a source path or URL from the client.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALB03_WORKER_SECRET`
- optional `ALB03_MAX_PIXELS` (default 60,000,000)

## Resource target

Start with at least 512 MB RAM and 1 vCPU. The physical iPhone HEIC that exceeded Supabase Edge limits is the qualification fixture before production wiring.
