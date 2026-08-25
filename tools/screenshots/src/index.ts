/**
 * Nimmt Bildschirmfotos aller Bereiche gegen den laufenden Server auf.
 *
 *   npm run screenshots -- <league-id> <club-id>
 *
 * Setzt voraus, dass der Server auf Port 3000 läuft und der Client gebaut ist.
 */

import { chromium } from "playwright";

const [leagueId, clubId] = process.argv.slice(2);
if (!leagueId || !clubId) {
  console.error("Aufruf: npm run screenshots -- <league-id> <club-id>");
  process.exit(1);
}

/**
 * Der vorinstallierte Browser der Umgebung, nicht der von Playwright erwartete.
 * Die Build-Nummern weichen ab; ein `playwright install` wäre hier weder nötig
 * noch erlaubt, deshalb wird der Pfad direkt gesetzt.
 */
const EXECUTABLE = process.env.CHROMIUM_PATH
  ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

// Kennungen setzen, bevor die App startet — sonst kommt der Einrichtungsdialog
await page.addInitScript(([league, club]: string[]) => {
  localStorage.setItem("leagueId", league!);
  localStorage.setItem("clubId", club!);
}, [leagueId, clubId]);

await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

for (const [label, name] of [
  ["Markt", "market"], ["Post", "inbox"], ["Kader", "squad"],
  ["Tabelle", "table"], ["Feed", "feed"],
] as const) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/screens/${name}.png` });
  console.log(`  docs/screens/${name}.png`);
}

await browser.close();
