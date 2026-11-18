# Furry wallpaper sources and preparation

The bundled wallpapers include fresh pastel illustrations with pawprint details and two warm woodland cabin scenes. They were generated with OpenAI's built-in imagegen tool on November 19, 2026 for this project. The three pastel images used no reference images; the two woodland scenes use the user-provided, AI-generated forest cabin illustration from the conversation as a style reference. They are AI-generated illustrations, not commissioned or attributed to a human artist. Exact generation prompts are preserved in [GENERATION.json](GENERATION.json) and [GENERATION-WARM.json](GENERATION-WARM.json).

| Bundled file | Scene | Preparation |
| --- | --- | --- |
| `furry-paw-day.webp` | Pawprint Sky: a fluffy fox in a mint-and-blue meadow | Encoded at 1920 × 1080, WebP quality 90. Default for new profiles. |
| `furry-paw-moon.webp` | Moonlit Paws: a wolf, crescent cushion and paw constellation | Encoded at 1920 × 1080, WebP quality 90. |
| `furry-paw-studio.webp` | Mint Art Studio: a cat drawing beside a sunny window | Encoded at 1920 × 1080, WebP quality 90. |
| `furry-rainy-library.webp` | Rainy Woodland Library: a fox reading by a rain-covered forest window | Encoded at 1920 × 1080, WebP quality 90. |
| `furry-lakeside-tea.webp` | Lakeside Tea: a wolf with a warm mug overlooking a misty lake | Encoded at 1920 × 1080, WebP quality 90. |
| `Mp4/furry-paw-breeze.mp4` | Pawprint Breeze: meadow grass bends in waves, the fox's tail sways, and two flocks of birds cross the sky | Silent 12-second loop at 1280 × 720, encoded as H.264 MP4. The animation uses the Pawprint Sky illustration as its base. |

All six backgrounds and the generic shortcut symbols in `resource/icons/furry/` are bundled locally. The symbols are navigation illustrations rather than official site logos. No site artwork is copied into the extension, and shortcut destinations do not endorse this project.

The existing wallpaper preset IDs are retained so saved built-in selections keep working. Saved custom wallpapers and the plain theme background remain available. A new profile starts with the static sky wallpaper; the animation is an optional selection under Wallpaper.

To rebuild the optimized assets, put the three original generated PNGs in `dist/furry-sources/`, named `furry-paw-day.png`, `furry-paw-moon.png` and `furry-paw-studio.png`. Run `node scripts/build-furry-wallpapers.mjs dist/furry-sources`. The script uses a separate headless Chrome profile and local-only HTTP server to encode the WebP images and silent MP4; it does not use the user's browser profile. Intermediate PNGs are excluded from the extension package.

To rebuild just the animation from the bundled illustration, run `node scripts/build-furry-wallpapers.mjs dist/furry-sources --animation-only`.

To encode only the two additional woodland scenes, place `furry-rainy-library.png` and `furry-lakeside-tea.png` in the source directory and run `node scripts/build-furry-wallpapers.mjs dist/furry-sources --images-only furry-rainy-library furry-lakeside-tea`.
