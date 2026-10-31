import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { catalogAdminAPI, type Campaign, type MediaAsset, type StorefrontDraft, type StorefrontSettings } from "../../api/catalog";
import { apiStatus, describeApiError } from "../../api/errors";
import { StorefrontSections } from "../../components/StorefrontSections";
import { useStorefront } from "../../store/StorefrontContext";
import { isMedia, isStorefrontSettings } from "../../store/storefrontModel";
import { COLOR_SLOTS, FONT_OPTIONS, ensureFontStylesheet, themeVariables, type ThemeVariables } from "../../store/storefrontTheme";
import { isRecord } from "../../utils/storage";
import { useAdminCatalog } from "./AdminCatalogContext";
import { CampaignEditor, SLUG, STOREFRONT_LIMITS, SectionEditor, type PickerItem } from "./StorefrontEditors";
import { Feedback, Field, Panel, categoryOptions, inputClass, primaryButtonClass, smallButtonClass } from "./shared";

type Section = StorefrontSettings["sections"][number];
type DraftLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; draft: StorefrontDraft };
type Notice = { text: string; tone: "error" | "success" };

const PREVIEW_FONT_LINK_ID = "apex-cart-preview-font-link";
const CENTRED_FOCAL = { x: 50, y: 50 };

function parseDraft(data: unknown): StorefrontDraft | null {
  if (!isRecord(data) || typeof data.version !== "number" || typeof data.publishedVersion !== "number") return null;
  if (!(data.publishedAt === null || typeof data.publishedAt === "string") || !isStorefrontSettings(data.settings)) return null;
  const { media, unavailableMediaIds } = data;
  if (!Array.isArray(media) || !media.every(isMedia)) return null;
  if (!Array.isArray(unavailableMediaIds) || !unavailableMediaIds.every((id) => typeof id === "string")) return null;
  return {
    version: data.version, publishedVersion: data.publishedVersion, publishedAt: data.publishedAt,
    settings: data.settings, media, unavailableMediaIds,
  };
}

/** Every media reference in the settings, labelled by where it is used. */
function mediaReferences(settings: StorefrontSettings): { id: string; label: string; repairable: boolean }[] {
  const references: { id: string; label: string; repairable: boolean }[] = [];
  if (settings.brand.logoMediaId) references.push({ id: settings.brand.logoMediaId, label: "Brand logo", repairable: false });
  if (settings.brand.faviconMediaId) references.push({ id: settings.brand.faviconMediaId, label: "Browser icon", repairable: false });
  for (const campaign of settings.campaigns) {
    if (campaign.desktopMediaId) references.push({ id: campaign.desktopMediaId, label: `Campaign "${campaign.title}" desktop image`, repairable: true });
    if (campaign.mobileMediaId) references.push({ id: campaign.mobileMediaId, label: `Campaign "${campaign.title}" mobile image`, repairable: true });
  }
  return references;
}

