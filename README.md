# Praesidium Backend API

Backend API for the Praesidium family location tracking mobile app.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js with TypeScript
- **Database**: Turso (SQLite edge database - 100% free, no card required)
- **ORM**: Drizzle ORM
- **Authentication**: JWT tokens
- **Deployment**: Vercel (100% free, no credit card)

## Local Development

### Prerequisites

- Node.js 20+

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from example:
```bash
cp .env.example .env
```

3. For local development, no database setup needed - it uses a local SQLite file (`local.db`).

4. Push the schema to the database:
```bash
npm run db:push
```

5. Start development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user (parent/child)
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PATCH /api/auth/fcm-token` - Update FCM token
- `POST /api/auth/pairing-code` - Generate new pairing code (parent only)

### Family
- `POST /api/family` - Create family
- `GET /api/family` - Get current family
- `POST /api/family/join` - Join family with invite code
- `POST /api/family/leave` - Leave family
- `POST /api/family/regenerate-code` - Regenerate invite code
- `GET /api/family/members` - Get family members with locations
- `POST /api/family/places` - Add favorite place
- `GET /api/family/places` - Get favorite places
- `DELETE /api/family/places/:id` - Delete favorite place

### Location
- `POST /api/location` - Update location
- `GET /api/location/current` - Get current location
- `GET /api/location/history` - Get location history
- `GET /api/location/user/:userId` - Get user's latest location
- `POST /api/location/batch` - Batch sync locations

### Status
- `POST /api/status` - Update status (arrived/departed/safe)
- `GET /api/status/current` - Get current status
- `GET /api/status/history` - Get status history
- `GET /api/status/family` - Get family statuses

### Children (Parent Only)
- `GET /api/children` - Get all children
- `GET /api/children/:childId` - Get child details
- `GET /api/children/:childId/tracks` - Get child's location tracks
- `GET /api/children/:childId/stats` - Get child's daily stats
- `POST /api/children/stats` - Update daily stats (child only)
- `PATCH /api/children/:childId/avatar` - Update child's avatar

## Deployment to Vercel (Free)

### First-time Setup

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Create free Turso database at [turso.tech](https://turso.tech):
   - Sign up with GitHub (no credit card needed)
   - Create a new database
   - Copy the database URL and auth token

4. Deploy:
```bash
vercel
```

5. Set environment variables in Vercel dashboard or CLI:
```bash
vercel env add TURSO_DATABASE_URL
vercel env add TURSO_AUTH_TOKEN
vercel env add JWT_SECRET
vercel env add CORS_ORIGINS
vercel env add NODE_ENV
```

6. Deploy to production:
```bash
vercel --prod
```

### Subsequent Deployments

```bash
vercel --prod
```

Or connect your GitHub repo in Vercel dashboard for automatic deploys.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| TURSO_DATABASE_URL | Turso database URL or `file:local.db` for local | Yes |
| TURSO_AUTH_TOKEN | Turso auth token (only for remote DB) | Production only |
| JWT_SECRET | Secret for JWT signing | Yes |
| PORT | Server port (local dev only) | No (default: 3000) |
| NODE_ENV | Environment | No (default: development) |
| CORS_ORIGINS | Allowed CORS origins (comma-separated) | No |

## Free Services Used

- **Vercel**: Free hosting for serverless functions
  - 100GB bandwidth/month
  - Unlimited deployments
  - No credit card required

- **Turso**: Free SQLite edge database
  - 9GB total storage
  - 500 million row reads/month
  - Unlimited databases
  - No credit card required

Both services have generous free tiers that should be enough for personal/small projects.
