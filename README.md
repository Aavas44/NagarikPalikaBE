# Nagarik Palika — API

Express.js REST API with MongoDB for **Nagarik Palika**: auth, content management, advocate consultations, payments, and reference data.

This folder is **self-contained** and can be deployed on its own (e.g. copy or submodule from the monorepo). Reference JSON lives under `data/`.

## Requirements

- Node.js 18+
- MongoDB (local via Docker, Atlas, or in-memory fallback in development)

## Setup

```bash
cp .env.example .env
# Edit MONGODB_URI, JWT_SECRET, FRONTEND_URL, etc.

npm install
npm run dev
```

API: http://localhost:4000  
Health: http://localhost:4000/health

### Local MongoDB (optional)

```bash
docker compose up -d
```

Uses `mongodb://127.0.0.1:27017/nagarik-palika` by default.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | Yes (production) | `mongodb://127.0.0.1:27017/nagarik-palika` | MongoDB connection string |
| `JWT_SECRET` | Yes (production) | dev fallback | Signs auth tokens |
| `FRONTEND_URL` | Yes (production) | `http://localhost:3000` | CORS origin + OAuth redirects |
| `ADMIN_EMAIL` | No | `admin@nagarikpalika.gov.np` | Seeded admin user |
| `ADMIN_PASSWORD` | No | `Admin@123` | Seeded admin password |
| `PORT` | No | `4000` | HTTP port |
| `USE_MEMORY_DB` | No | `false` | Use in-memory MongoDB (dev/tests) |
| `DATA_DIR` | No | `./data` | Reference JSON directory |
| `GOOGLE_*` | For OAuth | — | Google sign-in |
| `ESEWA_*`, `KHALTI_*` | For payments | test/UAT values | Payment gateways |
| `ALLOW_DEV_PAYMENT` | No | `true` | Skip real payment verification in dev |
| `CRON_SECRET` | For cron | — | Secures `/internal/consultations/open-pool` |

The database is auto-seeded on first startup with sample Nepal-focused content.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production build |

## Bundled data (`data/`)

| File | Endpoint |
|------|----------|
| `nepal-provinces-districts.json` | `GET /api/reference/provinces` |
| `legal-specialties.json` | `GET /api/reference/specialties` |

## Deploy (e.g. Render, Railway, Fly.io)

1. Deploy this folder (monorepo path: `backend/`, or as a standalone repo).
2. **Build command:** `npm install && npm run build`
3. **Start command:** `npm run start`
4. **Node version:** 18–22 (set in Render if needed; avoid Node 26 until tested)
5. Set environment variables (at minimum `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV=production`).
5. On the frontend, set `API_URL` to this service’s public URL.

For Google OAuth, set `GOOGLE_CALLBACK_URL` to `https://your-api.example.com/api/auth/google/callback`.

## API overview

| Area | Base path |
|------|-----------|
| Health | `GET /health` |
| Auth | `/api/auth/*` |
| Public content | `/api/stats`, `/api/terms`, `/api/templates`, `/api/categories`, `/api/quick-tags`, `/api/lawyers` |
| Reference | `/api/reference/provinces`, `/api/reference/specialties` |
| Consultations | `/api/consultations/*`, `/api/advocates/*`, `/api/payments/*` |
| Admin | `/api/admin/*` |
| Internal cron | `POST /internal/consultations/open-pool` |

## Structure

```
├── data/              # Bundled reference JSON
├── src/
│   ├── config/        # MongoDB connection
│   ├── data/          # Seed data
│   ├── lib/           # Path helpers
│   ├── middleware/    # JWT auth
│   ├── models/        # Mongoose schemas
│   ├── routes/        # Express routers
│   └── services/      # Business logic
├── docker-compose.yml # Local MongoDB
└── package.json
```
