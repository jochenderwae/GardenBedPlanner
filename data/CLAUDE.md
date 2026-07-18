# CLAUDE.md — data

This directory is the home for the plant-database ETL: pulling data from external plant/crop databases, normalizing it into this project's own JSON format, and (eventually) importing that into Postgres. `plant.schema.json` is that JSON format (JSON Schema, one object per plant); `plant.example.json` is a worked example. Per-plant files will eventually live in `data/plants/<slug>.json`; the ETL scripts land here too as that work starts.

Related docs: `docs/domain-model.md` describes what fields a plant record needs; `docs/schema.md` has the target Postgres ER model (`PLANT`, `SEED_INFO`, `PLANT_PERIOD`, `PLANT_COMPANION`, `PLANT_BEDDING_NEED`, `PLANT_DATA_SOURCE`) that both the JSON format and the ETL's output are meant to line up with.

## Goal & plan

**Goal**: build a static plant database (base/reference data) that gets imported into Postgres (`Plant` + satellite tables — `SeedInfo`, `PlantPeriod`, `PlantCompanion`, `PlantBeddingNeed`, `PlantDataSource` — per `docs/schema.md`).

**Plan** (agreed order):
1. Build the `Plant`-cluster SQLModel models + Alembic migration, verify against real Postgres on `garden-planner-dev` (same pattern as the `Bed` migration).
2. Define the JSON format, shaped to mirror that Postgres schema closely so the ETL mapping is close to 1:1.
3. Gather sources (tracked in the table below, starting with `openfarm-crops-rescue`).
4. ETL: external sources → this project's JSON format, with an Ollama pass (running locally on this machine) for merge/cleanup — deliberately kept off Claude to avoid spending tokens on bulk data cleanup.
5. Import script that upserts the finished JSON into Postgres.

**Status**: step 1 done (`backend/app/models/plant.py` + `create_plant_tables` migration, pending verification against real Postgres on `garden-planner-dev`) and step 2 done (`data/plant.schema.json` + `data/plant.example.json`). Step 3 (sources) in progress below.

## Data sources

Candidate and confirmed sources to pull plant data from, kept here as they're found so attribution isn't lost by the time the ETL actually runs — every plant record needs a `PLANT_DATA_SOURCE` entry per the schema, and that has to trace back to something listed here.

| Source | URL | Covers | License / attribution | Status |
|---|---|---|---|---|
| openfarm-crops-rescue | https://github.com/thefullnacho/openfarm-crops-rescue | data structure reference (see `docs/domain-model.md`) and basic overall data | CC0 1.0 Universal | candidate |
| Homesteader Labs' Crop Knowledge Base | https://github.com/thefullnacho/homesteader-labs-next/tree/master/content/crops | botanical names, sun, spacing, sowing methods | public domain | candidate |
| Permapeople | https://permapeople.org/api | broad plant database including companion planting | CC BY-SA 4.0 | candidate |
| USDA PLANTS Database | https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt | authoritative for taxonomy/family classification, which is exactly what you need for rotation-family logic. Weak on cultivation specifics like spacing or companion planting though | public domain | candidate |
| Wikipedia's "List of companion plants" | https://en.wikipedia.org/wiki/List_of_companion_plants | genuinely well-structured for companion pairs specifically, useful as a cross-check rather than a bulk scrape | CC BY-SA | candidate |
| Trefle | https://trefle.io/api/v1 | usefulness to be confirmed | ? | candidate |
| Project Gutenberg (7 old gardening books, one section per plant) | see the book-by-book table in the `growing_information` section below | long-form growing advice text - candidate for filling `composting_needs`/`fertilizer_needs`/`needs_wind_cover`/`needs_rain_cover`/`seed_info.pretreatment`/`bedding_needs` (see below), none of which any structured source covers | public domain in the US per Project Gutenberg's own license (see note below - don't trust a book's own original publisher copyright notice) | candidate - no fetcher built yet |

## Source → schema coverage analysis

Cross-referenced the sources above (their actual API docs / repo contents, not just guesses) against `plant.schema.json`'s field list. This is what justified the second wave of fields added to `Plant`/`PlantCompanion` and the new `PlantPestInteraction` table (see `docs/schema.md`'s "Modeling decisions worth revisiting" for the migration that added them) - kept here so the reasoning isn't lost.

