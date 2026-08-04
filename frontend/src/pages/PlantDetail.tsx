import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { useSnackbar } from "@/components/Snackbar";
import { getPlant, listPlants, updatePlant, type PlantDetail as PlantDetailData, type PlantUpdate } from "@/api/client";
import { SCALAR_FIELDS, fieldValue, type FieldValue } from "@/pages/plant-detail/fields";
import { FieldInput } from "@/pages/plant-detail/FieldInput";
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
  // Candidate list for the Companions section's plant pickers - same
  // pattern (and same limit) as the layout editor's own plant query.
  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: () => listPlants(500) });
  const { saveField, savePatch } = usePlantAutosave(slug);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/plants" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
        {data && (
          <div>
            <h1 className="text-xl font-medium">{data.common_name}</h1>
            <p className="text-xs text-muted-foreground">{data.slug}</p>
          </div>
        )}
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading plant…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load plant.</p>}

      {data && (
        <div className="flex flex-col gap-6">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SCALAR_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={fieldValue(data, field.key)}
                onCommit={(newValue, previousValue) => saveField(field.key, field.label, newValue, previousValue)}
              />
            ))}
            <LifeCycleFields lifeCycle={data.life_cycle} lifeCycleYears={data.life_cycle_years} onSave={savePatch} />
          </section>

          <LineageSection plant={data} allPlants={plantsQuery.data ?? []} />
          <DataSourcesSection slug={slug} items={data.data_sources} />
          <SeedInfoSection slug={slug} seedInfo={data.seed_info} />
          <PeriodsSection slug={slug} items={data.periods} />
          <CompanionsSection slug={slug} items={data.companions} allPlants={plantsQuery.data ?? []} />
          <BeddingNeedsSection slug={slug} items={data.bedding_needs} />
          <PestInteractionsSection slug={slug} items={data.pest_interactions} />
          <GrowingInfoSection slug={slug} items={data.growing_information} />
        </div>
      )}
    </div>
  );
}
