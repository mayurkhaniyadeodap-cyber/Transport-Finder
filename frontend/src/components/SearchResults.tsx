import type { ReactNode } from "react";
import type { SearchResponse, TransportResult } from "../services/api";
import { CompactList, formatCharge, PincodeSummary, splitPincodes } from "./CityList";
import { ArrowLeftIcon, EmptyIcon, GridIcon, RowsIcon } from "./Icons";
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

/** What was matched, e.g. "Rajkot" or "pincode 360001". */
export function matchedPlace({ search, match_level }: SearchResponse): string {
  switch (match_level) {
    case "pincode":
      return `pincode ${search.pincode}`;
    case "city_state":
      return [search.city, search.state].filter(Boolean).join(", ");
    case "state":
      return search.state ?? "";
    case "transporter":
      return search.transport_name ?? "";
    default:
      return search.pincode || search.city || search.state || search.transport_name || "";
  }
}

/** One line describing how it was matched. */
function levelText({ search, match_level }: SearchResponse): string {
  const fallback = search.pincode && match_level && match_level !== "pincode" ? " · no exact pincode match" : "";
  switch (match_level) {
    case "pincode":
      return "Exact pincode match";
    case "city_state":
      return `City match${fallback}`;
    case "state":
      return `State-wide match${fallback}`;
    case "transporter":
      return "Transporter name match";
    default:
      return "";
  }
}

function ResultCard({ row, onViewDetails }: { row: TransportResult; onViewDetails: (row: TransportResult) => void }) {
  const cities = row.service_cities ?? [];
  const pins = splitPincodes(row.pincode);
  const charge = formatCharge(row.shipment_charge);
  return (
    <article className="result">
      <div className="resulttop">
        <Avatar name={row.transport_name} photoUrl={row.photo_url} />
        <div>
          <h3 className="rname" title={row.transport_name}>{row.transport_name}</h3>
          <div className="rmeta">
            {cities.length} service {cities.length === 1 ? "city" : "cities"} · {pins.length} pincode{pins.length === 1 ? "" : "s"}
          </div>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="chips">
        <TypeChip name={row.transport_name} />
      </div>
      <dl className="details">
        <div className="detail">
          <dt>Contact number</dt>
          <dd className={row.contact_number ? "phone" : "na"}>{row.contact_number || NA}</dd>
        </div>
        <div className="detail">
          <dt>Pincode coverage</dt>
          <dd><PincodeSummary pins={pins} /></dd>
        </div>
        <div className="detail">
          <dt>Service Cities</dt>
          <dd><CompactList items={cities} /></dd>
        </div>
        <div className="detail">
          <dt>Shipment charge / box</dt>
          <dd>{charge ? <>{charge} <span className="more">approx.</span></> : <span className="na">{NA}</span>}</dd>
        </div>
      </dl>
      <div className="resultbottom">
        <span className="charge">From order history</span>
        <button type="button" className="linkbtn" onClick={() => onViewDetails(row)}>
          View profile ↗
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

  if (total === 0) {
    return (
      <section className="panel empty" id="results" role="status">
        <span className="empty-icon"><EmptyIcon size={26} /></span>
        <h3>No transporters found</h3>
        <p>{message && !/no transporters/i.test(message) ? message : "Try a different pincode, city, state or transporter name."}</p>
        {onBack && (
          <button type="button" className="btn secondary" onClick={onBack}>
            <ArrowLeftIcon size={16} /> Back to search
          </button>
        )}
      </section>
    );
  }

  const place = matchedPlace(data);
  return (
    <section id="results" aria-labelledby="results-title">
      <div className="resulthead">
        <div>
          <h3 id="results-title">
            {total} transporter{total === 1 ? "" : "s"} found{place ? ` for ${place}` : ""}
          </h3>
          <p>{levelText(data)}{levelText(data) ? " · " : ""}Based on recorded shipments</p>
        </div>
        <div className="viewtoggle" role="group" aria-label="Results view">
          <button type="button" aria-pressed={view === "cards"} className={view === "cards" ? "active" : ""} onClick={() => onViewChange("cards")}>
            <GridIcon size={14} /> Cards
          </button>
          <button type="button" aria-pressed={view === "table"} className={view === "table" ? "active" : ""} onClick={() => onViewChange("table")}>
            <RowsIcon size={14} /> List
          </button>
        </div>
      </div>

      {summary}

      {view === "cards" ? (
        <div className="cards">
          {results.map((r, i) => (
            <ResultCard key={`${r.city}-${r.transport_name}-${r.pincode}-${i}`} row={r} onViewDetails={onViewDetails} />
          ))}
        </div>
      ) : (
        <div className="tablewrap" style={{ marginTop: 14 }} tabIndex={0} role="region" aria-label="Transport results table">
          {/* The dense List: a real table, with each cell's heading shown as a small label (CSS) */}
          <table className="data list-table">
            <thead className="sr-only">
              <tr>
                <th scope="col">Transporter</th>
                <th scope="col">Type</th>
                <th scope="col">Mobile</th>
                <th scope="col">Service Cities</th>
                <th scope="col">Pincodes</th>
                <th scope="col">Charge / box</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.city}-${r.transport_name}-${r.pincode}-${i}`}>
                  <td>
                    <span className="namecell">
                      <Avatar name={r.transport_name} size="sm" photoUrl={r.photo_url} />
                      <b>{r.transport_name}</b>
                    </span>
                  </td>
                  <td className="nowrap" data-label="Type"><TypeChip name={r.transport_name} /></td>
                  <td className={r.contact_number ? "phone nowrap" : "na nowrap"} data-label="Mobile">{r.contact_number || NA}</td>
                  <td data-label="Service Cities"><CompactList items={r.service_cities} /></td>
                  <td className="mono" data-label="Pincodes"><PincodeSummary pins={splitPincodes(r.pincode)} /></td>
                  <td className="nowrap" data-label="Charge / box">{formatCharge(r.shipment_charge) ?? <span className="na">{NA}</span>}</td>
                  <td data-label="Status"><StatusBadge status={r.status} /></td>
                  <td className="actions-cell">
                    <button type="button" className="linkbtn" aria-label="View profile" onClick={() => onViewDetails(r)}>
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {message && <p className="hint">{message}</p>}
      <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={onPageChange} />
    </section>
  );
}
