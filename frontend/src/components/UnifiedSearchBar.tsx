import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { suggestTransport, Suggestion, SuggestionType } from "../services/api";
import { ArrowRightIcon, SearchIcon } from "./Icons";

// Popular searches: what's searched, and how the chip reads.
const POPULAR: { term: string; label: string }[] = [
  { term: "360001", label: "Rajkot · 360001" },
  { term: "380009", label: "Ahmedabad · 380009" },
  { term: "395001", label: "Surat · 395001" },
  { term: "Mumbai", label: "Mumbai" },
  { term: "TCI Express", label: "TCI Express" },
];

const TYPE_LABEL: Record<SuggestionType, string> = {
  pincode: "Pincode",
  city: "City",
  state: "State",
  transporter: "Transporter",
};

interface Props {
  value: string;
  loading: boolean;
  onChange: (v: string) => void;
  onSearch: () => void;
  onQuickPick: (term: string) => void;
  onSuggestionPick: (s: Suggestion) => void;
  // The value it mounts with was already searched, so don't open suggestions for it until the
  // user types again.
  valueAlreadySearched?: boolean;
}

/** One free-text box for Pincode/City/State/Transporter Name, with real-data autocomplete -- see
 * searchUnified()/searchByType() in searchDefaults.ts for how a value is routed to the existing
 * search API (free text guesses the type; picking a suggestion already knows it). */
export default function UnifiedSearchBar({ value, loading, onChange, onSearch, onQuickPick, onSuggestionPick, valueAlreadySearched }: Props) {
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
    <div className="searchbox" ref={boxRef}>
      <form className="searchline" onSubmit={submit} role="search" aria-label="Search transporters">
        <div className="searchwrap">
          <span className="searchglass"><SearchIcon size={18} /></span>
          <input
            className="searchinput"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder="Try 360001, Rajkot, Gujarat or TCI Express"
            aria-label="Pincode, city, state or transporter name"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {open && suggestions.length > 0 && (
            <ul className="suggest" role="listbox" aria-label="Suggestions">
              {suggestions.map((s, i) => (
                <li key={`${s.type}-${s.value}`} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    className={i === highlight ? "active" : ""}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the input so blur doesn't close this first
                    onClick={() => pick(s)}
                  >
                    <span className="value">{s.value}</span>
                    <span className="tag">{TYPE_LABEL[s.type]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
          {loading ? "Searching…" : <>Search results <ArrowRightIcon size={16} /></>}
        </button>
      </form>

      {touched && !value.trim() && <p className="search-hint">Enter a pincode, city, state or transporter name.</p>}

      <div className="popular">
        <b>Popular:</b>
        {POPULAR.map(({ term, label }) => (
          <button key={term} type="button" onClick={() => quickPick(term)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
