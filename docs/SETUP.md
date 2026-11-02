# Steps only Wahb can do (laptop, about 20 minutes)

Nothing here touches the live page until step 7, and step 7 happens only when you say yes.

## 1. Private GitHub repo (2 min)
1. github.com > New repository > name `wahb-finance` > **Private** > no README, no .gitignore, no licence > Create.
2. Make sure the Claude GitHub app can see it: github.com/settings/installations > Claude > Configure > Repository access > add `wahb-finance` (skip if it has access to all repositories).
3. Tell Claude "repo is ready". Claude pushes `main` (the 3 live files, untouched) and `a-html` (this build).

## 2. Keep a copy of your backup on your laptop (1 min)
Open https://wahb-finance.vercel.app and tap **Download backup**. Keep the file out of any repo.

## 3. Claude API key with a spend limit (5 min)
1. console.anthropic.com > Settings > Workspaces > **Create workspace** named `wahb-finance` (the Default workspace cannot have a limit).
2. In that workspace: Limits > **Spend limit** $20 per month, and an email alert at $10.
3. API keys > Create key **in that workspace** > copy it once.
4. Vercel > wahb-finance > Settings > Environment Variables > add `ANTHROPIC_API_KEY` = the key, type Sensitive, environments Production and Preview.
Until this exists, screenshot and PDF reading says "Reading screenshots is not set up yet. CSV files still work."

## 4. Device key (2 min)
1. Make a long random key. On the laptop terminal: `openssl rand -base64 32 | tr -d '/+=' | cut -c1-40`
2. Vercel > Environment Variables > add `APP_KEY` = that key, type Sensitive, Production and Preview.
3. Your private link is `https://wahb-finance.vercel.app/#key=<the key>` (the part after `#` never leaves the browser, so the key is not in any server log). Open it once on the phone and once on the laptop. Keep it like a password (a notes app is fine, not a shared chat).
Without the key a browser sees only "This device is not set up". This changes who can look at the page: today anyone with the plain link sees everything. If you would rather keep viewing open, say so and only writes will need the key.

## 5. Private Blob store (5 min)
1. Vercel > Storage > Create > Blob > name `wahb-finance-private` > access **Private** > Create.
2. Connect it to the project `wahb-finance`, all environments, and set the **environment variable prefix** to `PRIVATE_BLOB` (so it creates `PRIVATE_BLOB_READ_WRITE_TOKEN` and leaves the existing `BLOB_READ_WRITE_TOKEN` alone).
3. On the first load after the deploy, the page copies your last 10 saves from the old public store into the private one. The old public blobs stay until you say they can be deleted.

## 6. Connect Vercel to the repo (2 min)
Vercel > wahb-finance > Settings > Git > Connect `WAHB22/wahb-finance`. Production branch: `main`. Every other branch gets its own preview link (Vercel login needed to open it). Pushing `main` with the untouched files redeploys the same page you have now.

## 7. Go live (only after you say yes)
Merge `a-html` into `main`. Then open your private link on both devices once. Check the newest save opens and both devices load in under 2 seconds. After that, say whether the old public blobs can be deleted.
