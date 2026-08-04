import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSnackbar } from "@/components/Snackbar";
import { getPlant, listPlants, updatePlant, type PlantDetail as PlantDetailData, type PlantUpdate } from "@/api/client";
import { SCALAR_FIELDS, fieldValue, type FieldValue } from "@/pages/plant-detail/fields";
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
// see fields.ts's own FieldConfig.tier doc.
const IDENTITY_KEYS = new Set<string>(["common_name", "family", "genus"]);

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

export function PlantDetail() {
  const { slug = "" } = useParams();
  const { data, isPending, isError } = useQuery({
    queryKey: ["plant", slug],
    queryFn: () => getPlant(slug),
    enabled: Boolean(slug),
  });
  // Candidate list for the Companions section's plant pickers, and for
  // LineageSection's cultivar lookup / this page's own parent-plant lookup
  // below - same pattern (and same limit) as the layout editor's own plant
  // query.
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const { saveField, savePatch } = usePlantAutosave(slug);
  const [showMore, setShowMore] = useState(false);

  const primaryFields = useMemo(() => SCALAR_FIELDS.filter((f) => f.tier === "primary" && !IDENTITY_KEYS.has(f.key)), []);
  const secondaryFields = useMemo(() => SCALAR_FIELDS.filter((f) => f.tier === "secondary"), []);

  const parent = data?.parent_plant_slug
    ? (plantsQuery.data ?? []).find((p) => p.slug === data.parent_plant_slug)
    : null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start gap-3">
        <Link to="/plants" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
        {data && (
          <div>
            {/* Identity line (#237's Option A layout): name/family/genus as
                click-to-edit inline fields, plain text until clicked -
                not the always-visible <h1>/FieldInput rows this used to
                be. parent_plant_slug (#236) joins it as a plain link
                (there's no editable "reassign parent" field to make this
                inline-editable too, see LineageSection's own doc). */}
            {/* A real <h1> - #237's InlineEditableField swap-to-<button>
                display mode has no heading semantics of its own.
                skipEditAriaLabel: the collapsed button's visible text (the
                plant's own name) should be the h1's accessible name as-is
                (plain content-based computation) - the usual "Edit
                <field>" override every other InlineEditableField instance
                keeps would make the h1's own name "Edit Common name"
                instead, and could substring-collide with an unrelated
                field's own getByLabel query for a plant literally named
                e.g. "... Growth Habit ..." (a real regression this flag
                exists to avoid). */}
            <h1>
              <InlineEditableField
                value={data.common_name}
                ariaLabel="Common name"
                placeholder="Add name…"
                onCommit={(v, p) => saveField("common_name", "Common name", v, p)}
                className="text-xl font-medium"
                skipEditAriaLabel
              />
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <InlineEditableField
                value={fieldValue(data, "family") as string | null}
                ariaLabel="Family"
                placeholder="Add family…"
                onCommit={(v, p) => saveField("family", "Family", v, p)}
              />
              <InlineEditableField
                value={fieldValue(data, "genus") as string | null}
                ariaLabel="Genus"
                placeholder="Add genus…"
                onCommit={(v, p) => saveField("genus", "Genus", v, p)}
              />
              {parent && (
                <Link to={`/plants/${parent.slug}`} className="underline-offset-2 hover:underline">
                  Parent: {parent.common_name}
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{data.slug}</p>
          </div>
        )}
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading plant…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load plant.</p>}

      {data && (
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {primaryFields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={fieldValue(data, field.key)}
                onCommit={(newValue, previousValue) => saveField(field.key, field.label, newValue, previousValue)}
              />
            ))}
            <LifeCycleFields lifeCycle={data.life_cycle} lifeCycleYears={data.life_cycle_years} onSave={savePatch} />
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
              <section id="plant-detail-secondary-fields" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {secondaryFields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={fieldValue(data, field.key)}
                    onCommit={(newValue, previousValue) => saveField(field.key, field.label, newValue, previousValue)}
                  />
                ))}
              </section>
            )}
          </div>

          <LineageSection plant={data} allPlants={plantsQuery.data ?? []} />

          {/* Satellite sections, each its own bordered Card (#237's Option A
              layout), reordered by everyday-use frequency - Companions
              (planning-relevant) and Periods (agenda-relevant timing) first,
              Data sources (provenance metadata) last. */}
          <Card className="p-4">
            <CompanionsSection slug={slug} items={data.companions} allPlants={plantsQuery.data ?? []} />
          </Card>
          <Card className="p-4">
            <PeriodsSection slug={slug} items={data.periods} />
          </Card>
          <Card className="p-4">
            <BeddingNeedsSection slug={slug} items={data.bedding_needs} />
          </Card>
          <Card className="p-4">
            <SeedInfoSection slug={slug} seedInfo={data.seed_info} />
          </Card>
          <Card className="p-4">
            <PestInteractionsSection slug={slug} items={data.pest_interactions} />
          </Card>
          <Card className="p-4">
            <GrowingInfoSection slug={slug} items={data.growing_information} />
          </Card>
          <Card className="p-4">
            <DataSourcesSection slug={slug} items={data.data_sources} />
          </Card>
        </div>
      )}
    </div>
  );
}
