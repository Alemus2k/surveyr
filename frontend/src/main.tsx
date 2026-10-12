import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./layout/shell.css";
import "./panels/panels.css";
import "./viewer/viewer.css";
import "./slice/slice.css";
import "./appearance/appearance.css";
import "./compare/compare.css";
import "./charts/charts.css";
import "./jobsite/jobsite.css";
import "./site/site.css";
import "./control/control.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
