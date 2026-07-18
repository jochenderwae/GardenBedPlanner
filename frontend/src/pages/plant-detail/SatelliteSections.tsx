import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSnackbar } from "@/components/Snackbar";
import {
  beddingNeedApi,
  createCompanion,
  dataSourceApi,
  deleteCompanion,
  deleteSeedInfo,
  growingInfoApi,
  listPeriodTypes,
  periodApi,
  pestInteractionApi,
  upsertSeedInfo,
  type PlantBeddingNeed,
  type PlantCompanion,
  type PlantDataSource,
  type PlantDetail,
  type PlantGrowingInformation,
  type PlantPeriod,
  type PlantPestInteraction,
  type SeedInfo,
} from "@/api/client";

const inputClass =
  "rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const sectionClass = "flex flex-col gap-2 border-t pt-4";
const rowClass = "flex flex-wrap items-center gap-2 text-sm";

/** Shared plumbing for the five satellite tables shaped like (int id PK,
 * plant_slug FK, ...rest): optimistic add/remove against the cached
 * PlantDetail, each backed by an Undo action in the snackbar. Companions
 * (composite key) and seed_info (1:1 singleton) have different enough
 * shapes to not fit this and are handled directly in their own sections. */
function useSatelliteMutations<T extends { id?: number | null }>(
  slug: string,
  listKey: keyof PlantDetail,
  api: {
    create: (slug: string, item: Omit<T, "id" | "plant_slug">) => Promise<T>;
    remove: (slug: string, id: number) => Promise<void>;
  },
) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();

  function setList(updater: (list: T[]) => T[]) {
    queryClient.setQueryData<PlantDetail>(["plant", slug], (old) => {
      if (!old) return old;
      return { ...old, [listKey]: updater(old[listKey] as unknown as T[]) };
    });
  }

  function add(item: Omit<T, "id" | "plant_slug">, describe: string) {
    api.create(slug, item).then((created) => {
      setList((list) => [...list, created]);
      show(`Added ${describe}`, () => {
        if (created.id != null) {
          const id = created.id;
          api.remove(slug, id).then(() => setList((list) => list.filter((i) => i.id !== id)));
        }
      });
    });
  }

  function remove(item: T, describe: string) {
    if (item.id == null) return;
    const id = item.id;
    api.remove(slug, id).then(() => {
      setList((list) => list.filter((i) => i.id !== id));
      show(`Removed ${describe}`, () => {
        const { id: _id, plant_slug: _slug, ...rest } = item as Record<string, unknown>;
        api
          .create(slug, rest as Omit<T, "id" | "plant_slug">)
          .then((recreated) => setList((list) => [...list, recreated]));
      });
    });
  }

  return { add, remove };
}

