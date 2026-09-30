import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { suggestTransport, Suggestion, SuggestionType } from "../services/api";
import { CityIcon, PincodeIcon, SearchIcon, StateIcon, TruckBadgeIcon } from "./Icons";

const POPULAR = ["360003", "Rajkot", "Ahmedabad", "Gujarat", "Mumbai"];

const TYPE_META: Record<SuggestionType, { label: string; icon: typeof PincodeIcon }> = {
  pincode: { label: "Pincode", icon: PincodeIcon },
  city: { label: "City", icon: CityIcon },
  state: { label: "State", icon: StateIcon },
  transporter: { label: "Transporter", icon: TruckBadgeIcon },
};

interface Props {
  value: string;
  loading: boolean;
  onChange: (v: string) => void;
  onSearch: () => void;
  onQuickPick: (term: string) => void;
  onSuggestionPick: (s: Suggestion) => void;
  compact?: boolean; // slim bar above results: no Popular tags, shorter button
  // The value it mounts with was already searched (the hero and the results bar swap on search),
  // so don't open suggestions for it until the user types again.
  valueAlreadySearched?: boolean;
}

/** One free-text box for Pincode/City/State/Transporter Name, with real-data autocomplete -- see
 * searchUnified()/searchByType() in searchDefaults.ts for how a value is routed to the existing
 * search API (free text guesses the type; picking a suggestion already knows it). */
export default function UnifiedSearchBar({ value, loading, onChange, onSearch, onQuickPick, onSuggestionPick, compact, valueAlreadySearched }: Props) {
  const [touched, setTouched] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // A value that was just picked/searched (not typed) -- don't re-suggest for it, or the list would
  // pop back open over the results once that (slower) request returns.
  const settledValue = useRef<string | null>(valueAlreadySearched ? value || null : null);

  // Debounced fetch of real suggestions as the user types.
  useEffect(() => {
    const q = value.trim();
    if (!q || value === settledValue.current) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    settledValue.current = null; // the user is typing again
    let cancelled = false;
    const timer = setTimeout(() => {
      suggestTransport(q).then((results) => {
        // Also drop it if the user picked/searched while this request was still in flight.
        if (cancelled || settledValue.current !== null) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlight(-1);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const onOutsideClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  const pick = (s: Suggestion) => {
    settledValue.current = s.value;
    setOpen(false);
    setSuggestions([]);
    onSuggestionPick(s);
  };

  const quickPick = (term: string) => {
    settledValue.current = term;
    setOpen(false);
    onQuickPick(term);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (open && highlight >= 0 && suggestions[highlight]) {
      pick(suggestions[highlight]);
      return;
    }
    settledValue.current = value;
    setOpen(false);
    if (value.trim()) onSearch();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div className={`unified-search ${compact ? "compact" : ""}`} ref={boxRef}>
      <div className="unified-search-field">
        <form className="unified-search-box" onSubmit={submit} role="search" aria-label="Search transporters">
          <span className="unified-search-icon">
            <SearchIcon />
          </span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Enter pincode, city, state or transporter name"
            aria-label="Pincode, city, state or transporter name"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <span className="spinner spinner-sm" aria-hidden="true" /> : <SearchIcon size={18} />}
            <span className="btn-text">{loading ? "Searching…" : compact ? "Search" : "Search Transport"}</span>
          </button>
        </form>

        {open && suggestions.length > 0 && (
          <ul className="suggest-list" role="listbox" aria-label="Suggestions">
            {suggestions.map((s, i) => {
              const meta = TYPE_META[s.type];
              const Icon = meta.icon;
              return (
                <li key={`${s.type}-${s.value}`} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    className={`suggest-item ${i === highlight ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the input so blur doesn't close this first
                    onClick={() => pick(s)}
                  >
                    <span className="suggest-icon">
                      <Icon size={16} />
                    </span>
                    <span className="suggest-value">{s.value}</span>
                    <span className="suggest-type">{meta.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {touched && !value.trim() && (
        <p className="unified-search-hint error">Enter a pincode, city, state or transporter name.</p>
      )}

      {!compact && (
        <div className="popular-searches">
          <span className="popular-searches-label">Popular Searches:</span>
          {POPULAR.map((term) => (
            <button key={term} type="button" className="popular-tag" onClick={() => quickPick(term)}>
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
