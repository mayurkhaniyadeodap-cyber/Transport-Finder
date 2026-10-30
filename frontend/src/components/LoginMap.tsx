import { INDIA_STATES, INDIA_VIEWBOX } from "./indiaMapData";

// The login page's background: India, with one truck driving out of Gujarat to a different state on
// each trip. A picture only, not real shipments. Trips take turns inside one repeating cycle, so
// exactly one truck is on the map at a time.

const ORIGIN = "gj";
const DESTINATIONS = ["dl", "wb", "mh", "as", "ka", "up", "tn"];
const TRIP_SECONDS = 4;
const AMBER = "#f5b942";

const state = (id: string) => INDIA_STATES.find((s) => s.id === id)!;

/** A gentle curve from Gujarat to a state's middle. */
function routePath(id: string): string {
  const [x1, y1] = state(ORIGIN).c;
  const [x2, y2] = state(id).c;
  const bend = 0.16;
  const cx = (x1 + x2) / 2 + (y2 - y1) * bend;
  const cy = (y1 + y2) / 2 - (x2 - x1) * bend;
  return `M${x1} ${y1}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`;
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** When trip `i` of `n` starts, arrives and ends, as fractions of the whole cycle. */
function tripTimes(i: number, n: number) {
  const start = (i + 0.002) / n;
  return { start, shown: start + 0.04 / n, arrive: (i + 0.78) / n, end: (i + 0.96) / n, gone: (i + 0.998) / n };
}

function Trip({ id, index, total }: { id: string; index: number; total: number }) {
  const d = routePath(id);
  const { start, shown, arrive, end, gone } = tripTimes(index, total);
  const dur = `${total * TRIP_SECONDS}s`;
  // Everything clears at the end of the trip (end -> gone), then holds, ready for the next one.
  const keyTimes = `0;${start};${arrive};${end};${gone};1`;
  const fade = `0;${start};${shown};${arrive};${gone};1`;
  return (
    <>
      <path d={state(id).d} fill={AMBER} opacity="0">
        <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values="0;0;0.4;0.4;0;0"
                 keyTimes={`0;${arrive};${(arrive + end) / 2};${end};${gone};1`} />
      </path>
      <path d={d} fill="none" stroke={AMBER} strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1">
        <animate attributeName="stroke-dashoffset" dur={dur} repeatCount="indefinite" values="1;1;0;0;1;1" keyTimes={keyTimes} calcMode="linear" />
      </path>
      <g opacity="0">
        <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes={fade} />
        <animateMotion dur={dur} repeatCount="indefinite" path={d} rotate="auto" calcMode="linear" keyTimes={keyTimes} keyPoints="0;0;1;1;1;1" />
        <g transform="translate(-13 -8)">
          <rect x="0" y="0" width="17" height="13" rx="2" fill="#38bdf8" />
          <path d="M17 4h5l4 4v5h-9z" fill="#bae6fd" />
          <circle cx="6" cy="14" r="2.6" fill="#e6edf7" />
          <circle cx="20" cy="14" r="2.6" fill="#e6edf7" />
        </g>
      </g>
    </>
  );
}

export default function LoginMap() {
  const origin = state(ORIGIN);
  const still = reducedMotion();
  return (
    <svg className="loginmap" viewBox={INDIA_VIEWBOX} preserveAspectRatio="xMaxYMid meet" aria-hidden="true" focusable="false">
      {INDIA_STATES.map((s) => (
        <path key={s.id} d={s.d} fill="#1e3050" stroke="#4a6290" strokeWidth="0.7" strokeLinejoin="round" />
      ))}
      <path d={origin.d} fill={AMBER} fillOpacity="0.28" stroke={AMBER} strokeWidth="1.2" strokeLinejoin="round" />
      {DESTINATIONS.map((id) => (
        <g key={id}>
          <path d={routePath(id)} fill="none" stroke="#7d93b8" strokeWidth="1" strokeDasharray="3 5" strokeLinecap="round" />
          <circle cx={state(id).c[0]} cy={state(id).c[1]} r="3.5" fill={AMBER} />
        </g>
      ))}
      <circle cx={origin.c[0]} cy={origin.c[1]} r="5" fill={AMBER} />
      {!still && DESTINATIONS.map((id, i) => <Trip key={id} id={id} index={i} total={DESTINATIONS.length} />)}
    </svg>
  );
}
