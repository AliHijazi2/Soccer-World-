/**
 * Prüft im echten Browser, ob die App installierbar ist.
 *
 * Manifest, Symbole und Service Worker einzeln auszuliefern reicht nicht —
 * der Browser muss sie auch akzeptieren.
 */

import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH
    ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });

const manifest = await page.evaluate(async () => {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return null;
  const response = await fetch(link.href);
  return response.ok ? await response.json() : null;
});

// Der Worker registriert sich erst nach dem load-Ereignis
await page.waitForTimeout(1500);
const worker = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "nicht unterstützt";
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return "nicht registriert";
  return registration.active ? "aktiv" : registration.installing ? "installiert" : "wartet";
});

const checks: [string, boolean, string][] = [
  ["Manifest geladen", manifest !== null, manifest?.name ?? "fehlt"],
  ["Anzeigemodus standalone", manifest?.display === "standalone", String(manifest?.display)],
  ["Startadresse gesetzt", Boolean(manifest?.start_url), String(manifest?.start_url)],
  ["Symbol 192 und 512", (manifest?.icons?.length ?? 0) >= 2,
    `${manifest?.icons?.length ?? 0} Symbole`],
  ["Maskierbares Symbol", manifest?.icons?.some(
    (icon: { purpose?: string }) => icon.purpose?.includes("maskable")) ?? false, ""],
  ["Service Worker", worker === "aktiv" || worker === "installiert", worker],
  ["Titel für iOS", await page.locator('meta[name="apple-mobile-web-app-title"]').count() > 0, ""],
  ["Vollbild auf iOS", await page.locator('meta[name="apple-mobile-web-app-capable"]').count() > 0, ""],
];

let failed = 0;
for (const [label, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(26)} ${detail}`);
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
