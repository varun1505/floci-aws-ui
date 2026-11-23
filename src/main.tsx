import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@cloudscape-design/global-styles/index.css";
import App from "./App";
import { accountSettings, setDefaultAccountId } from "./config";
import { NotifyProvider } from "./lib/notify";

// Learn floci's default account before the first render, so ARNs on the page use it.
// Do not wait long: without an answer, the console assumes 000000000000.
Promise.race([accountSettings().then((s) => setDefaultAccountId(s.defaultAccountId)), new Promise((r) => setTimeout(r, 1500))]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <NotifyProvider>
          <App />
        </NotifyProvider>
      </BrowserRouter>
    </StrictMode>,
  ),
);
