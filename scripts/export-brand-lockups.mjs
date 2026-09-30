import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.resolve(scriptDir, '../public/images/brand');

const images = {
  glass: (await readFile(path.join(brandDir, 'mainsagents-logo-glass.png'))).toString('base64'),
  black: (await readFile(path.join(brandDir, 'mainsagents-appicon-black.png'))).toString('base64'),
};

const lockups = [
  {
    filename: 'mainsagents-lockup-on-light.svg',
    image: images.black,
    color: '#171A20',
    clip: '<clipPath id="iconClip"><rect x="16" y="16" width="208" height="208" rx="48"/></clipPath>',
    imageAttributes: 'clip-path="url(#iconClip)"',
  },
  {
    filename: 'mainsagents-lockup-on-dark.svg',
    image: images.glass,
    color: '#F7F9FC',
    clip: '',
    imageAttributes: '',
  },
];

for (const lockup of lockups) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1050 240" role="img" aria-label="MainsAgents">
  <defs>${lockup.clip}</defs>
  <image x="0" y="0" width="240" height="240" href="data:image/png;base64,${lockup.image}" ${lockup.imageAttributes}/>
  <text x="260" y="155" fill="${lockup.color}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="105" font-weight="650" letter-spacing="-5">MainsAgents</text>
</svg>`;
  await writeFile(path.join(brandDir, lockup.filename), svg);
}
