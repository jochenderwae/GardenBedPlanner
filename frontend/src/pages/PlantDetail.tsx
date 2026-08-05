import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useSnackbar } from "@/components/Snackbar";
import { getPlant, listPlants, updatePlant, type PlantDetail as PlantDetailData, type PlantUpdate } from "@/api/client";
import { buildFieldLayout, fieldValue, SCALAR_FIELDS, type FieldLayoutItem, type FieldValue } from "@/pages/plant-detail/fields";
import { FieldInput } from "@/pages/plant-detail/FieldInput";
import { InlineEditableField } from "@/pages/plant-detail/InlineEditableField";
import { LifeCycleFields } from "@/pages/plant-detail/LifeCycleFields";
import { LineageSection } from "@/pages/plant-detail/LineageSection";
import {
  BeddingNeedsSection,
  CompanionsSection,
  DataSourcesSection,
  GrowingInfoSection,
  PeriodsSection,
  PestInteractionsSection,
  SeedInfoSection,
} from "@/pages/plant-detail/SatelliteSections";

// The identity line (name/family/genus/parent) renders these three via
// InlineEditableField directly, not through the generic tiered loop below -
// see fields.ts's own FieldConfig.tier doc. #237 round 2's item 10 also
// special-cases `description` out of the grid the same way (full-width
// block directly under the identity line instead of a grid cell).
const IDENTITY_KEYS = new Set<string>(["common_name", "family", "genus"]);
const GRID_EXCLUDED_KEYS = new Set<string>([...IDENTITY_KEYS, "description"]);

/** `buildFieldLayout`'s own `FieldLayoutItem` plus a `"lifecycle"` marker -
 * `life_cycle`/`life_cycle_years` aren't `SCALAR_FIELDS` entries (they're
 * rendered together by the dedicated `LifeCycleFields` component, see its
 * own doc for why), but the design spec's grouping table places them inside
 * the primary tier's "Size & form" cluster alongside spread_cm/
 * row_spacing_cm/height_cm/growth_habit - this marker gets spliced into
 * `primaryLayout` right after that cluster's real fields, purely a
 * PlantDetail-local rendering concern (fields.ts stays generic). */
type PrimaryLayoutItem = FieldLayoutItem | { kind: "lifecycle" };

function usePlantAutosave(slug: string) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const mutation = useMutation({ mutationFn: (patch: PlantUpdate) => updatePlant(slug, patch) });

  // Loosely typed (FieldValue, not PlantUpdate's own per-field types) to
  // match how `fieldValue`/FieldInput already treat every field generically
  // - family/genus in particular differ in shape between PlantDetail (a
  // {id, name} relation) and PlantUpdate (the plain name string that
  // resolves it), which a strict Partial<PlantDetailData> merge would
  // reject for a patch object typed per-PlantUpdate-field.
  function setFields(patch: Partial<Record<keyof PlantUpdate, FieldValue>>) {
    queryClient.setQueryData<PlantDetailData>(["plant", slug], (old) =>
      old ? ({ ...old, ...patch } as PlantDetailData) : old,
    );
  }

  /** Commits an arbitrary multi-field patch as a single mutation/Undo entry
   * - used directly by `LifeCycleFields` (life_cycle + life_cycle_years
   * always change together), and by `saveField` below for the common
   * single-field case. */
  function savePatch(
    patch: Partial<Record<keyof PlantUpdate, FieldValue>>,
    previous: Partial<Record<keyof PlantUpdate, FieldValue>>,
    label: string,
  ) {
    setFields(patch);
    mutation.mutate(patch as PlantUpdate, {
      onSuccess: () =>
        show(`Saved ${label}`, () => {
          setFields(previous);
          mutation.mutate(previous as PlantUpdate);
        }),
      onError: () => {
        setFields(previous);
        show(`Failed to save ${label}`);
      },
    });
  }

  function saveField(key: keyof PlantUpdate, label: string, newValue: FieldValue, previousValue: FieldValue) {
    savePatch({ [key]: newValue }, { [key]: previousValue }, label);
  }

  return { saveField, savePatch };
}

