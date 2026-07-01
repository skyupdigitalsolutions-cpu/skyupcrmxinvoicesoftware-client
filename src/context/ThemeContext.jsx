import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext();

const DEFAULT_BRANDING = {
  companyName:    "Skyupcrm",
  logo:           "/sole-stride-logo.svg",
  favicon:        "/favicon.svg",
  primaryColor:   "#2563EB",
  secondaryColor: "#1E40AF",
};

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(
    () => localStorage.getItem("theme") === "dark"
  );

  // Static branding — no API call. Swap DEFAULT_BRANDING values here if needed.
  const [branding] = useState(DEFAULT_BRANDING);

  // ── Apply dark/light class ─────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  // ── Apply CSS custom properties whenever branding changes ─────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--primary", branding.primaryColor);
    document.documentElement.style.setProperty("--secondary", branding.secondaryColor);
    const favicon = document.querySelector("link[rel='icon']");
    if (favicon) favicon.href = branding.favicon || "/favicon.svg";
  }, [branding]);

  const toggle = () => setDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ dark, toggle, branding }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
