import type { ReactNode } from "react";
import { deriveTransportType } from "../searchDefaults";
import type { SearchResponse, TransportResult } from "../services/api";
import { CompactList, PINCODE_PREVIEW, PincodeSummary, splitPincodes } from "./CityList";
import {
  ArrowLeftIcon, ArrowRightIcon, CityIcon, EmptyIcon, GridIcon, HashIcon, LocationPinIcon, PhoneIcon, TableIcon, UserIcon,
} from "./Icons";
import { Avatar, Pagination, StatusBadge, TypeChip } from "./ui";

const NA = "Not Available";

export type ResultsViewMode = "cards" | "table";

interface Props {
  data: SearchResponse;
  page: number;
  onPageChange: (page: number) => void;
  view: ResultsViewMode;
  onViewChange: (view: ResultsViewMode) => void;
  onViewDetails: (row: TransportResult) => void;
  summary?: ReactNode; // stat tiles, shown between the header and the results
  onBack?: () => void;
}

/** One line describing what was matched, e.g. "Showing transporters in Rajkot". */
function levelText({ search, match_level }: SearchResponse): string {
  const fallback = search.pincode && match_level && match_level !== "pincode" ? " · no exact pincode match" : "";
  switch (match_level) {
    case "pincode":
      return `Showing transporters for pincode ${search.pincode}`;
    case "city_state":
      return `Showing transporters in ${[search.city, search.state].filter(Boolean).join(", ")}${fallback}`;
    case "state":
      return `Showing transporters across ${search.state}${fallback}`;
    case "transporter":
      return `Showing ${search.transport_name}`;
    default:
      return "";
  }
}

function PincodeChips({ value }: { value: string | null }) {
  const pins = splitPincodes(value);
  if (!pins.length) return <span className="na">{NA}</span>;
  const extra = pins.length - PINCODE_PREVIEW;
  return (
    <span className="chip-row" title={pins.join(", ")}>
      {pins.slice(0, PINCODE_PREVIEW).map((p) => (
        <span key={p} className="pin-chip">{p}</span>
      ))}
      {extra > 0 && <span className="more-chip">+{extra} more</span>}
    </span>
  );
}

function ResultCard({ row, onViewDetails }: { row: TransportResult; onViewDetails: (row: TransportResult) => void }) {
  return (
    <article className="result-card">
      <div className="result-card-top">
        <Avatar name={row.transport_name} photoUrl={row.photo_url} />
        <div className="result-card-title">
          <h3 className="result-card-name" title={row.transport_name}>{row.transport_name}</h3>
          <TypeChip name={row.transport_name} />
        </div>
        <StatusBadge status={row.status} />
      </div>

      <dl className="result-card-facts">
        <div title="Service Cities">
          <dt><CityIcon size={16} /><span className="sr-only">Service Cities</span></dt>
          <dd><CompactList items={row.service_cities} /></dd>
        </div>
        <div title="Pincode">
          <dt><HashIcon size={16} /><span className="sr-only">Pincode</span></dt>
          <dd><PincodeChips value={row.pincode} /></dd>
        </div>
        <div title="Mobile">
          <dt><PhoneIcon size={16} /><span className="sr-only">Mobile</span></dt>
          <dd className={row.contact_number ? "mobile-strong" : "na"}>{row.contact_number || NA}</dd>
        </div>
      </dl>

      <div className="result-card-foot">
        <button type="button" className="btn btn-soft" onClick={() => onViewDetails(row)}>
          <UserIcon size={16} /> View Profile <ArrowRightIcon size={16} />
        </button>
      </div>
    </article>
  );
}

export default function SearchResults({ data, page, onPageChange, view, onViewChange, onViewDetails, summary, onBack }: Props) {
  const { results, message } = data;
  const total = data.total ?? results.length;
  const totalPages = data.total_pages ?? 1;
  const pageSize = data.page_size ?? results.length;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;

  if (total === 0) {
    return (
      <section className="card state-card" id="results" role="status">
        <span className="state-icon">
          <EmptyIcon size={30} />
        </span>
        <h3>No transporters found</h3>
        <p>{message && !/no transporters/i.test(message) ? message : "Try a different pincode, city, state or transporter name."}</p>
        {onBack && (
          <button type="button" className="btn btn-primary" onClick={onBack}>
            <ArrowLeftIcon size={16} /> Back to search
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="results" id="results" aria-labelledby="results-title">
      <header className="results-head">
        <div>
          <h2 id="results-title">
            {total} transporter{total === 1 ? "" : "s"} found
          </h2>
          <p className="results-sub">
            <LocationPinIcon size={16} />
            {levelText(data)}
          </p>
        </div>
        <div className="segmented view-toggle" role="group" aria-label="Results view">
          <button type="button" aria-pressed={view === "cards"} className={`segmented-btn ${view === "cards" ? "active" : ""}`} onClick={() => onViewChange("cards")}>
            <GridIcon size={16} /> Cards
          </button>
          <button type="button" aria-pressed={view === "table"} className={`segmented-btn ${view === "table" ? "active" : ""}`} onClick={() => onViewChange("table")}>
            <TableIcon size={16} /> Table
          </button>
        </div>
      </header>

      {summary}

      {view === "cards" ? (
        <div className="result-grid">
          {results.map((r, i) => (
            <ResultCard key={`${r.city}-${r.transport_name}-${r.pincode}-${i}`} row={r} onViewDetails={onViewDetails} />
          ))}
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Transport results table">
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Transporter</th>
                  <th scope="col">Service Cities</th>
                  <th scope="col">Pincode</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Status</th>
                  <th scope="col">Transport Type</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={`${r.city}-${r.transport_name}-${r.pincode}-${i}`}>
                    <td className="row-index">{rangeStart + i}</td>
                    <td>
                      <span className="transport-cell">
                        <Avatar name={r.transport_name} size="sm" photoUrl={r.photo_url} />
                        <span className="transport-name">{r.transport_name}</span>
                      </span>
                    </td>
                    <td className="city wrap-cell">
                      <CompactList items={r.service_cities} />
                    </td>
                    <td className={r.pincode ? "pin wrap-cell" : "na"}><PincodeSummary pins={splitPincodes(r.pincode)} /></td>
                    <td className={r.contact_number ? "mobile" : "na"}>{r.contact_number || NA}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="muted">{deriveTransportType(r.transport_name)}</td>
                    <td className="cell-actions">
                      <button type="button" className="btn btn-soft btn-sm" onClick={() => onViewDetails(r)}>
                        View Profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {message && <p className="foot-note">{message}</p>}
      <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={onPageChange} />
    </section>
  );
}
