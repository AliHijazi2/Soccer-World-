import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Kein Wurzelelement gefunden");

createRoot(root).render(<StrictMode><App /></StrictMode>);

// Macht die App installierbar und den Start vom Startbildschirm sofortig.
// Fehlschläge sind unkritisch — ohne Worker läuft alles genauso, nur langsamer.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
