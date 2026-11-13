import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installTv } from "./lib/tv";
import "./index.css";

installTv();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
