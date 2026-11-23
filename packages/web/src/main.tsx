import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ToastProvider } from "./components/Toasts";

const container = document.getElementById("root");
if (!container) throw new Error("Brak elementu #root w index.html");

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
