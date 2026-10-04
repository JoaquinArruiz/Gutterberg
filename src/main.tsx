import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "./lib/theme";
import { usePreferencesStore } from "./stores/preferences-store";

// Apply the saved theme before the first paint so there is no flash.
applyTheme(usePreferencesStore.getState().prefs.appearance.theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
