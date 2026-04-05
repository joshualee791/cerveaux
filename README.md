# Les Cerveaux

Personal multi-agent chat: **Ada** (Anthropic Claude) and **Leo** (OpenAI, default GPT‑4.1) share one thread, separate voices, and **persistent per-agent memory**. Built with **Next.js**, **Prisma**, and **PostgreSQL** (e.g. Neon)—no agent frameworks; vanilla API calls only.

**Authoritative architecture & security:** [`docs/les_cerveaux_master_playbook.md`](docs/les_cerveaux_master_playbook.md)

## Principles (from the playbook)

- Conversation first; two minds in a room, not a dispatcher.
- Memory is first-class; identity tension between agents is intentional.
- Every part should stay understandable and debuggable by one person.

## Stack

| Layer | Choice |
|--------|--------|
| App | Next.js 14 (App Router), React |
| Auth | NextAuth (credentials), middleware-protected API routes |
| Data | Prisma + PostgreSQL |
| LLMs | Claude (Ada), OpenAI (Leo), Haiku-class router (`lib/router/classify.ts`) |

## Local setup

1. **Clone** and install dependencies:

   ```bash
   npm install
   ```

2. **Environment** — copy [`.env.example`](.env.example) to `.env` or `.env.local` and fill in `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `HASHED_PASSWORD`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`. See playbook §17 for details.

3. **Database**:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

4. **Run**:

   ```bash
   npm run dev
   ```

5. **Production build**:

   ```bash
   npm run build && npm start
   ```

Apply migrations against your production database after deploy if your host does not run them automatically.

## Routing (high level)

The router assigns **`ADA_ONLY`**, **`LEO_ONLY`**, or (rarely) **`ADA_PRIMARY` / `LEO_PRIMARY`** for dual responses with a deferral prompt to the second agent. Explicit `@ada` / `@leo` and leading addressee lines can override classification—see the playbook §4 and the code.

## Docs

| Doc | Purpose |
|-----|---------|
| [Master playbook](docs/les_cerveaux_master_playbook.md) | System design, prompts, memory, API, env, deployment |
| [.env.example](.env.example) | Required environment variables |

---

*MVP personal system; not a general-purpose SaaS template..*
