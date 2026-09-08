# Ved Gawade — portfolio

AI automation, product operations and technical program management.
One claim: **I build the systems that give teams their week back.**

Live: https://ved1211.github.io/portfolio/ (moving to Vercel)

## Stack

Vite + TypeScript + three.js. No framework, no backend — the site is static,
so it deploys anywhere and there is nothing to keep running.

```
index.html            markup (content lives here)
public/assets/        CV, images — copied to dist as-is
src/
  main.ts             entry: wires everything up
  styles/             tokens, chrome, layout, sections, motion, game
  lib/                theme, boot, cursor, nav, scroll, greeter
  three/
    background.ts     the lattice behind the page
    voxel/            Blueprint, the build-to-plan game
```

`src/styles/tokens.css` is the single source of colour. The 3D reads its
palette from those same custom properties, so changing a token changes the
page, the lattice and the game together.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typechecks, then builds to dist/
npm run preview    # serve the production build
```

## Deploy (Vercel)

The repo has `vercel.json`; Vercel detects Vite and needs no configuration.

```bash
npx vercel        # preview deploy
npx vercel --prod # production
```

Or connect the GitHub repo at vercel.com/new — it builds on every push to
`main` and gives every branch a preview URL.

After the first production deploy, update the two absolute URLs in
`index.html` (`<link rel="canonical">` and `og:url`) to the live domain.
