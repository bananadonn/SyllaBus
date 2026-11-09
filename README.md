# SyllaBus

Upload a syllabus: PDF, Word (.docx), web page (.html), Markdown, RTF, plain text, or a photo. That's the only input: the
course name and term dates are read from the syllabus itself. You get every exam, deadline, quiz and day off into your
calendar: one-click **Google Calendar** sync, an **.ics** file (Google, Apple, Outlook), or a **CSV**.

## How it works

1. **Text extraction** (`lib/parse/`). PDFs use `unpdf`. HTML, Word (`mammoth`) and Markdown (`marked`) are converted to
   HTML and read in true reading order (`lib/readingOrder.ts`): tables row by row, cell by cell. The browser preview uses
   the same walker, so a quote the server accepts can always be highlighted. Scanned PDFs and photos go straight to Gemini.
2. **AI extraction** (`lib/ai/`). A free model returns JSON: the course name, first/last day of term, and every dated
   item with two *verbatim* quotes, one naming the item (`"Wireshark Lab 1: HTTP"`) and one stating its date
   (`"Sep 14, 16"`, often in another table cell). A **chain of free providers** (Gemini → Groq → OpenRouter, several
   models each) is tried in order. A provider that's rate-limited, overloaded, slow (45 s timeout) or returns bad JSON
   is skipped, busy ones are skipped for a while, and short rate limits get one retry (`lib/ai/fallback.ts`).
3. **Verification without AI** (`lib/validate.ts`):
   - both quotes must actually appear in the syllabus (catches made-up items)
   - `chrono-node` plus day-list parsing (`"Sep 14, 16"` = two days, not 2016) re-reads the date quote and must agree
   - flags week-number dates, dates outside the term, and duplicates
   - expands weekly items ("quizzes every Friday") across the term, skipping breaks
4. **Review.** The user edits the table next to a preview of their actual syllabus with every quote highlighted.
   Clicking a 📍 quote scrolls to the item and its date; clicking a highlight selects its row.
   PDF → rendered pages · DOCX / HTML / Markdown → formatted document (sanitized, sandboxed, no scripts) · photo → image
   · TXT / RTF / pasted → text.
5. **Export.** `.ics` and CSV are built in the browser. Google sync creates a separate "SyllaBus – Course" calendar, so
   removing it removes everything. Cancelling Google sign-in returns to the review page with nothing lost.

## Local setup

```bash
npm install
cp .env.example .env.local   # add at least one AI key (more keys = fewer "busy" errors)
npm run dev                  # http://localhost:3000
```

Free API keys: [Gemini](https://aistudio.google.com/apikey), [Groq](https://console.groq.com/keys),
[OpenRouter](https://openrouter.ai/keys). Add all three for the best reliability. Only Gemini can read scans and photos.

Privacy: free tiers may use prompts to improve their models (the Gemini free tier and some OpenRouter free models).
Say so in your privacy policy.

### Google Calendar sync (optional)

Without these variables the button is hidden and .ics/CSV still work.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Calendar API**.
2. **Google Auth Platform → Branding/Audience:** External, Testing mode. Add your Google account under **Test users**.
3. **Data Access:** add the scope `https://www.googleapis.com/auth/calendar.app.created`. It only lets the app manage
   calendars it creates, not the user's other calendars.
4. **Clients → Create client → Web application.** Authorized JavaScript origin `http://localhost:3000`, redirect URI
   `http://localhost:3000/api/auth/callback/google`.
5. Put `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET` (`npx auth secret`) in `.env.local`.

In Testing mode only listed test users (max 100) can sign in, and they see an "unverified app" screen. A public launch
needs Google's OAuth verification (a real domain, privacy policy and Search Console domain verification).

## Deploy to Vercel

1. Push the repo to GitHub, then **Import** it at [vercel.com/new](https://vercel.com/new). The defaults work
   (framework: Next.js, build command `next build`).
2. **Settings → Environment Variables:** add the same variables as `.env.local`: `GEMINI_API_KEY`, `GROQ_API_KEY`,
   `OPENROUTER_API_KEY` (whichever you have), and for Google sync `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
   Generate a **new** `AUTH_SECRET` for production. Auth.js detects the Vercel URL automatically.
3. Redeploy so the variables take effect.
4. For Google sync, add the deployed URL to your OAuth client: origin `https://<your-app>.vercel.app` and redirect URI
   `https://<your-app>.vercel.app/api/auth/callback/google`.

Notes: uploads are limited to 4 MB (Vercel's request limit is 4.5 MB). Extraction can take a while when free providers
are busy, so `/api/extract` allows up to 120 s. Syllabi aren't stored; a small in-memory cache avoids re-sending the
same file to the AI.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Unit tests: validation, dates, reading order, exports, provider fallback |
| `npm run eval` | Accuracy report on the labeled syllabi in `eval/` (add your own real syllabi there) |
| `npm run build` | Production build |

To test one provider on its own: `AI_PROVIDER_ORDER=groq GROQ_MODELS=openai/gpt-oss-120b npm run eval`.
Any other OpenAI-compatible free API can be added in `getProviders()` (`lib/ai/provider.ts`) with `OpenAICompatProvider`.