| Our field | Covered by | Notes |
|---|---|---|
| `common_name`, `botanical_name` | All sources | |
| `description` | openfarm, Homesteader, Permapeople, Trefle | |
| `sowing_method` | openfarm (`sowingMethod`), Trefle (`sowing`) | Homesteader has it too but as day-offsets, not a method description |
| `spread_cm`, `row_spacing_cm`, `height_cm` | openfarm (exact cm fields), Trefle (`spread`, `row_spacing`, `average_height`) | Homesteader's `spacing` is free text ("24-36\" apart"), needs parsing |
| `sun_level` | openfarm, Homesteader (free text: "full sun", "full") | Trefle uses a 0-10 numeric scale, not our 3-value enum - needs a conversion table, not a direct map |
| `soil_type` | Permapeople, Trefle (`soil_texture`) | |
| `water_needs` | Homesteader (`waterNeedsPerWeek`, numeric), Permapeople, Trefle (precipitation range) | Trefle's is natural-habitat rainfall, not "how much to water" - different semantics, needs judgment |
| `periods` (sowing/planting/fertilizing/harvesting, by month) | **Trefle** (`sowing`, `growth_months`, `bloom_months`, `fruit_months`) is the best match | openfarm has no explicit period fields; Homesteader's frost-offset days would need conversion to months |
| `companions[].relationship` (good/bad) | Wikipedia (Helps/Helped-by vs. Avoid), Homesteader `companion-planting.json` (`type: companion` vs. presumably `antagonist`) | openfarm's `companions` is just a flat slug list - no good/bad polarity at all |
| `companions[].notes` | Wikipedia (Comments), Homesteader (`description`) | |
| `family`, `genus` (added) | Trefle (`family`, `genus`), USDA PLANTS (taxonomy) | Ties to the rotation/succession-family logic in root `CLAUDE.md`'s domain notes, which had no field to key off before this |
| `min_temperature_c`/`max_temperature_c` (added) | Trefle (`minimum_temperature`/`maximum_temperature`) | Chosen over a US hardiness zone (which Permapeople has instead) - more directly usable for the Belgium climate-adjustment goal |
| `days_to_maturity` (added) | Homesteader, Trefle (`days_to_harvest`) | |
| `soil_ph_min`/`soil_ph_max` (added) | Trefle (`ph_minimum`/`ph_maximum`) | |
| `is_toxic`/`toxicity_notes`, `is_edible`/`edible_parts` (added) | Trefle (`toxicity`, `edible`, `edible_part`), Permapeople (`Edible`, `Edible parts`) | |
| `succession_enabled`/`succession_interval_days`/`succession_max_sowings` (added) | Homesteader (`successionEnabled`, `successionInterval`, `successionMax`) | Directly matches the project's own stated "succession planting" goal |
| `companions[].mechanism` (added) | Homesteader `companion-planting.json` (`mechanism`, e.g. "pest-deterrent") | |
| `pest_interactions[]` (added, new table) | Wikipedia (Attracts/Repels columns), Homesteader (`pestVulnerabilities`) | Plant-to-insect, not plant-to-plant - couldn't be folded into `PlantCompanion` |

## Fields still needing a source

Nothing reviewed so far covers these as a *structured* field - they'll need either a source not yet on the list above, manual curation, or extraction from unstructured text (see `growing_information` below) rather than being sourced directly:

- **`composting_needs`, `fertilizer_needs`** - this reads more like "how-to-grow" advisory content than a database fact, so structured plant APIs are unlikely to have it as a discrete field. Worth checking whether it's buried in prose inside `description` fields (openfarm, Permapeople, Trefle all have one) that Ollama could extract, or looking at gardening-extension-service publications (university/government ag-extension "growing guides", not just plant databases) rather than another API. Project Gutenberg's old gardening books are exactly this kind of prose source - see below.
- **`needs_wind_cover`, `needs_rain_cover`** - very specific, unlikely to exist as a discrete field anywhere. Candidate for *inference* (from correlated fields like `height_cm`, or from `growing_information` text) rather than a dedicated source.
- **`seed_info.seeds_per_gram`, `seed_info.pretreatment`** - classic seed-catalog data (germination rates, stratification/scarification requirements), not general plant-database data. None of the sources above are seed catalogs. Look for seed company technical data sheets, seed-starting guides, or native-plant/seed-bank germination protocols instead of another crop database.
- **`bedding_needs`** (hilling, ground cover, staking, ...) - also how-to-grow content rather than a database field. General gardening how-to sites/extension publications are the likely source; alternatively, structured growth-habit fields (Trefle has `growth_form`/`growth_habit`/`shape_and_orientation`) might let Ollama *infer* staking needs for vining/climbing plants even without an explicit field.

### `growing_information` - the holding area for the fields above

Added a new field/table for exactly this problem: `growing_information` (JSON) / `PlantGrowingInformation` (Postgres, `plant_growing_information` table) holds long-form, unstructured text - e.g. a Project Gutenberg book's section for a given plant - rather than trying to force it into a structured field immediately. Each entry carries its own `source_url`, `attribution`, and `copyright_status` (old book scans are usually public domain, but that varies per book, so it's tracked per entry, not assumed). `record_type` distinguishes a single source's raw excerpt (`raw`) from a synthesized combination of several sources for the same plant (`consolidated`).

**Cultivar vs. species text**: some of this prose describes a species/genus generically (e.g. "pumpkins") rather than a specific cultivar (e.g. "Baby Bear Pumpkin"). Per the cultivar-merge bug fix (see `data/etl/CLAUDE.md`), cultivars must stay separate plant records - so generic text gets *copied* into every matching cultivar's own `growing_information` array, with `generic_for_species: true` marking it as not cultivar-specific advice. No separate "species" entity was introduced for this - simpler to keep as a flag on each cultivar's own copy.