function GroupCaption({ label }: { label: string }) {
  return <p className="text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase sm:col-span-2">{label}</p>;
}

export function PlantDetail() {
  const { slug = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["plant", slug],
    queryFn: () => getPlant(slug),
    enabled: Boolean(slug),
  });
  // Candidate list for the Companions section's plant pickers, for
  // LineageSection's cultivar lookup / this page's own parent-plant lookup,
  // and (#237 round 2) the family/genus Autocomplete's suggestion source -
  // same pattern (and same limit) as the layout editor's own plant query.
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const { saveField, savePatch } = usePlantAutosave(slug);
  const { show } = useSnackbar();
  const [showMore, setShowMore] = useState(false);

  const primaryFields = useMemo(() => SCALAR_FIELDS.filter((f) => f.tier === "primary" && !GRID_EXCLUDED_KEYS.has(f.key)), []);
  const secondaryFields = useMemo(() => SCALAR_FIELDS.filter((f) => f.tier === "secondary"), []);

  const primaryLayout = useMemo<PrimaryLayoutItem[]>(() => {
    const layout = buildFieldLayout(primaryFields);
    let lastSizeFormIdx = -1;
    layout.forEach((item, i) => {
      if (item.kind === "field" && item.field.group === "size_form") lastSizeFormIdx = i;
    });
    if (lastSizeFormIdx === -1) return layout;
    return [...layout.slice(0, lastSizeFormIdx + 1), { kind: "lifecycle" }, ...layout.slice(lastSizeFormIdx + 1)];
  }, [primaryFields]);
  const secondaryLayout = useMemo(() => buildFieldLayout(secondaryFields), [secondaryFields]);

  const familyNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of plantsQuery.data ?? []) if (p.family?.name) names.add(p.family.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [plantsQuery.data]);
  const genusNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of plantsQuery.data ?? []) if (p.genus?.name) names.add(p.genus.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [plantsQuery.data]);

  const parent = data?.parent_plant_slug
    ? (plantsQuery.data ?? []).find((p) => p.slug === data.parent_plant_slug)
    : null;

  function copyLink() {
    if (!data) return;
    navigator.clipboard
      .writeText(`${window.location.origin}/plants/${data.slug}`)
      .then(() => show("Link copied"))
      .catch(() => show("Failed to copy link"));
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start gap-3">
        <Link to="/plants" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
        {data && (
          <div>
            {/* Identity line as a breadcrumb path (#237 round 2, item 1):
                Family / Genus / Parent (a cultivar only) / **Name** - a
                single row, not the old "name heading + family/genus/parent
                row below it" split. Family/genus stay independently
                click-to-edit, now via the new Autocomplete primitive
                (item 2/5) instead of a plain text input; `/` separators are
                plain muted text, not part of any crumb's own click target.
                The name keeps its exact prior visual weight/semantics (a
                real <h1>, skipEditAriaLabel, text-xl font-medium) - only
                its position on the line and what surrounds it changes. */}
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <InlineEditableField
                type="autocomplete"
                autocompleteItems={familyNames}
                value={fieldValue(data, "family")}
                ariaLabel="Family"
                placeholder="Add family…"
                onCommit={(v, p) => saveField("family", "Family", v, p)}
                className="text-sm text-muted-foreground"
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                /
              </span>
              <InlineEditableField
                type="autocomplete"
                autocompleteItems={genusNames}
                value={fieldValue(data, "genus")}
                ariaLabel="Genus"
                placeholder="Add genus…"
                onCommit={(v, p) => saveField("genus", "Genus", v, p)}
                className="text-sm text-muted-foreground"
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                /
              </span>
              {parent && (
                <>
                  <Link to={`/plants/${parent.slug}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
                    {parent.common_name}
                  </Link>
                  <span className="text-sm text-muted-foreground" aria-hidden="true">
                    /
                  </span>
                </>
              )}
              {/* A real <h1> - InlineEditableField's swap-to-<button>
                  display mode has no heading semantics of its own.
                  skipEditAriaLabel: the collapsed button's visible text
                  (the plant's own name) should be the h1's accessible name
                  as-is (plain content-based computation) - the usual "Edit
                  <field>" override every other InlineEditableField
                  instance keeps would make the h1's own name "Edit Common
                  name" instead, and could substring-collide with an
                  unrelated field's own getByLabel query for a plant
                  literally named e.g. "... Growth Habit ..." (a real
                  regression this flag exists to avoid). */}
              <h1 className="inline">
                <InlineEditableField
                  value={data.common_name}
                  ariaLabel="Common name"
                  placeholder="Add name…"
                  onCommit={(v, p) => saveField("common_name", "Common name", v, p)}
                  className="text-xl font-medium"
                  skipEditAriaLabel
                />
              </h1>
            </div>
            {/* Slug gets a "copy link" action (#237 round 2, item 3/4) -
                a real <button>, not a bare <p>, same "make it focusable/
                keyboard-activatable" precedent InlineEditableField already
                established. */}
            <button
              type="button"
              aria-label="Copy link to this plant"
              onClick={copyLink}
              className="group mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {data.slug}
              <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </div>
        )}
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading plant…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load plant.</p>}

      {data && (
        <div className="flex flex-col gap-4">
          {/* Description, Growing information, and Cultivars (#237 round 2,
              item 9/10) - identity-adjacent facts, pulled out of the
              generic scalar-field grid/satellite-section lists entirely,
              directly below the identity line/slug. */}
          <InlineEditableField
            type="textarea"
            value={data.description ?? null}
            ariaLabel="Description"
            placeholder="Add a description…"
            onCommit={(v, p) => saveField("description", "Description", v, p)}
            className="w-full text-sm"
          />
          <GrowingInfoSection slug={slug} items={data.growing_information} />
          <LineageSection plant={data} allPlants={plantsQuery.data ?? []} />

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {primaryLayout.map((item) => {
              if (item.kind === "caption") return <GroupCaption key={`caption-${item.group}`} label={item.label} />;
              if (item.kind === "lifecycle") {
                return <LifeCycleFields key="lifecycle" lifeCycle={data.life_cycle} lifeCycleYears={data.life_cycle_years} onSave={savePatch} />;
              }
              const field = item.field;
              return (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={fieldValue(data, field.key)}
                  onCommit={(newValue, previousValue) => saveField(field.key, field.label, newValue, previousValue)}
                />
              );
            })}
          </section>

          <div>
            <button
              type="button"
              aria-expanded={showMore}
              aria-controls="plant-detail-secondary-fields"
              onClick={() => setShowMore((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showMore ? "Hide details" : "Show more details"}
              {showMore ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {showMore && (
              <div id="plant-detail-secondary-fields" className="mt-3 flex flex-col gap-4">
                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {secondaryLayout.map((item) =>
                    item.kind === "caption" ? (
                      <GroupCaption key={`caption-${item.group}`} label={item.label} />
                    ) : (
                      <FieldInput
                        key={item.field.key}
                        field={item.field}
                        value={fieldValue(data, item.field.key)}
                        onCommit={(newValue, previousValue) => saveField(item.field.key, item.field.label, newValue, previousValue)}
                      />
                    ),
                  )}
                </section>

                {/* Six satellite sections (#237 round 2, item 6/7 -
                    Bedding needs joins the user's originally-named 5),
                    plain title + border-t separators
                    (SatelliteSections.tsx's own sectionClass) instead of
                    round 1's bordered Cards, in the existing
                    everyday-relevance order. */}
                <CompanionsSection slug={slug} items={data.companions} allPlants={plantsQuery.data ?? []} />
                <PeriodsSection slug={slug} items={data.periods} />
                <BeddingNeedsSection slug={slug} items={data.bedding_needs} />
                <SeedInfoSection slug={slug} seedInfo={data.seed_info} />
                <PestInteractionsSection slug={slug} items={data.pest_interactions} />
                <DataSourcesSection slug={slug} items={data.data_sources} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
