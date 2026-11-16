import { useMemo } from "react";
import type { Campaign, StorefrontSettings } from "../../api/catalog";
import { COLOR_SLOTS, FONT_OPTIONS } from "../../store/storefrontTheme";
import { Link } from "../../router";
import { useAdminCatalog } from "./AdminCatalogContext";
import { ADMIN_PREVIEW_ROUTE } from "./adminRoutes";
import { CampaignEditor, STOREFRONT_LIMITS, SectionEditor, type PickerItem } from "./StorefrontEditors";
import { draftProblems, useStorefrontDraft } from "./StorefrontDraft";
import { StorefrontSummary } from "./StorefrontSummary";
import { Feedback, Field, Panel, categoryOptions, inputClass, primaryButtonClass, smallButtonClass } from "./shared";

type Section = StorefrontSettings["sections"][number];

const CENTRED_FOCAL = { x: 50, y: 50 };

function uniqueId(base: string, taken: string[]) {
  let candidate = base;
  for (let suffix = 2; taken.includes(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

/**
 * The storefront draft editor. The draft lives in the Storefront group's `StorefrontDraftProvider`, so the separate
 * draft preview shows unsaved edits and returning here keeps them. Roles that cannot write read the draft as text.
 */
export function StorefrontManager({ canWrite }: { canWrite: boolean }) {
  const { data, categories } = useAdminCatalog();
  const { load, settings, dirty, busy, notice, stale, media, unresolved, update, register, reloadDraft, save, publish } = useStorefrontDraft();

  const products = useMemo(() => data?.snapshot.products ?? [], [data]);
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
  const problems = [
    ...draftProblems(settings),
    ...unresolved.filter((reference) => reference.repairable).map((reference) => `${reference.label} (${reference.id}) is unavailable; choose another image.`),
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Storefront"
        description={`Draft version ${draft.version}. ${draft.publishedAt ? `Last published ${new Date(draft.publishedAt).toLocaleString("en-KE")} (version ${draft.publishedVersion}).` : "Not published yet."} Saving a draft never changes what shoppers see; publishing does.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={ADMIN_PREVIEW_ROUTE} className={`inline-flex items-center ${smallButtonClass}`}>Draft preview</Link>
            {canWrite && (
              <>
                <button type="button" onClick={reloadDraft} disabled={busy !== ""} className={smallButtonClass}>{dirty ? "Discard changes" : "Reload draft"}</button>
                <button type="button" onClick={() => void save()} disabled={!dirty || problems.length > 0 || busy !== ""} className={primaryButtonClass}>{busy === "save" ? "Saving…" : "Save draft"}</button>
                <button type="button" onClick={() => void publish()} disabled={dirty || unresolved.length > 0 || busy !== ""} title={dirty ? "Save the draft before publishing" : unresolved.length ? "Repair unavailable media first" : undefined} className={primaryButtonClass}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
              </>
            )}
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
          {!canWrite && <p className="text-sm text-navy-800">View only: your role can see the storefront draft and its preview but cannot change them.</p>}
        </div>
      </Panel>

      {!canWrite && <StorefrontSummary settings={settings} media={media} products={productItems} categories={categoryItems} />}

      {canWrite && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Brand">
              <div className="space-y-3">
                <Field label="Store name">{(id) => <input id={id} value={settings.brand.name} onChange={(event) => update({ ...settings, brand: { ...settings.brand, name: event.target.value } })} className={inputClass} />}</Field>
                <Field label="Tagline (optional)">{(id) => <input id={id} value={settings.brand.tagline} onChange={(event) => update({ ...settings, brand: { ...settings.brand, tagline: event.target.value } })} className={inputClass} />}</Field>
                <p className="text-[11px] text-gray-600">The Apex Cart mark is built into the site; the store name is shown beside it in the header, footer and sign-in screens.</p>
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
                  onRegistered={register}
                />
              ))}
              {!settings.campaigns.length && <p className="text-sm text-gray-600">No campaigns yet.</p>}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
