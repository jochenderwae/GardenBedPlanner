import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { useSnackbar } from "@/components/Snackbar";
import { getPlant, listPlants, updatePlant, type PlantDetail as PlantDetailData, type PlantUpdate } from "@/api/client";
import { SCALAR_FIELDS, fieldValue, type FieldValue } from "@/pages/plant-detail/fields";
import { FieldInput } from "@/pages/plant-detail/FieldInput";
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

  function setField(key: keyof PlantUpdate, value: FieldValue) {
    queryClient.setQueryData<PlantDetailData>(["plant", slug], (old) => (old ? { ...old, [key]: value } : old));
  }

  return function saveField(key: keyof PlantUpdate, label: string, newValue: FieldValue, previousValue: FieldValue) {
    setField(key, newValue);
    mutation.mutate(
      { [key]: newValue } as PlantUpdate,
      {
        onSuccess: () =>
          show(`Saved ${label}`, () => {
            setField(key, previousValue);
            mutation.mutate({ [key]: previousValue } as PlantUpdate);
          }),
        onError: () => {
          setField(key, previousValue);
          show(`Failed to save ${label}`);
        },
      },
    );
  };
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
  const saveField = usePlantAutosave(slug);

  return (
    <div className="mx-auto max-w-3xl p-6 text-left">
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
          </section>

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
