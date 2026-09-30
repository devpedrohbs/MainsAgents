# MainsAgents — logo kit

The selected mascot is stored in `mainsagents-logo-glass.png` with a transparent background (1254 × 1254 px). It is the source for every variant in this folder.

| File | Recommended use |
| --- | --- |
| `mainsagents-logo-glass.png` | Main transparent artwork on a medium or dark background |
| `mainsagents-logo-512.png`, `-256.png`, `-128.png`, `-64.png`, `-32.png` | Transparent icon sizes for UI and favicons |
| `mainsagents-appicon-black.png` | Primary desktop app icon with a black background |
| `mainsagents-icon-black.ico` | Primary Windows app and installer icon |
| `mainsagents-appicon-graphite.png` | Neutral desktop or mobile app icon |
| `mainsagents-appicon-cobalt.png` | App icon matching the project's accent color |
| `mainsagents-appicon-slate.png` | Soft neutral app icon |
| `mainsagents-icon.ico` | Transparent Windows icon alternative |
| `mainsagents-lockup-on-light.svg` | Mascot plus name on light surfaces |
| `mainsagents-lockup-on-dark.svg` | Mascot plus name on dark surfaces |
| `preview.html` | Visual mockups and links to every file |
| `mainsagents-mockups.png` | Shareable mockup board |

The SVG lockups embed the approved raster logo for a self-contained layout; they are not vector redraws. The text uses Inter when available, with system font fallbacks. The square app icons have no baked corner radius because operating systems apply their own icon mask.

Example in this project:

```tsx
<img src="/images/brand/mainsagents-logo-128.png" alt="MainsAgents" width="48" height="48" />
```

To regenerate the lockups after changing the source artwork, run `node scripts/export-brand-lockups.mjs` from the repository root.

## Artwork source

The final mascot was created with the built-in `image_gen` tool, using the preceding glass mascot as the edit target and the user's fraque sketch as a loose shape reference. Final prompt:

> Use case: logo-brand. Edit IMAGE 1, the current MainsAgents mascot, preserving its front-facing friendly avatar face, two dark oval eyes, small round hand holding the conductor's baton at the viewer's right, neutral silver-white frosted-glass/soft-blur material, simple premium icon style, and transparent background. Change the body/garment silhouette to read clearly as a simplified conductor's FRAQUE (formal tailcoat), using IMAGE 2 only as a loose reference for its split tapered coat tails. Shape the lower hem into two smooth, elegant downward tails separated by one clean central notch, with a subtly narrower waist and two simple front lapel panels. Keep the tails short enough that the mascot remains compact and balanced in a square app icon. The character is still an abstract little avatar, not a realistic human; no legs, no shoes, no extra arms, no detailed buttons or stitching. Preserve the baton in the round hand. Clear geometric silhouette at 32 pixels. Do not reproduce the sketch literally. No text, no colored backdrop, no other objects. Genuine transparent alpha, square 1:1, generous clear padding.
