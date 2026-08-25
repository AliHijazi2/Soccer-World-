/**
 * Erzeugt die App-Symbole aus einem SVG.
 *
 * Ein eigenes Werkzeug, damit das Wappen an einer Stelle geändert werden kann
 * und alle Größen mitziehen — Handys verlangen mehrere.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16233d"/>
      <stop offset="1" stop-color="#0b1120"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="248" r="132" fill="none" stroke="#4ade80" stroke-width="18"/>
  <path d="M256 150 L330 204 L302 292 L210 292 L182 204 Z" fill="#4ade80"/>
  <path d="M256 380 v56 M180 356 l-34 44 M332 356 l34 44"
        stroke="#4ade80" stroke-width="16" stroke-linecap="round" opacity="0.55"/>
</svg>`;

const SIZES = [180, 192, 512];
const OUT = "packages/client/public";

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/icon.svg`, SVG.trim());

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH
    ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();
await page.setContent(
  `<body style="margin:0">${SVG}</body>`,
  { waitUntil: "load" });

for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.locator("svg").evaluate((node, value) => {
    node.setAttribute("width", String(value));
    node.setAttribute("height", String(value));
  }, size);
  await page.screenshot({ path: `${OUT}/icon-${size}.png`, omitBackground: true });
  console.log(`  ${OUT}/icon-${size}.png`);
}
await browser.close();
