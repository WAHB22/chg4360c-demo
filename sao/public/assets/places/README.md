# Place paintings

One painting per place and time of day, named `<place>-<time>.webp`.

* Places: `town`, `campus`, `bobino`, `tower`, `home`, `kitchen`, `gym`, `market`, `vault`, `fields`, `lighthouse` (the ids in `public/js/places.js`).
* Times: `morning`, `day`, `sunset`, `night`.
* Example: `bobino-sunset.webp`, `campus-morning.webp`.
* Size: 16:9, at least 2400 px wide, WebP.

How to paint them: watercolour and gouache transparency, warm cream or gold light with cool blue or violet shadows, no pure black. Dark soft foliage frames the corners, the subject sits sharp and bright in the middle distance, the far background is hazy and pale blue. About 40 percent sky, a high vantage point, and an open path from the bottom center to the subject where the bots walk. Each place has its signature light in `places.js`.

When a file is present and its name is listed in `paintings.json` (in this folder), it replaces the painted placeholder. The world reads that list once and only loads the files on it, so a painting that does not exist yet never shows an error. Until then the world paints its own placeholder in code and shows a small tag, Painting coming.

Only original artwork goes here: no frames, characters, logos or scenes from any show, and nothing personal. This folder is part of the public deployment.
