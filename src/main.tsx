import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@cloudscape-design/global-styles/index.css";
import App from "./App";
import { NotifyProvider } from "./lib/notify";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <NotifyProvider>
        <App />
      </NotifyProvider>
    </BrowserRouter>
  </StrictMode>,
);
