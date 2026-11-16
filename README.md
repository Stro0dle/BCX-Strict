# BCX Strict

A stricter fork of [Bondage Club Extended (BCX)](https://github.com/Jomshir98/bondage-club-extended) for Bondage Club. It keeps everything BCX does and removes the easy ways out: while you are restrained, you can no longer open the menus, settings or tools that would let you free yourself.

> [!WARNING]
> BCX Strict is made to get you **really stuck**. Once your owner has set things up, you may not be able to undo them yourself. Use it only if you know what you are doing and trust the people who have power over you.
> If you just want BCX, use the [official BCX](https://jomshir98.github.io/bondage-club-extended/).

### Tampermonkey install:
https://github.com/Stro0dle/BCX-Strict/raw/main/load.user.js

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. **Disable the official BCX** and any other BCX loader. Also disable UltraBC and BCTweaks: they conflict with BCX Strict.
3. Open the link above and click **Install**.
4. Reload Bondage Club.

### Bookmark:
```
javascript:(()=>{if(window.BCX_Loaded===undefined){const s=document.createElement('script');s.crossOrigin='anonymous';s.src='https://stro0dle.github.io/BCX-Strict/bcx.js?'+Date.now();s.onload=()=>s.remove();document.head.appendChild(s);}})();
```
Create a bookmark with this as its address, then click it once Bondage Club is open.

## What BCX Strict adds

### Always on
These restrictions are built in. Nobody has to add a rule for them, so they also work when the people around you use the normal BCX.

While you are restrained:
- **No escape through the menus**: the BCX menu, the game settings, the Extensions tab, the difficulty setting, your profile and the friend list are locked.
- **No calling for help**: you cannot send beep messages.
- **Struggle cooldown**: after too many struggle attempts in a row, struggling is blocked for 10 minutes.

At all times:
- **Only your club owner can remove your rules and curses.**
- **"Prevent using BCX permissions" stays active**, so you cannot hand yourself access back.
- **DevTools are blocked**: the usual keyboard shortcuts do nothing, and docked DevTools are detected and reported in the chat.

### New rules
Your owner can add these from the BCX rules menu, like any other rule.

| Rule | What it does |
| --- | --- |
| Make struggling harder | Slows down struggling (and optionally lockpicking) instead of blocking it. The strength kept is set between 10% and 90%. |
| Lock accepted limits | Once a rule or curse is allowed, you cannot set it back to "blocked". Only an owner can. |
| Permanent rules and curses | No one can remove your rules and curses before a set date. |
| Auto-escalate punishments | Every new rule violation extends the timer locks you wear and can beep your owner. |
| Detect official BCX usage | Logs it, and tells your owner, if you went back to the official BCX between two sessions. |

## Your BCX data

- On its first launch, BCX Strict copies your BCX data (rules, curses, relationships, logs…) and starts from it.
- **Your official BCX data is never changed or deleted.** If you go back to the official BCX, you find it exactly as you left it.
- BCX Strict saves its own data separately (`ExtensionSettings.HardCoreClub`), and keeps a copy of your original BCX data in your browser (`HardCoreClub_<member number>_officialBCX`).
- Changes made in BCX Strict are not copied back to the official BCX.

BCX Strict only runs on the Bondage Club servers (bondage-europe.com, bondageeurope.com, bondageprojects.com, bondageprojects.elementfx.com and bondage-asia.com).

## Development

Requires Node.js 24 and Yarn 1.

```
yarn install
yarn build       # dist/bcx.js
yarn dev         # rebuild on every change and serve dist/ locally
yarn typecheck
yarn lint
yarn test
```

| Path | Contents |
| --- | --- |
| `src/index.ts` | Entry point |
| `src/modules/` | BCX modules: rules, curses, conditions, speech, storage, GUI hooks… |
| `src/modules/miscPatches.ts` | Most of the always-on restrictions |
| `src/rules/` | Rule definitions, including the BCX Strict rules in `other.ts` |
| `src/gui/` | The BCX menus |
| `resources/`, `static/` | Images and files copied next to `bcx.js` |
| `load.user.js` | Tampermonkey loader |

Pushes to `main` are built by GitHub Actions and published to GitHub Pages at `https://stro0dle.github.io/BCX-Strict/bcx.js`.

## Credits

BCX Strict is built on [Bondage Club Extended](https://github.com/Jomshir98/bondage-club-extended) by Jomshir98 and Jean-Baptiste Emmanuel Zorg, and on the STRICT and HardCoreClub forks by Kink Side of the Moon and Rufflan.

## License

[GPL-3.0](LICENSE), like BCX.
