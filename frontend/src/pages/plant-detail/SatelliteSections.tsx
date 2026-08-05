import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Trash2, Plus } from "lucide-react";
import { MONTH_NAMES } from "@/pages/agenda/agendaMonths";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSnackbar } from "@/components/Snackbar";
import { PlantSearchList } from "@/components/PlantSearchList";
import { Input, Select } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/tooltip";
import {
  beddingNeedApi,
  createCompanion,
  dataSourceApi,
  deleteCompanion,
  deleteSeedInfo,
  listPeriodTypes,
  periodApi,
  pestInteractionApi,
  upsertSeedInfo,
  type Plant,
  type PlantBeddingNeed,
  type PlantCompanion,
  type PlantDataSource,
  type PlantDetail,
  type PlantGrowingInformation,
  type PlantPeriod,
  type PlantPestInteraction,
  type SeedInfo,
} from "@/api/client";

// #237 round 2: back to a plain title + border-t rule separator (this app's
// own existing convention - TaskDetail.tsx, BedPanel.tsx, HarvestLogDialog
// all use exactly this class combination for internal subsections of one
// outer panel) rather than round 1's per-section bordered Card, which
// ui-ux-designer's round-2 review flagged as the actual outlier. `first:`
// only matters when a satellite section happens to be the very first child
// of its parent container - PlantDetail.tsx always renders the secondary
// scalar-field grid before these, so every satellite section gets its own
// border-t divider in practice.
const sectionClass = "flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0";
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

  // ollama-*-inference entries are this project's naming convention for a
  // field's internal AI-inference provenance (see data/etl/
  // populate_growth_habit.py / populate_life_cycle.py), not a real external
  // source a user would want to see or click through to - hidden from the
  // displayed list only. `items` (and this section's own remove/undo
  // plumbing below) still operates on the full, untouched list; the
  // underlying data stays intact for anyone reading the raw JSON/DB.
  const visibleItems = items.filter((item) => !item.attribution?.startsWith("ollama-"));

  return (
    <section className={sectionClass}>
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Data sources
        <FieldHint description="Where this plant's data came from - for attribution and provenance." />
      </h2>
      {visibleItems.map((item) => (
        <div key={item.id} className={rowClass}>
          {item.source_url ? (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate underline">
              {item.attribution || item.source_url}
            </a>
          ) : (
            <span className="flex-1 truncate">{item.attribution || "(untitled)"}</span>
          )}
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
        <Input
          className="w-auto"
          placeholder="attribution"
          value={draft.attribution}
          onChange={(e) => setDraft({ ...draft, attribution: e.target.value })}
        />
        <FieldHint description="Who/what to credit for this data, e.g. an author or organization name." />
        <Input
          className="w-auto"
          placeholder="source URL"
          value={draft.source_url}
          onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
        />
        <FieldHint description="A link to where this data was sourced from." />
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
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Seed info
        <FieldHint description="Seed-specific details used by the seed buying guide and sowing plans." />
      </h2>
      <div className={rowClass}>
        {/* #213: explicit htmlFor/id - FieldHint's own <button> would
            otherwise steal the implicit label association from the real
            Input. */}
        <label className="flex items-center gap-1.5" htmlFor="seed-info-seeds-per-gram">
          Seeds/gram
          <FieldHint description="How many seeds of this plant weigh one gram - used to convert a seed count to a weight, or vice versa." />
          <Input
            id="seed-info-seeds-per-gram"
            type="number"
            className="w-auto"
            defaultValue={current.seeds_per_gram ?? ""}
            onBlur={(e) => save({ seeds_per_gram: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-1.5" htmlFor="seed-info-pretreatment">
          Pretreatment
          <FieldHint description="Any treatment seeds need before sowing, e.g. soaking, stratification, scarification." />
          <Input
            id="seed-info-pretreatment"
            type="text"
            className="w-auto"
            defaultValue={current.pretreatment ?? ""}
            onBlur={(e) => save({ pretreatment: e.target.value || null })}
          />
        </label>
      </div>
    </section>
  );
}

/** `MONTH_NAMES` (shared with the agenda view) is a plain 0-indexed array;
 * `PlantPeriod.start_month`/`end_month` are 1-12, matching this app's
 * month-number convention throughout (see `agendaMonths.ts`'s own doc).
 * Exported for `SatelliteSections.test.ts` (#152). */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** "March–May" for a real range, or just "March" for a single-month period
 * (start === end) rather than the redundant "March–March" (#152). */
export function monthRangeLabel(startMonth: number, endMonth: number): string {
  return startMonth === endMonth ? monthName(startMonth) : `${monthName(startMonth)}–${monthName(endMonth)}`;
}

export function PeriodsSection({ slug, items }: { slug: string; items: PlantPeriod[] }) {
  const { add, remove } = useSatelliteMutations<PlantPeriod>(slug, "periods", periodApi);
  const { data: periodTypes } = useQuery({ queryKey: ["period-types"], queryFn: listPeriodTypes });
  const [draft, setDraft] = useState({ period_type: "", start_month: 1, end_month: 1 });

  return (
    <section className={sectionClass}>
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Periods
        <FieldHint description="Month ranges for this plant's key activities (sowing, harvesting, etc.) - drives the agenda and seed guide views." />
      </h2>
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1">
            {item.period_type}: {monthRangeLabel(item.start_month, item.end_month)}
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
        <Select
          className="w-auto"
          value={draft.period_type}
          onChange={(e) => setDraft({ ...draft, period_type: e.target.value })}
        >
          <option value="">period type…</option>
          {periodTypes?.map((pt) => (
            <option key={pt.code} value={pt.code}>
              {pt.code}
            </option>
          ))}
        </Select>
        <FieldHint description="What kind of activity this period covers, e.g. sowing, harvesting." />
        <Select
          className="w-auto"
          value={draft.start_month}
          onChange={(e) => setDraft({ ...draft, start_month: Number(e.target.value) })}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <FieldHint description="Starting month for this period." />
        <span>–</span>
        <Select
          className="w-auto"
          value={draft.end_month}
          onChange={(e) => setDraft({ ...draft, end_month: Number(e.target.value) })}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <FieldHint description="Ending month for this period." />
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
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Bedding needs
        <FieldHint description="Bed preparation or maintenance this plant needs, e.g. hilling, staking, mulching." />
      </h2>
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
        <Input
          className="w-auto"
          placeholder="e.g. hilling, staking"
          value={needType}
          onChange={(e) => setNeedType(e.target.value)}
        />
        <FieldHint description="Bed preparation or maintenance this plant needs, e.g. hilling, staking, mulching." />
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

type PestInteractionType = "attracts" | "repels" | "vulnerable_to";

/** One column of the Pests table below - its own current entries plus a
 * plain text input that adds directly on Enter (no separate "Add" button,
 * matching #122's companions rework, just with free text instead of a
 * plant picker since a pest/insect isn't one of the app's own Plant rows).
 * Stays mounted across adds so its draft text is only cleared on a
 * successful add, not on every parent re-render. */
function PestColumn({
  interactionType,
  items,
  onAdd,
  onRemove,
}: {
  interactionType: PestInteractionType;
  items: PlantPestInteraction[];
  onAdd: (interactionType: PestInteractionType, pest: string) => void;
  onRemove: (item: PlantPestInteraction) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className={rowClass}>
          <span className="flex-1">{item.pest_or_insect}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${interactionType} pest interaction`}
            onClick={() => onRemove(item)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input
          placeholder="e.g. aphids"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const trimmed = draft.trim();
            if (!trimmed) return;
            onAdd(interactionType, trimmed);
            setDraft("");
          }}
        />
        <FieldHint description="Name of a pest or beneficial insect - press Enter to add." />
      </div>
    </div>
  );
}

export function PestInteractionsSection({ slug, items }: { slug: string; items: PlantPestInteraction[] }) {
  const { add, remove } = useSatelliteMutations<PlantPestInteraction>(slug, "pest_interactions", pestInteractionApi);

  function handleAdd(interactionType: PestInteractionType, pest: string) {
    add({ interaction_type: interactionType, pest_or_insect: pest, notes: null }, pest);
  }

  function handleRemove(item: PlantPestInteraction) {
    remove(item, item.pest_or_insect);
  }

  const attracts = items.filter((i) => i.interaction_type === "attracts");
  const repels = items.filter((i) => i.interaction_type === "repels");
  const vulnerableTo = items.filter((i) => i.interaction_type === "vulnerable_to");

  return (
    <section className={sectionClass}>
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Pest interactions
        <FieldHint description="Pests and beneficial insects this plant attracts, repels, or is vulnerable to." />
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Attracts
                <FieldHint description="Pests or insects this plant draws in." />
              </span>
            </th>
            <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Repels
                <FieldHint description="Pests or insects this plant naturally deters." />
              </span>
            </th>
            <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Vulnerable to
                <FieldHint description="Pests or diseases this plant is susceptible to." />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="w-1/3 pr-2 align-top">
              <PestColumn interactionType="attracts" items={attracts} onAdd={handleAdd} onRemove={handleRemove} />
            </td>
            <td className="w-1/3 px-2 align-top">
              <PestColumn interactionType="repels" items={repels} onAdd={handleAdd} onRemove={handleRemove} />
            </td>
            <td className="w-1/3 pl-2 align-top">
              <PestColumn
                interactionType="vulnerable_to"
                items={vulnerableTo}
                onAdd={handleAdd}
                onRemove={handleRemove}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** One "Good"/"Bad" column of the Companions table below - its own current
 * companions plus a small "+ Add plant" row (à la GitHub Projects' own
 * "+ Add item" kanban-column affordance, per the user's own follow-up on
 * #122) that opens a `PlantSearchList` popover only on click, rather than
 * the picker sitting permanently open inline. Closes again once a pick is
 * made (`onAdd` + `setPickerOpen(false)` together) or on outside-press/
 * Escape (Base UI's `Popover.Root` `onOpenChange`, same mechanism the
 * canvas editor's own `layout/PlantPicker.tsx` already uses for the
 * identical "click a button, search-and-pick, close" interaction - this is
 * that same shape, just anchored inline instead of to a toolbar button). */
function CompanionColumn({
  relationship,
  items,
  candidatePlants,
  onAdd,
  onRemove,
}: {
  relationship: "good" | "bad";
  items: PlantCompanion[];
  candidatePlants: Plant[];
  onAdd: (companionSlug: string, relationship: "good" | "bad") => void;
  onRemove: (item: PlantCompanion) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.companion_plant_slug} className={rowClass}>
          <span className="flex-1">{item.companion_plant_slug}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${relationship} companion`}
            onClick={() => onRemove(item)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div ref={anchorRef}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setPickerOpen(true)}
        >
          <Plus /> Add plant
        </Button>
      </div>
      <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <Popover.Portal>
          <Popover.Positioner anchor={anchorRef} side="bottom" align="start" sideOffset={4}>
            <Popover.Popup className="w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none">
              <PlantSearchList
                plants={candidatePlants}
                onPick={(companionSlug) => {
                  onAdd(companionSlug, relationship);
                  setPickerOpen(false);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export function CompanionsSection({
  slug,
  items,
  allPlants,
}: {
  slug: string;
  items: PlantCompanion[];
  allPlants: Plant[];
}) {
  const queryClient = useQueryClient();
  const { show } = useSnackbar();
  // Excludes the plant's own page from its candidate companion list - a
  // plant can't meaningfully be its own companion.
  const candidatePlants = allPlants.filter((p) => p.slug !== slug);

  function setList(updater: (list: PlantCompanion[]) => PlantCompanion[]) {
    queryClient.setQueryData<PlantDetail>(["plant", slug], (old) =>
      old ? { ...old, companions: updater(old.companions) } : old,
    );
  }

  function add(companionSlug: string, relationship: "good" | "bad") {
    const item = { companion_plant_slug: companionSlug, relationship };
    createCompanion(slug, item).then((created) => {
      setList((list) => [...list, created]);
      show(`Added companion ${created.companion_plant_slug}`, () => {
        deleteCompanion(slug, created.companion_plant_slug).then(() =>
          setList((list) => list.filter((c) => c.companion_plant_slug !== created.companion_plant_slug)),
        );
      });
    });
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

  const good = items.filter((c) => c.relationship === "good");
  const bad = items.filter((c) => c.relationship === "bad");

  return (
    <section className={sectionClass}>
      <h2 className="inline-flex items-center gap-1 text-sm font-semibold">
        Companions
        <FieldHint description="Other plants this one grows well or poorly alongside." />
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Good
                <FieldHint description="Plants that benefit this one when grown nearby." />
              </span>
            </th>
            <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Bad
                <FieldHint description="Plants that hinder this one when grown nearby." />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="w-1/2 pr-3 align-top">
              <CompanionColumn
                relationship="good"
                items={good}
                candidatePlants={candidatePlants}
                onAdd={add}
                onRemove={remove}
              />
            </td>
            <td className="w-1/2 pl-3 align-top">
              <CompanionColumn
                relationship="bad"
                items={bad}
                candidatePlants={candidatePlants}
                onAdd={add}
                onRemove={remove}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** View only, deliberately - the backend's growing_information route only
 * supports list/create/delete (no patch), and hand-authoring or deleting a
 * synthesized/sourced long-form book excerpt isn't a realistic user action
 * here (see the "Growing information display" backlog item). The
 * `consolidated` entry (the AI-generated summary of every `raw` source for
 * this plant) is the primary/only thing shown by default; the `raw`
 * sources themselves live behind a "sources" link that opens a popup,
 * rather than being stacked in the main view.
 *
 * #237 round 2: promoted out of the satellite/"Show more details" list up
 * to directly below Description (its only remaining call site,
 * `PlantDetail.tsx`) - restyled as a plain quiet block (no `<h2>`/no
 * `border-t` separator) since it now reads as an extension of the
 * description rather than one of the title+rule sections further down. */
export function GrowingInfoSection({ slug: _slug, items }: { slug: string; items: PlantGrowingInformation[] }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  if (items.length === 0) return null;

  const consolidated = items.find((i) => i.record_type === "consolidated");
  const sources = items.filter((i) => i.record_type !== "consolidated");

  return (
    <section className="flex flex-col gap-2">
      {consolidated ? (
        <div className="flex flex-col gap-1 rounded-md border p-2 text-sm">
          <p className="whitespace-pre-wrap">{consolidated.text}</p>
          <p className="text-xs text-muted-foreground">
            This text is an AI summary.
            {sources.length > 0 && (
              <>
                {" "}
                View{" "}
                <button type="button" className="underline" onClick={() => setSourcesOpen(true)}>
                  sources
                </button>
                .
              </>
            )}
          </p>
        </div>
      ) : (
        // No consolidated summary yet (the AI consolidation pass hasn't run
        // for this plant) - fall back to showing the source text(s)
        // directly, same as before this rework, just without a delete
        // button and with each one's own attribution linking to its
        // original text instead of a plain label.
        sources.map((item) => (
          <div key={item.id} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
            <p className="whitespace-pre-wrap">{item.text}</p>
            {item.attribution && (
              <p className="text-xs text-muted-foreground">
                {item.source_url ? (
                  <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">
                    {item.attribution}
                  </a>
                ) : (
                  item.attribution
                )}
              </p>
            )}
          </div>
        ))
      )}

      {consolidated && sources.length > 0 && (
        <AlertDialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
          <AlertDialogPopup className="max-w-lg">
            <AlertDialogTitle>Sources</AlertDialogTitle>
            <div className="mt-2 flex max-h-96 flex-col gap-3 overflow-y-auto text-sm">
              {sources.map((item) => (
                <div key={item.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                  <p className="whitespace-pre-wrap">{item.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.source_url ? (
                      <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">
                        {item.attribution || "Original text"}
                      </a>
                    ) : (
                      item.attribution
                    )}
                  </p>
                </div>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </section>
  );
}
