import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@cloudscape-design/global-styles/index.css";
import App from "./App";
import { dropRejectedAccount } from "./components/AccountMenu";
import { accountSettings, getSelectedAccount, setDefaultAccountId } from "./config";
import { NotifyProvider } from "./lib/notify";

// Before the first render: learn floci's default account, so ARNs on the page use it, and check
// that floci still accepts the saved account. If it does not, go back to the default account.
// Do not wait long: without an answer, the console assumes 000000000000 and keeps the saved account.
const saved = getSelectedAccount();
const ready = Promise.all([
  accountSettings().then((s) => setDefaultAccountId(s.defaultAccountId)),
  saved ? dropRejectedAccount(saved) : false,
]).then(([, reloading]) => reloading);
Promise.race([ready, new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]).then((reloading) =>
  reloading ? undefined : createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <NotifyProvider>
          <App />
        </NotifyProvider>
      </BrowserRouter>
    </StrictMode>,
  ),
);
