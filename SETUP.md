# Setup — first run

Walks you through getting Resume Talos from a fresh clone to a working dev
environment.

## 1. Get your accounts and keys

You need API keys for four model providers and a Neon Postgres project.

### Neon (database)

1. Visit https://console.neon.tech/ and sign in with GitHub.
2. Create a project named `resume-talos` (any name works).
3. Region: pick the one closest to you.
4. After creation, open **Connection Details**.
5. Toggle **Pooled connection** ON.
6. Copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:abc...@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

> **Note**: pgvector is supported out of the box on every Neon project — you
> don't have to enable it in the console. The `db:init` script below will run
> `CREATE EXTENSION` for you.

### Anthropic (Claude)

1. https://console.anthropic.com/settings/keys
2. Create a key. Save it.

### OpenAI (embeddings only)

1. https://platform.openai.com/api-keys
2. Create a key. Save it.

### Google AI Studio (Gemini)

1. https://aistudio.google.com/apikey
2. Create a key. Save it.

### xAI (Grok)

1. https://console.x.ai/
2. Create a key. Save it.

## 2. Configure environment

```powershell
cd E:\resume-talos
cp .env.local.example .env.local
notepad .env.local
```

Fill in:

```
DATABASE_URL=postgresql://...   # from Neon
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AI...
XAI_API_KEY=xai-...
```

Leave the `MODEL_*` overrides at their defaults unless you want to swap models.

## 3. Initialize the database

```powershell
pnpm db:init     # enables pgvector
pnpm db:push     # syncs schema (dev)
```

For production-style migration files instead:

```powershell
pnpm db:generate   # writes SQL to src/db/migrations/
pnpm db:migrate    # applies them
```

To poke around the data:

```powershell
pnpm db:studio     # opens Drizzle Studio in the browser
```

## 4. Run the app

```powershell
pnpm dev
```

Open http://localhost:3200. The **Dashboard** will show a "Setup complete"
state when every env check passes, or a list of missing keys to fix.

## 5. Next steps in the build

The scaffold is ready, but the agents and document pipeline aren't wired up
yet. Pick a path:

- **Knowledge Base ingestion** — drag-and-drop upload, chunking, embedding,
  fact extraction
- **JD intake + Fit Scoring** — first end-to-end agent flow
- **Writer + Reviewer loop** — full draft → review → revise pipeline

See `README.md` for the system architecture and roadmap.
