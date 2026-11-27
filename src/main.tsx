import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { FloatingHudBar } from "./components/FloatingHudBar";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const isFloatingHud = window.location.hash === "#hud";
if (isFloatingHud) {
  document.documentElement.classList.add("is-floating-hud");
  document.body.classList.add("is-floating-hud");
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      {isFloatingHud ? <FloatingHudBar /> : <App />}
    </I18nProvider>
  </StrictMode>
);