function uniqueId(base: string, taken: string[]) {
  let candidate = base;
  for (let suffix = 2; taken.includes(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

/** Problems the API would reject, listed before a save is attempted. */
function draftProblems(settings: StorefrontSettings): string[] {
  const problems: string[] = [];
  if (!settings.brand.name.trim()) problems.push("Enter a store name.");
  const campaignIds = new Set(settings.campaigns.map((campaign) => campaign.id));
  for (const section of settings.sections) {
    if (!section.title.trim()) problems.push("Every section needs a heading.");
    if (section.type === "products" && !section.productIds.length) problems.push(`"${section.title || "Selected products"}" needs at least one product.`);
    if (section.type === "campaign" && (!section.campaignId || !campaignIds.has(section.campaignId))) problems.push(`"${section.title || "Campaign"}" needs a campaign.`);
  }
  for (const campaign of settings.campaigns) {
    if (!SLUG.test(campaign.id)) problems.push(`Campaign ID "${campaign.id}" must use lowercase letters, numbers and hyphens.`);
    if (!campaign.title.trim()) problems.push("Every campaign needs a headline.");
    if (!campaign.cta.label.trim()) problems.push(`Campaign "${campaign.title}" needs a button label.`);
    if (campaign.cta.target !== "shop" && !campaign.cta.targetId) problems.push(`Campaign "${campaign.title}" needs a button destination.`);
  }
  return [...new Set(problems)];
}

export function StorefrontManager({ showToast, onDirtyChange }: {
  showToast: (message: string) => void;
  /** Lets the admin shell confirm before unsaved draft edits are discarded. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const published = useStorefront();
  const { data, categories } = useAdminCatalog();
  const [load, setLoad] = useState<DraftLoad>({ status: "loading" });
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "publish">("");
  const [notice, setNotice] = useState<Notice>({ text: "", tone: "success" });
  const [stale, setStale] = useState(false);
  const [preview, setPreview] = useState(false);
  const [registered, setRegistered] = useState<MediaAsset[]>([]);
  const [attempt, setAttempt] = useState(0);

  const reloadDraft = useCallback(() => {
    setLoad({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    catalogAdminAPI.getStorefrontDraft()
      .then(({ data: body }) => {
        const draft = parseDraft(body);
        if (!current) return;
        if (!draft) {
          setLoad({ status: "error", message: "The storefront draft was not in the expected format." });
          return;
        }
        setLoad({ status: "ready", draft });
        setSettings(draft.settings);
        setDirty(false);
        setStale(false);
      })
      .catch((reason: unknown) => {
        if (current) setLoad({ status: "error", message: describeApiError(reason, "The storefront draft could not be loaded.") });
      });
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (!preview || !settings) return;
    ensureFontStylesheet(settings.theme.fontId, PREVIEW_FONT_LINK_ID);
    return () => document.getElementById(PREVIEW_FONT_LINK_ID)?.remove();
  }, [preview, settings]);

  const products = useMemo(() => data?.snapshot.products ?? [], [data]);
  const loadedDraft = load.status === "ready" ? load.draft : null;
  // Saved references resolve through the draft's authenticated media list; product images and
  // images registered in this session are offered as new choices. Unavailable IDs never resolve.
  const media = useMemo(() => {
    const assets = new Map<string, MediaAsset>();
    for (const asset of loadedDraft?.media ?? []) assets.set(asset.id, asset);
    for (const product of products) for (const image of product.images) assets.set(image.id, image);
    for (const asset of registered) assets.set(asset.id, asset);
    for (const id of loadedDraft?.unavailableMediaIds ?? []) assets.delete(id);
    return [...assets.values()];
  }, [loadedDraft, products, registered]);
  const mediaById = useMemo(() => new Map(media.map((asset) => [asset.id, asset])), [media]);
  const productItems = useMemo<PickerItem[]>(() => products.map((product) => ({
    id: product.id,
    label: product.name,
    note: [!product.isActive && "hidden", product.isDemo && "demo"].filter(Boolean).join(", ") || undefined,
  })), [products]);
  const categoryItems = useMemo<PickerItem[]>(() => categoryOptions(categories).map((option) => ({
    id: option.id,
    label: option.label,
    note: option.category.isActive ? undefined : "hidden",
  })), [categories]);

  if (load.status === "loading" || (load.status === "ready" && !settings)) {
    return <Panel title="Storefront"><p role="status" className="text-sm text-gray-600">Loading the storefront draft…</p></Panel>;
  }
  if (load.status === "error" || !settings) {
    return (
      <Panel title="Storefront">
        <Feedback message={load.status === "error" ? load.message : "The storefront draft is unavailable."} tone="error" />
        <button type="button" onClick={reloadDraft} className={`mt-3 ${smallButtonClass}`}>Try again</button>
      </Panel>
    );
  }
  const draft = load.draft;

  const update = (next: StorefrontSettings) => {
    setSettings(next);
    setDirty(true);
    setNotice({ text: "", tone: "success" });
  };
  const updateSection = (index: number, section: Section) =>
    update({ ...settings, sections: settings.sections.map((item, position) => (position === index ? section : item)) });
  const moveSection = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= settings.sections.length) return;
    const sections = [...settings.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    update({ ...settings, sections });
  };
  const addSection = (type: Section["type"]) => {
    const id = uniqueId(type, settings.sections.map((section) => section.id));
    const title = { departments: "Shop by department", featured: "Featured products", products: "Selected products", campaign: "Campaign" }[type];
    update({ ...settings, sections: [...settings.sections, { id, type, title, enabled: false, productIds: [], categoryIds: [], campaignId: null }] });
  };
  const addCampaign = () => {
    const id = uniqueId("campaign", settings.campaigns.map((campaign) => campaign.id));
    const campaign: Campaign = {
      id, title: "New campaign", body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
      desktopMediaId: null, mobileMediaId: null, desktopFocal: CENTRED_FOCAL, mobileFocal: CENTRED_FOCAL, layout: "split",
    };
    update({ ...settings, campaigns: [...settings.campaigns, campaign] });
  };
  const unresolved = mediaReferences(settings).filter((reference) => !mediaById.has(reference.id));
  const problems = [
    ...draftProblems(settings),
    ...unresolved.filter((reference) => reference.repairable).map((reference) => `${reference.label} (${reference.id}) is unavailable; choose another image.`),
  ];

  const save = async () => {
    setBusy("save");
    setNotice({ text: "", tone: "success" });
    try {
      const { data: body } = await catalogAdminAPI.saveStorefrontDraft(draft.version, settings);
      const saved = parseDraft(body);
      if (!saved) throw new Error("Unexpected draft response");
      setLoad({ status: "ready", draft: saved });
      setSettings(saved.settings);
      setDirty(false);
      setNotice({ text: "Draft saved. Shoppers still see the published version.", tone: "success" });
    } catch (reason) {
      setStale(apiStatus(reason) === 409);
      setNotice({ text: describeApiError(reason, "The draft could not be saved."), tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const publish = async () => {
    setBusy("publish");
    setNotice({ text: "", tone: "success" });
    try {
      await catalogAdminAPI.publishStorefront(draft.version);
      showToast("Storefront published");
      published.reload();
      reloadDraft();
    } catch (reason) {
      setStale(apiStatus(reason) === 409);
      setNotice({ text: describeApiError(reason, "The storefront could not be published."), tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const previewStyle: CSSProperties & ThemeVariables = { ...themeVariables(settings.theme), fontFamily: "var(--font-body)" };

  return (
    <div className="space-y-6">
      <Panel
        title="Storefront"
        description={`Draft version ${draft.version}. ${draft.publishedAt ? `Last published ${new Date(draft.publishedAt).toLocaleString("en-KE")} (version ${draft.publishedVersion}).` : "Not published yet."} Saving a draft never changes what shoppers see; publishing does.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPreview((open) => !open)} aria-pressed={preview} className={smallButtonClass}>{preview ? "Hide Preview" : "Preview Draft"}</button>
            <button type="button" onClick={reloadDraft} disabled={busy !== ""} className={smallButtonClass}>{dirty ? "Discard Changes" : "Reload Draft"}</button>
            <button type="button" onClick={() => void save()} disabled={!dirty || problems.length > 0 || busy !== ""} className={primaryButtonClass}>{busy === "save" ? "Saving…" : "Save Draft"}</button>
            <button type="button" onClick={() => void publish()} disabled={dirty || unresolved.length > 0 || busy !== ""} title={dirty ? "Save the draft before publishing" : unresolved.length ? "Repair unavailable media first" : undefined} className={primaryButtonClass}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
          </div>
        }
      >
        <div className="space-y-3">
          <Feedback message={notice.text} tone={notice.tone} />
          {stale && (
            <p className="text-xs text-charcoal">
              Someone else changed the storefront. <button type="button" onClick={reloadDraft} className="font-bold underline">Reload the latest draft</button> and reapply your edits.
            </p>
          )}
          {unresolved.length > 0 && (
            <div role="note" className="rounded-md border border-error/30 bg-error/10 p-3 text-xs text-charcoal">
              <p className="font-bold text-error">Unavailable media references</p>
              <ul className="mt-1 list-inside list-disc">
                {unresolved.map((reference) => <li key={`${reference.label}-${reference.id}`}>{reference.label}: {reference.id}</li>)}
              </ul>
              <p className="mt-1">They stay in the draft until replaced. Saving and publishing are refused while they remain.</p>
            </div>
          )}
          {problems.length > 0 && (
            <ul className="list-inside list-disc rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          {dirty && <p className="text-xs font-semibold text-warning">Unsaved changes</p>}
        </div>
      </Panel>

      {preview && (
        <section aria-label="Draft preview" className="overflow-hidden rounded-lg border-2 border-dashed border-brand-secondary">
          <p className="bg-brand-secondary px-4 py-2 text-xs font-bold uppercase tracking-wider text-brand-primary">
            Draft preview at this screen width — not visible to shoppers. Unavailable references are listed.
          </p>
          <div style={previewStyle} className="bg-off-white text-charcoal">
            <p className="px-6 pt-6 font-display text-2xl uppercase tracking-[0.12em] text-brand-primary">{settings.brand.name}</p>
            <StorefrontSections settings={settings} mediaById={mediaById} showProblems />
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Brand">
          <div className="space-y-3">
            <Field label="Store name">{(id) => <input id={id} value={settings.brand.name} onChange={(event) => update({ ...settings, brand: { ...settings.brand, name: event.target.value } })} className={inputClass} />}</Field>
            <Field label="Tagline (optional)">{(id) => <input id={id} value={settings.brand.tagline} onChange={(event) => update({ ...settings, brand: { ...settings.brand, tagline: event.target.value } })} className={inputClass} />}</Field>
            <p className="text-[11px] text-gray-600">Logo and icon artwork are prepared separately; the store name is shown as text until a logo is published.</p>
          </div>
        </Panel>

        <Panel title="Theme">
          <div className="space-y-3">
            <Field label="Fonts">
              {(id) => (
                <select id={id} value={settings.theme.fontId} onChange={(event) => {
                  const font = FONT_OPTIONS.find((option) => option.id === event.target.value);
                  if (font) update({ ...settings, theme: { ...settings.theme, fontId: font.id } });
                }} className={inputClass}>
                  {FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COLOR_SLOTS.map((slot) => (
                <label key={slot.key} className="flex items-center gap-2 text-[11px] text-charcoal">
                  <input
                    type="color"
                    value={settings.theme.colors[slot.key]}
                    onChange={(event) => update({ ...settings, theme: { ...settings.theme, colors: { ...settings.theme.colors, [slot.key]: event.target.value } } })}
                    className="h-8 w-8 shrink-0 cursor-pointer rounded-sm border border-light-gray bg-transparent"
                  />
                  <span>{slot.label}</span>
                </label>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title={`Sections (${settings.sections.length}/${STOREFRONT_LIMITS.sections})`}
        description="Sections appear on the home page in this order. New sections start hidden."
        actions={
          <div className="flex flex-wrap gap-1">
            {(["departments", "featured", "products", "campaign"] as const).map((type) => (
              <button key={type} type="button" disabled={settings.sections.length >= STOREFRONT_LIMITS.sections} onClick={() => addSection(type)} className={smallButtonClass}>
                + {type}
              </button>
            ))}
          </div>
        }
      >
        <div className="space-y-3">
          {settings.sections.map((section, index) => (
            <SectionEditor
              key={section.id}
              section={section}
              index={index}
              count={settings.sections.length}
              campaigns={settings.campaigns}
              products={productItems}
              categories={categoryItems}
              onChange={(next) => updateSection(index, next)}
              onMove={(offset) => moveSection(index, offset)}
              onRemove={() => update({ ...settings, sections: settings.sections.filter((_, position) => position !== index) })}
            />
          ))}
          {!settings.sections.length && <p className="text-sm text-gray-600">No sections. The home page will say that nothing is published yet.</p>}
        </div>
      </Panel>

      <Panel
        title={`Campaigns (${settings.campaigns.length}/${STOREFRONT_LIMITS.campaigns})`}
        description="One campaign keeps the same copy, conditions and destination at every screen size; only artwork and cropping differ."
        actions={<button type="button" disabled={settings.campaigns.length >= STOREFRONT_LIMITS.campaigns} onClick={addCampaign} className={smallButtonClass}>+ Campaign</button>}
      >
        <div className="space-y-3">
          {settings.campaigns.map((campaign, index) => (
            <CampaignEditor
              key={`${index}-${campaign.id}`}
              campaign={campaign}
              usedBy={settings.sections.filter((section) => section.campaignId === campaign.id).map((section) => section.title)}
              media={media}
              products={productItems}
              categories={categoryItems}
              onChange={(next) => update({ ...settings, campaigns: settings.campaigns.map((item, position) => (position === index ? next : item)) })}
              onRemove={() => update({ ...settings, campaigns: settings.campaigns.filter((_, position) => position !== index) })}
              onRegistered={(asset) => setRegistered((assets) => [...assets, asset])}
            />
          ))}
          {!settings.campaigns.length && <p className="text-sm text-gray-600">No campaigns yet.</p>}
        </div>
      </Panel>
    </div>
  );
}
