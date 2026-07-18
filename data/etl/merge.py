"""Stage 2: merge per-source records for one plant into a single working
record. Source priority order = the table in data/CLAUDE.md, top to bottom
(requirement 1). "Fill when empty" + "keep all values when multiple
sources disagree" (requirements 2+3) are really the same rule: every field
collects ALL distinct non-null values across sources, in priority order.
If that list has exactly one entry, it's unambiguous and gets used as-is
later with no LLM call needed; more than one is a real conflict for Ollama
(stage 3) to resolve.
"""

from dataclasses import dataclass, field

# Priority order = data/CLAUDE.md's Data sources table, top to bottom.
SOURCE_PRIORITY = [
    "openfarm-crops-rescue",
    "homesteader-labs",
    "permapeople",
    "usda-plants",
    "wikipedia-companion-plants",
    "trefle",
]

SCALAR_FIELDS = [
    "common_name", "botanical_name", "description", "sowing_method",
    "spread_cm", "row_spacing_cm", "height_cm", "sun_level", "soil_type",
    "composting_needs", "fertilizer_needs", "needs_wind_cover",
    "needs_rain_cover", "water_needs", "family", "genus",
    "min_temperature_c", "max_temperature_c", "days_to_maturity",
    "soil_ph_min", "soil_ph_max", "is_toxic", "toxicity_notes", "is_edible",
    "succession_enabled", "succession_interval_days", "succession_max_sowings",
]
LIST_FIELDS = ["companions", "periods", "pest_interactions", "bedding_needs", "edible_parts"]


@dataclass
class SourceRecord:
    source: str
    source_url: str
    data: dict


@dataclass
class FieldCandidates:
    values: list[tuple] = field(default_factory=list)  # [(value, source), ...]

    def add(self, value, source: str) -> None:
        if value is None:
            return
        for existing_value, _ in self.values:
            if existing_value == value:
                return  # exact duplicate, don't list the same value twice
        self.values.append((value, source))

    @property
    def is_unambiguous(self) -> bool:
        return len(self.values) <= 1

    @property
    def single_value(self):
        return self.values[0][0] if self.values else None


@dataclass
class WorkingRecord:
    slug: str
    scalars: dict[str, FieldCandidates]
    companions: dict[str, list[dict]]  # keyed by companion_slug
    pest_interactions: dict[str, list[dict]]  # keyed by pest_or_insect (lowercased)
    periods: dict[str, list[dict]]  # keyed by period_type
    bedding_needs: dict[str, list[dict]]  # keyed by need_type
    edible_parts: FieldCandidates
    sources_used: set[str]


def _priority_sort(records: list[SourceRecord]) -> list[SourceRecord]:
    def key(r: SourceRecord) -> int:
        try:
            return SOURCE_PRIORITY.index(r.source)
        except ValueError:
            return len(SOURCE_PRIORITY)  # unknown sources sort last

    return sorted(records, key=key)


def merge_plant(slug: str, records: list[SourceRecord]) -> WorkingRecord:
    records = _priority_sort(records)

    scalars = {f: FieldCandidates() for f in SCALAR_FIELDS}
    companions: dict[str, list[dict]] = {}
    pest_interactions: dict[str, list[dict]] = {}
    periods: dict[str, list[dict]] = {}
    bedding_needs: dict[str, list[dict]] = {}
    edible_parts = FieldCandidates()
    sources_used: set[str] = set()

    for rec in records:
        d = rec.data
        has_any = False
        for field_name in SCALAR_FIELDS:
            if field_name in d and d[field_name] is not None:
                scalars[field_name].add(d[field_name], rec.source)
                has_any = True

        for c in d.get("companions", []):
            key = c["companion_slug"] if "companion_slug" in c else c.get("companion_slug_hint")
            if not key:
                continue
            companions.setdefault(key, []).append({**c, "_source": rec.source})
            has_any = True

        for p in d.get("pest_interactions", []):
            key = p.get("pest_or_insect", "").strip().lower()
            if not key:
                continue
            pest_interactions.setdefault(key, []).append({**p, "_source": rec.source})
            has_any = True

        for p in d.get("periods", []):
            key = p.get("period_type")
            if not key:
                continue
            periods.setdefault(key, []).append({**p, "_source": rec.source})
            has_any = True

        for b in d.get("bedding_needs", []):
            key = b.get("need_type")
            if not key:
                continue
            bedding_needs.setdefault(key, []).append({**b, "_source": rec.source})
            has_any = True

        if d.get("edible_parts"):
            edible_parts.add(tuple(sorted(d["edible_parts"])), rec.source)
            has_any = True

        if has_any:
            sources_used.add(rec.source)

    return WorkingRecord(
        slug=slug,
        scalars=scalars,
        companions=companions,
        pest_interactions=pest_interactions,
        periods=periods,
        bedding_needs=bedding_needs,
        edible_parts=edible_parts,
        sources_used=sources_used,
    )
