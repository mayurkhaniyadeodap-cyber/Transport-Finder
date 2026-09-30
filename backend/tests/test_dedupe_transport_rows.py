"""Unit tests for the single shared deduplication function every search path (pincode/city/state/
city+state, /api/transport/list, Transporter Management) funnels through via excel_search._rows().
No fixtures/HTTP needed -- this tests the pure function directly."""
from app.schemas import TransportResult
from app.services.excel_search import dedupe_transport_rows


def _row(name, city="Rajkot", pincode="360003", mobile=None, status="Active", override_id=None):
    return TransportResult(
        transport_name=name, city=city, state="Gujarat", pincode=pincode,
        contact_number=mobile, status=status, override_id=override_id,
    )


def test_same_name_multiple_pincodes_combine_into_one_row_sorted_ascending():
    rows = [
        _row("Aakash Roadways", pincode="395001"),
        _row("Aakash Roadways", pincode="394107"),
        _row("Aakash Roadways", pincode="394210"),
    ]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].transport_name == "Aakash Roadways"
    assert out[0].pincode == "394107, 394210, 395001"


def test_case_spacing_and_punctuation_differences_are_ignored():
    rows = [
        _row("TCI Express", pincode="360001"),
        _row("tci  express", pincode="360002"),   # different case, double space
        _row("TCI-EXPRESS", pincode="360003"),    # hyphen instead of space
        _row("TCI_Express", pincode="360004"),    # underscore instead of space
    ]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].pincode == "360001, 360002, 360003, 360004"


def test_manually_overridden_name_with_different_spacing_still_merges():
    # The exact bug this guards against: an override's transport_name is stored as the user typed
    # it (never run through normalize_transport()), so it can differ in case/spacing from the
    # display name every source itself already normalises.
    rows = [
        _row("Kishan Travels", pincode="364001"),          # from the real source, already normalised
        _row("kishan   travels", pincode="364099", override_id=7),  # a manual rename, typed loosely
    ]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].pincode == "364001, 364099"


def test_similar_but_genuinely_different_names_are_never_merged():
    # Different word counts -> never merged, regardless of how similar they look (and neither pair
    # is in the approved synonyms file, so this doesn't depend on that either).
    rows = [_row("Kishan"), _row("Kishan Travels"), _row("Kishan Driver: Bhavesh Bhai"),
            _row("Patel Transport"), _row("Patel Transport Co")]
    out = dedupe_transport_rows(rows)
    assert {r.transport_name for r in out} == {
        "Kishan", "Kishan Travels", "Kishan Driver: Bhavesh Bhai", "Patel Transport", "Patel Transport Co",
    }
    assert len(out) == 5


# ---------- known spelling-variant merges (approved India-wide audit, data/transporter_synonyms.csv) ----------

def test_known_synonym_variants_merge_under_the_canonical_name():
    rows = [_row("Blueadart", pincode="360001"), _row("Bluedart", pincode="360002")]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].transport_name == "Bluedart"  # the canonical spelling, not whichever row came first
    assert out[0].pincode == "360001, 360002"


def test_synonym_match_is_case_and_spacing_insensitive_too():
    rows = [_row("akash   roadways", pincode="360001"), _row("Aakash Roadways", pincode="360002")]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].transport_name == "Aakash Roadways"
    assert out[0].pincode == "360001, 360002"


def test_kishan_and_kishna_are_a_confirmed_synonym_but_kishan_travels_is_not():
    rows = [_row("Kishan", pincode="360001"), _row("Kishna", pincode="360002"), _row("Kishan Travels", pincode="360003")]
    out = dedupe_transport_rows(rows)
    names = {r.transport_name for r in out}
    assert names == {"Kishan", "Kishan Travels"}
    kishan = next(r for r in out if r.transport_name == "Kishan")
    assert kishan.pincode == "360001, 360002"


def test_first_row_wins_for_city_mobile_and_status():
    rows = [
        _row("TCI Express", city="Rajkot", pincode="360001", mobile="9111111111", status="Active"),
        _row("TCI Express", city="Surat", pincode="395001", mobile="9222222222", status="Not Active"),
    ]
    out = dedupe_transport_rows(rows)
    assert len(out) == 1
    assert out[0].city == "Rajkot" and out[0].contact_number == "9111111111" and out[0].status == "Active"
    assert out[0].pincode == "360001, 395001"


def test_result_is_sorted_by_transport_name():
    rows = [_row("VRL Logistics"), _row("Aakash Roadways", pincode="360004"), _row("Kishan Travels", pincode="360005")]
    out = dedupe_transport_rows(rows)
    assert [r.transport_name for r in out] == ["Aakash Roadways", "Kishan Travels", "VRL Logistics"]


def test_blank_pincode_does_not_produce_a_stray_leading_comma():
    rows = [_row("Aakash Roadways", pincode=None), _row("Aakash Roadways", pincode="360001")]
    out = dedupe_transport_rows(rows)
    assert out[0].pincode == "360001"


def test_empty_input_returns_empty_list():
    assert dedupe_transport_rows([]) == []
