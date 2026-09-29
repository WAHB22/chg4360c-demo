# Memory: what Wahb liked and disliked

## Approved

- **Spitch video v4.** It has no people.
  - One orange dot is the protagonist: born as the dot of "ıdea", it climbs a price chart and dies on "died". It then turns grey inside an AI chat, fails to roll uphill to LIVE, and gets buried under "thanks for your application" emails. On "Spitch" it reignites and bursts into the wordmark, and in the outro it lands as the period above the email.
  - Pitchers are circles and builders are squares. They lock into one mark that lands on a $5 coffee.
  - The close is an engineering drawing: his name with a dimension line reading "fourth-year engineering student", a title block, and the "problems" taped on and circled in orange.
  - Type rises out of baseline masks. There's paper texture, film grain and hard cut-paper shadows, and every cue sits on a spoken word.
- **v3** (cut-paper puppet version, hand-animated on twos) was accepted as a step up, but v4 is the standard.
- **The Spitch waitlist site and WAHB'S WORLD**, as deployed on Vercel.
- **His own voice** instead of TTS. He uploaded a recording when the TTS voice felt fake.
- **Selective generated voices as effects:**
  - an excited announcer on "Introducing… Spitch!" (Kokoro am_fenrir with a hall reverb and slapback echo);
  - a robot voice on "thanks for your application" (ring modulation, bit crush and a comb filter).
- **"résumé" said with a French accent** and spelled with accents in the captions.
- **Burned-in captions** in bold Times New Roman, appearing word by word, with key words in orange and "AI chat box" in green.
- **Agent debates on product ideas.** He asked for four agents: one supporter, one critic, one improver, and one gatekeeper who refuses until there is no weak point. He thinks about selling what gets built.

## Rejected (never repeat)

- **Anything that looks AI-generated.** He said "lose the AI aspect" and "I don't like the current version visuals". Specifically:
  - an illustrated talking-head avatar in an office background (v1 and v2);
  - generic dark rounded cards floating on gradients, glows everywhere, centred everything;
  - an obviously synthetic TTS voice for the main narration;
  - evenly paced, uniformly eased motion with no weight or anticipation;
  - stock-template layouts: three equal feature cards, eyebrow labels above every heading, purple or blue AI gradients.
- **A human or character animation** when he asked for another approach. He wanted "another animation not using a human animation".
- **Partial delivery, or stopping to ask about things the brief already answers.**
- **Files he can't open.** A 64 MB video over the send limit wasn't delivered: always make a share copy.
- **Music louder than the voice.** Keep it 13 to 14 dB under.
- **Pronunciation errors.** "Spitch" must be SPITCH, never "speech". "Wahb" is one syllable.
- **Real logos:**
  - no Tinder or LinkedIn logos (draw generic UI);
  - no uOttawa crest (plain type only);
  - no real bank notes (a drawn "$5" tag).

## Standing facts

- Mohamed Wahb Berguia, fourth-year engineering, uOttawa. Contact mberg133@uottawa.ca. GitHub account WAHB22.
- **Repos:**
  - WAHB22/Spitch: the site, plus the video in `video/`.
  - WAHB22/wahbs-world.
  - chg4360c-demo, which holds the installed skills.
- **Vercel:**
  - The site is spitch.vercel.app; the app is wahbs-worlds.vercel.app.
  - The Vercel connector returned 403 for the "wahbs-world" scope, so he deploys by importing the repo himself.
  - Supabase variables arrive with NEXT_PUBLIC_ names, so make the code accept both VITE_ and NEXT_PUBLIC_.
- The course is GNG4120. The pitch video is unlisted on YouTube and recruits 3 to 4 teammates.
