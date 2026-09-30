import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, loadTheme } from "./theme";
import "./styles.css";

applyTheme(loadTheme()); // before the first render, so a saved Dark theme never flashes light

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
