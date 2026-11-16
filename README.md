# Yeti Run

A free, open-source downhill skiing game that runs entirely in your browser. Dodge trees and rocks, hit ramps, pull off spins, and outrun the yeti.

No build step, no dependencies, no image files. Everything is plain HTML, CSS and one JavaScript file, and all the art is drawn in code.

## Play

Play it here once GitHub Pages is enabled: `https://adamc15.github.io/yeti-run/`

Or run it locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. You can also just open `index.html` directly.

## Controls

| Key | Action |
| --- | --- |
| Left / Right (or A / D) | Turn (hold to keep turning) |
| Down (or S) | Point straight downhill |
| F or Shift | Boost (limited meter, recharges) |
| Left / Right in the air | Spin for bonus style points |
| P / Esc | Pause |
| M | Mute |

Touch devices get on-screen buttons.

## Hosting your own copy

1. Fork or clone this repo.
2. In GitHub, go to Settings > Pages and choose "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Your game is live at `https://<your-username>.github.io/yeti-run/`.

## Tweaking it

Open `game.js` and edit the `CFG` block at the top: speeds, crash time, when the yeti shows up, boost drain. Obstacle types and density are in `cellObj()`, and each sprite is a small `draw*` function, so adding a new obstacle is a few lines.

## Files

- `index.html`: page and overlays
- `style.css`: retro window styling
- `game.js`: all game logic, rendering and sound

## Originality and IP

This is an original game inspired by the general idea of classic downhill-skiing-versus-a-monster games. It contains no code, artwork, sounds or names from any existing title, and it is not affiliated with or endorsed by anyone. Game concepts and mechanics are not protected by copyright, but specific code and art are, so if you extend this project, keep it original and don't import assets from other games. This note is not legal advice.

## License

MIT. See [LICENSE](LICENSE).
