import { useTheme } from "../theme";
import { MoonIcon, SunIcon } from "./Icons";

/** The top bar's Light/Dark switch. Shares its state with Settings > Appearance (see theme.ts). */
export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const toDark = resolved === "light";
  const label = toDark ? "Switch to dark theme" : "Switch to light theme";
  return (
    <button type="button" className="iconbtn" aria-label={label} title={label} onClick={() => setTheme(toDark ? "dark" : "light")}>
      {toDark ? <MoonIcon size={16} /> : <SunIcon size={16} />}
      <span className="sr-only">{toDark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