**Status: schema only, not wired up yet.** `Plant`-cluster migration (`add_plant_growing_information`) and the JSON Schema field exist and are verified against real Postgres. Not yet built: a Project Gutenberg fetcher (7 books listed below) and the actual structured-data extraction pass that would read this text and fill in the fields listed above. Deliberately *not* wired into `data/etl/`'s active merge/export code yet, to avoid touching a pipeline that was mid-run when this was added.

**Fetching**: 7 books, full page content in one shot per book (7 total requests) - no rate limiting needed, unlike the per-plant-queried sources (Permapeople/Trefle). All 7 are the same `gutenberg.org` URL pattern; confirmed readable (fetched #43531 directly to check).

**Splitting into sections**: book formatting isn't uniform across 7 different books/publishers, so don't hand-code section-boundary heuristics - use Ollama to classify each section/subsection of a book against what our data model actually needs. This also handles filtering out front/back matter (title page, table of contents, illustrations list, indices, "Authorities Consulted," ads, etc. - confirmed these exist in #43531 and are not plant content) without a book-specific exclusion list.

**Matching a section to an existing plant**: no single strategy is prescribed - try a few and see what actually works against real book headings, which are messier than structured source data (e.g. "CETEWAYO OR ZULU POTATOES", "KALE OR BORECOLE" in #43531). Candidates: exact/fuzzy string match on common name, LLM-assisted matching, and/or embedding similarity - `all-minilm:latest` (the one embedding-capable model in the local Ollama install) is a reasonable option for that last one.
- Sections that don't match anything in the master list: keep a list of them rather than discarding - we don't have much other structured data on these plants anyway, so there's no reason to invent a new plant record from book text alone right now. If a book turns out to have enough real data to justify adding one, that's a deliberate follow-up decision once the list exists, not automatic.

**Storage**: each matched section becomes a `raw` `growing_information` entry, linked back to its source book (`source_url`/`attribution`). Raw entries are permanent - they stay even after consolidation (below), and this whole mechanism is general-purpose, not Gutenberg-specific: any future long-form-text source can be added the same way.

**Once all books are processed, four Ollama passes per plant** (not necessarily the same model for all four - different passes may suit different local models):
1. **Consolidate** - synthesize a plant's raw `growing_information` entries (across however many books mention it) into one `consolidated` entry. Raw entries stay untouched alongside it.
2. **Extract** - infer which of the fields nothing structured covers (`composting_needs`, `fertilizer_needs`, `needs_wind_cover`, `needs_rain_cover`, `seed_info.pretreatment`, `bedding_needs`) a plant's growing information actually answers, and extract them. Feed the result into the same merge/conflict pipeline as every other source (`data/etl/merge.py`) rather than writing it directly - it's just another candidate value, source-tagged like any other.
3. **Cross-check** - compare the growing information against data already populated for that plant from other sources, and flag any inconsistencies found (e.g. a book saying "full shade" when a structured source already says `full_sun`).
4. **Surface interesting data** - note anything in the text that doesn't map to an existing field but looks worth capturing. Log it for review rather than silently extending the schema - exact log format (a new file, or appended to something like `data/conflicts_log.jsonl`) still to be decided when this gets built.

| Book URL | Notes |
|---|---|
| https://www.gutenberg.org/cache/epub/43531/pg43531-images.html | Checked directly: sections delimited by heading + anchor ID (e.g. `#BEANS`). `copyright_status` should come from Project Gutenberg's own license boilerplate near the top of the page (next to "\*\*\* START OF THE PROJECT GUTENBERG EBOOK ... \*\*\*") - not the original 1912 publisher's notice further down the page, which prints "All rights reserved" and would be misleading if copied verbatim (it reflects 1912 law, not current public-domain status; Gutenberg only hosts confirmed-public-domain-in-the-US works). |
| https://www.gutenberg.org/cache/epub/76930/pg76930-images.html | Not yet checked individually - verify copyright_status the same way as #43531 rather than assuming identical formatting. |
| https://www.gutenberg.org/cache/epub/7123/pg7123-images.html | Not yet checked individually. |
| https://www.gutenberg.org/cache/epub/36064/pg36064-images.html | Not yet checked individually. |
| https://www.gutenberg.org/cache/epub/77032/pg77032-images.html | Not yet checked individually. |
| https://www.gutenberg.org/cache/epub/63013/pg63013-images.html | Not yet checked individually. |
| https://www.gutenberg.org/cache/epub/46052/pg46052-images.html | Not yet checked individually. |

## Notes

- Permapeople api documentation is found here: 'https://permapeople.org/knowledgebase/api-docs/' - PERMAPEOPLE_KEY_ID and PERMAPEOPLE_KEY_SECRET are in the environment - import using python-dotenv or pydantic-settings
- Trefle api documentation is https://docs.trefle.io/reference - auth is a `?token=` query param (personal access token from a trefle.io account), and the API enforces a **120 requests/minute rate limit** - the ETL needs to throttle/paginate accordingly, not fire requests as fast as possible.