export function DataSourcesSection({ slug, items }: { slug: string; items: PlantDataSource[] }) {
  const { add, remove } = useSatelliteMutations<PlantDataSource>(slug, "data_sources", dataSourceApi);
  const [draft, setDraft] = useState({ source_url: "", attribution: "", notes: "" });

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Data sources</h2>
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1 truncate">{item.attribution || item.source_url || "(untitled)"}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove data source"
            onClick={() => remove(item, item.attribution || "data source")}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={rowClass}>
        <input
          className={inputClass}
          placeholder="attribution"
          value={draft.attribution}
          onChange={(e) => setDraft({ ...draft, attribution: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="source URL"
          value={draft.source_url}
          onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!draft.attribution && !draft.source_url) return;
            add(
              {
                source_url: draft.source_url || null,
                attribution: draft.attribution || null,
                notes: draft.notes || null,
              },
              draft.attribution || "data source",
            );
            setDraft({ source_url: "", attribution: "", notes: "" });
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

export function SeedInfoSection({ slug, seedInfo }: { slug: string; seedInfo: SeedInfo | null }) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const mutation = useMutation({ mutationFn: (item: Omit<SeedInfo, "plant_slug">) => upsertSeedInfo(slug, item) });
  const deleteMutation = useMutation({ mutationFn: () => deleteSeedInfo(slug) });

  const current = seedInfo ?? {
    plant_slug: slug,
    seeds_per_gram: null,
    pretreatment: null,
    produces_viable_seeds: null,
    is_f1_hybrid: null,
  };

  function save(patch: Partial<SeedInfo>) {
    const previous = seedInfo;
    const next = { ...current, ...patch };
    queryClient.setQueryData<PlantDetail>(["plant", slug], (old) => (old ? { ...old, seed_info: next } : old));
    mutation.mutate(next, {
      onSuccess: () =>
        show("Saved seed info", () => {
          if (previous) {
            queryClient.setQueryData<PlantDetail>(["plant", slug], (old) =>
              old ? { ...old, seed_info: previous } : old,
            );
            mutation.mutate(previous);
          } else {
            deleteMutation.mutate(undefined, {
              onSuccess: () =>
                queryClient.setQueryData<PlantDetail>(["plant", slug], (old) =>
                  old ? { ...old, seed_info: null } : old,
                ),
            });
          }
        }),
    });
  }

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Seed info</h2>
      <div className={rowClass}>
        <label className="flex items-center gap-1.5">
          Seeds/gram
          <input
            type="number"
            className={inputClass}
            defaultValue={current.seeds_per_gram ?? ""}
            onBlur={(e) => save({ seeds_per_gram: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-1.5">
          Pretreatment
          <input
            type="text"
            className={inputClass}
            defaultValue={current.pretreatment ?? ""}
            onBlur={(e) => save({ pretreatment: e.target.value || null })}
          />
        </label>
      </div>
    </section>
  );
}

export function PeriodsSection({ slug, items }: { slug: string; items: PlantPeriod[] }) {
  const { add, remove } = useSatelliteMutations<PlantPeriod>(slug, "periods", periodApi);
  const { data: periodTypes } = useQuery({ queryKey: ["period-types"], queryFn: listPeriodTypes });
  const [draft, setDraft] = useState({ period_type: "", start_month: 1, end_month: 1 });

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Periods</h2>
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1">
            {item.period_type}: month {item.start_month}–{item.end_month}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove period"
            onClick={() => remove(item, item.period_type)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={rowClass}>
        <select
          className={inputClass}
          value={draft.period_type}
          onChange={(e) => setDraft({ ...draft, period_type: e.target.value })}
        >
          <option value="">period type…</option>
          {periodTypes?.map((pt) => (
            <option key={pt.code} value={pt.code}>
              {pt.code}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={12}
          className={`${inputClass} w-16`}
          value={draft.start_month}
          onChange={(e) => setDraft({ ...draft, start_month: Number(e.target.value) })}
        />
        <span>–</span>
        <input
          type="number"
          min={1}
          max={12}
          className={`${inputClass} w-16`}
          value={draft.end_month}
          onChange={(e) => setDraft({ ...draft, end_month: Number(e.target.value) })}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!draft.period_type) return;
            add(draft, draft.period_type);
            setDraft({ period_type: "", start_month: 1, end_month: 1 });
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

export function BeddingNeedsSection({ slug, items }: { slug: string; items: PlantBeddingNeed[] }) {
  const { add, remove } = useSatelliteMutations<PlantBeddingNeed>(slug, "bedding_needs", beddingNeedApi);
  const [needType, setNeedType] = useState("");

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Bedding needs</h2>
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1">{item.need_type}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove bedding need"
            onClick={() => remove(item, item.need_type)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={rowClass}>
        <input
          className={inputClass}
          placeholder="e.g. hilling, staking"
          value={needType}
          onChange={(e) => setNeedType(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!needType) return;
            add({ need_type: needType, notes: null }, needType);
            setNeedType("");
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

export function PestInteractionsSection({ slug, items }: { slug: string; items: PlantPestInteraction[] }) {
  const { add, remove } = useSatelliteMutations<PlantPestInteraction>(slug, "pest_interactions", pestInteractionApi);
  const [draft, setDraft] = useState<{ interaction_type: "attracts" | "repels" | "vulnerable_to"; pest_or_insect: string }>({
    interaction_type: "attracts",
    pest_or_insect: "",
  });

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Pest interactions</h2>
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1">
            {item.interaction_type}: {item.pest_or_insect}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove pest interaction"
            onClick={() => remove(item, item.pest_or_insect)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={rowClass}>
        <select
          className={inputClass}
          value={draft.interaction_type}
          onChange={(e) =>
            setDraft({ ...draft, interaction_type: e.target.value as typeof draft.interaction_type })
          }
        >
          <option value="attracts">attracts</option>
          <option value="repels">repels</option>
          <option value="vulnerable_to">vulnerable_to</option>
        </select>
        <input
          className={inputClass}
          placeholder="e.g. aphids"
          value={draft.pest_or_insect}
          onChange={(e) => setDraft({ ...draft, pest_or_insect: e.target.value })}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!draft.pest_or_insect) return;
            add({ ...draft, notes: null }, draft.pest_or_insect);
            setDraft({ interaction_type: "attracts", pest_or_insect: "" });
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

export function CompanionsSection({ slug, items }: { slug: string; items: PlantCompanion[] }) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  const [draft, setDraft] = useState<{ companion_plant_slug: string; relationship: "good" | "bad" }>({
    companion_plant_slug: "",
    relationship: "good",
  });

  function setList(updater: (list: PlantCompanion[]) => PlantCompanion[]) {
    queryClient.setQueryData<PlantDetail>(["plant", slug], (old) =>
      old ? { ...old, companions: updater(old.companions) } : old,
    );
  }

  function add() {
    if (!draft.companion_plant_slug) return;
    const item = { companion_plant_slug: draft.companion_plant_slug, relationship: draft.relationship };
    createCompanion(slug, item).then((created) => {
      setList((list) => [...list, created]);
      show(`Added companion ${created.companion_plant_slug}`, () => {
        deleteCompanion(slug, created.companion_plant_slug).then(() =>
          setList((list) => list.filter((c) => c.companion_plant_slug !== created.companion_plant_slug)),
        );
      });
    });
    setDraft({ companion_plant_slug: "", relationship: "good" });
  }

  function remove(item: PlantCompanion) {
    deleteCompanion(slug, item.companion_plant_slug).then(() => {
      setList((list) => list.filter((c) => c.companion_plant_slug !== item.companion_plant_slug));
      show(`Removed companion ${item.companion_plant_slug}`, () => {
        createCompanion(slug, {
          companion_plant_slug: item.companion_plant_slug,
          relationship: item.relationship,
          mechanism: item.mechanism,
          notes: item.notes,
        }).then((recreated) => setList((list) => [...list, recreated]));
      });
    });
  }

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Companions</h2>
      {items.map((item) => (
        <div key={item.companion_plant_slug} className={rowClass}>
          <span className="flex-1">
            {item.companion_plant_slug} — {item.relationship}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Remove companion" onClick={() => remove(item)}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className={rowClass}>
        <input
          className={inputClass}
          placeholder="companion plant slug"
          value={draft.companion_plant_slug}
          onChange={(e) => setDraft({ ...draft, companion_plant_slug: e.target.value })}
        />
        <select
          className={inputClass}
          value={draft.relationship}
          onChange={(e) => setDraft({ ...draft, relationship: e.target.value as "good" | "bad" })}
        >
          <option value="good">good</option>
          <option value="bad">bad</option>
        </select>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

/** View + delete only, deliberately - the backend's growing_information
 * route only supports list/create/delete (no patch), and hand-authoring a
 * new long-form book excerpt isn't a realistic editing workflow anyway. */
export function GrowingInfoSection({ slug, items }: { slug: string; items: PlantGrowingInformation[] }) {
  const { remove } = useSatelliteMutations<PlantGrowingInformation>(slug, "growing_information", growingInfoApi);

  if (items.length === 0) return null;

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Growing information</h2>
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {item.attribution} · {item.record_type}
              {item.generic_for_species ? " · generic for species" : ""}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove growing information"
              onClick={() => remove(item, item.attribution || "growing information")}
            >
              <Trash2 />
            </Button>
          </div>
          <p className="text-left whitespace-pre-wrap">{item.text}</p>
        </div>
      ))}
    </section>
  );
}
