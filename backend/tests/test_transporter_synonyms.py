"""Unit tests for transporter_synonyms.py: the approved India-wide spelling-variation merge table
(data/transporter_synonyms.csv), used by excel_search.dedupe_transport_rows()."""
from app.services import transporter_synonyms as ts


def write_synonyms(path, *rows, header="variant_name,canonical_name"):
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")


def test_real_synonyms_file_is_used_by_default():
    assert ts.SYNONYMS_CSV_PATH == ts.SYNONYMS_CSV_PATH.__class__(
        r"C:\wherehous_tool\Transport Finder\data\transporter_synonyms.csv"
    )


def test_real_file_maps_known_approved_variants_to_their_canonical_name():
    table = ts._load_synonyms(ts.SYNONYMS_CSV_PATH)
    assert table[ts.key("Blueadart")] == "Bluedart"
    assert table[ts.key("Akash Roadways")] == "Aakash Roadways"
    assert table[ts.key("Indian Post")] == "India Post"
    assert table[ts.key("Pavan Parcle Service")] == "Pavan Parcel Service"
    assert table[ts.key("Jalaram Trasnport")] == "Jalaram Transport"
    assert table[ts.key("Jai Ganesh Transport")] == "Jay Ganesh Transport"
    assert table[ts.key("Kishna")] == "Kishan"


def test_real_file_never_lists_the_explicitly_excluded_pairs():
    table = ts._load_synonyms(ts.SYNONYMS_CSV_PATH)
    # "Kishan Travels" and "Patel Transport Co" must never appear as variants of anything --
    # different word counts, never a typo per the approved audit.
    assert ts.key("Kishan Travels") not in table
    assert ts.key("Patel Transport") not in table
    assert ts.key("Patel Transport Co") not in table


def test_canonical_name_returns_the_mapped_name_for_a_known_variant(tmp_path):
    path = tmp_path / "synonyms.csv"
    write_synonyms(path, "Blueadart,Bluedart")
    table = ts._load_synonyms(path)
    assert table[ts.key("Blueadart")] == "Bluedart"


def test_canonical_name_is_case_and_spacing_insensitive(tmp_path, monkeypatch):
    path = tmp_path / "synonyms.csv"
    write_synonyms(path, "Akash Roadways,Aakash Roadways")
    monkeypatch.setattr(ts, "_SYNONYMS", ts._load_synonyms(path))
    assert ts.canonical_name("akash roadways") == "Aakash Roadways"
    assert ts.canonical_name("AKASH-ROADWAYS") == "Aakash Roadways"
    assert ts.canonical_name("  Akash   Roadways  ") == "Aakash Roadways"


def test_canonical_name_passes_through_unknown_names_unchanged(tmp_path, monkeypatch):
    path = tmp_path / "synonyms.csv"
    write_synonyms(path, "Blueadart,Bluedart")
    monkeypatch.setattr(ts, "_SYNONYMS", ts._load_synonyms(path))
    assert ts.canonical_name("Totally Unrelated Transporter") == "Totally Unrelated Transporter"
    assert ts.canonical_name("Bluedart") == "Bluedart"  # already canonical -> unchanged


def test_missing_synonyms_file_yields_no_merges_rather_than_guessing(tmp_path):
    assert ts._load_synonyms(tmp_path / "does_not_exist.csv") == {}
