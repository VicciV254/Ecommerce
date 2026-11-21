import { useId, useState } from "react";
import { catalogAdminAPI, type Campaign, type MediaAsset, type StorefrontSettings } from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { sectionClaimProblem } from "../../store/storefrontClaims";
import { BEST_SELLERS_RULES, BEST_SELLERS_TITLE, CAROUSEL_SLIDES, RAIL_PRODUCT_LIMIT, sectionLayout, takesLayout, type SectionLayout } from "../../store/storefrontModel";
import { Feedback, Field, WrappingSelect, dangerButtonClass, inputClass, isAcceptedImageUrl, smallButtonClass } from "./shared";

/** Limits enforced by the storefront API, mirrored so the editor stays within them. */
export const STOREFRONT_LIMITS = { sections: 12, campaigns: 8, productIds: 24, categoryIds: 30 } as const;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PICKER_RESULTS = 40;

type Section = StorefrontSettings["sections"][number];
/** `name` is the record's own name where `label` is a longer path (a category under its parents). */
export type PickerItem = { id: string; label: string; note?: string; name?: string };

/** What staff call each section kind. */
export const SECTION_KIND_LABELS: Record<Section["type"], string> = {
  departments: "Departments", featured: "Featured products", products: "Selected products", campaign: "Campaign",
  category: "Department row", promises: "Shopping facts", bestSellers: BEST_SELLERS_TITLE, carousel: "Hero carousel",
};
/** A new section's heading. A department row's follows the department chosen, until staff write their own. */
export const NEW_SECTION_TITLES: Record<Section["type"], string> = {
  departments: "Shop by department", featured: "Featured products", products: "Selected products", campaign: "Campaign",
  category: "Department row", promises: "How shopping works", bestSellers: BEST_SELLERS_TITLE, carousel: "Highlights",
};
export const SECTION_LAYOUT_LABELS: Record<SectionLayout, string> = { rail: "Row you scroll", grid: "Grid" };
/** How the measured best sellers are chosen and when shoppers see them (the API's rules). */
export const BEST_SELLERS_RULE = `up to ${RAIL_PRODUCT_LIMIT} products, ranked by paid orders in the last ${BEST_SELLERS_RULES.windowDays} days, each bought by at least ${BEST_SELLERS_RULES.minBuyers} different accounts`;
export const BEST_SELLERS_SHOWN = `Shoppers don't see the row until at least ${BEST_SELLERS_RULES.minProducts} products qualify.`;
export const SHOPPING_FACTS_NOTE = "Shows four facts from the store's settings, each linking to its page: prices and VAT, delivery, payment and returns.";
/** How the hero carousel behaves for shoppers, for staff choosing its campaigns. */
export const CAROUSEL_NOTE = `Shows up to ${CAROUSEL_SLIDES.max} campaigns as full-width slides in this order, changing every 6 seconds. Shoppers can pause it, and it stays still for anyone who asks their device for less motion. The heading names the carousel for screen readers; it isn't shown.`;

/** Ordered selection of canonical IDs; unknown IDs stay visible so they can be removed. */
export function IdPicker({
  label, items, selected, max, onChange, emptyHint,
}: {
  label: string;
  items: PickerItem[];
  selected: string[];
  max: number;
  onChange: (ids: string[]) => void;
  emptyHint: string;
}) {
  const searchId = useId();
  const [term, setTerm] = useState("");
  const byId = new Map(items.map((item) => [item.id, item]));
  const query = term.trim().toLowerCase();
  const matches = query
    ? items.filter((item) => !selected.includes(item.id) && item.label.toLowerCase().includes(query)).slice(0, PICKER_RESULTS)
    : [];
  const move = (index: number, offset: number) => {
    const next = [...selected];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={searchId} className="block text-[0.625rem] font-bold uppercase tracking-wider text-gray-600">
        {label} ({selected.length}/{max})
      </label>
      {selected.length ? (
        <ol className="space-y-1">
          {selected.map((id, index) => {
            const item = byId.get(id);
            return (
              <li key={id} className="flex items-center justify-between gap-2 rounded-sm bg-off-white px-2 py-1 text-xs">
                <span className={item ? "text-charcoal" : "font-semibold text-error"}>
                  {item ? item.label : `Unavailable reference ${id}`}
                  {item?.note && <span className="ml-1.5 text-[0.625rem] font-bold uppercase text-ocean-blue">{item.note}</span>}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Move ${item?.label ?? id} up`} disabled={index === 0} onClick={() => move(index, -1)} className={smallButtonClass}>↑</button>
                  <button type="button" aria-label={`Move ${item?.label ?? id} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)} className={smallButtonClass}>↓</button>
                  <button type="button" aria-label={`Remove ${item?.label ?? id}`} onClick={() => onChange(selected.filter((value) => value !== id))} className={dangerButtonClass}>×</button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[0.6875rem] text-gray-600">{emptyHint}</p>
      )}
      <input id={searchId} value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search to add…" disabled={selected.length >= max} className={inputClass} />
      {matches.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-sm border border-light-gray">
          {matches.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { onChange([...selected, item.id]); setTerm(""); }} className="block w-full px-2 py-1.5 text-left text-xs hover:bg-off-white">
                {item.label}
                {item.note && <span className="ml-1.5 text-[0.625rem] font-bold uppercase text-ocean-blue">{item.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A section or campaign card. In a column narrower than 17rem at the current text size (a phone with enlarged text) it
 * keeps only a top rule, so its fields get the panel's whole width instead of a card inside the panel's card.
 */
const editorCardClass = "space-y-3 rounded-md border border-light-gray p-4 @max-[17rem]:rounded-none @max-[17rem]:border-x-0 @max-[17rem]:border-b-0 @max-[17rem]:px-0 @max-[17rem]:pb-0";

export function SectionEditor({
  section, index, count, campaigns, products, categories, onChange, onMove, onRemove,
}: {
  section: Section;
  index: number;
  count: number;
  campaigns: Campaign[];
  products: PickerItem[];
  categories: PickerItem[];
  onChange: (section: Section) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const typeLabel = SECTION_KIND_LABELS[section.type];
  const claimId = useId();
  const claim = sectionClaimProblem(section);
  const layout = takesLayout(section.type) ? sectionLayout({ ...section, type: section.type }) : null;
  const departmentName = (id: string | undefined) => {
    const item = categories.find((category) => category.id === id);
    return item && (item.name ?? item.label);
  };
  // The heading follows the department while it is the default or the current department's name.
  const chooseDepartment = (categoryIds: string[]) => {
    const automatic = section.title === NEW_SECTION_TITLES.category || section.title === departmentName(section.categoryIds[0]);
    const title = automatic ? departmentName(categoryIds[0]) ?? NEW_SECTION_TITLES.category : section.title;
    onChange({ ...section, categoryIds, title });
  };
  return (
    <article className={editorCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-accent">{index + 1}. {typeLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-primary">
            <input type="checkbox" checked={section.enabled} onChange={(event) => onChange({ ...section, enabled: event.target.checked })} className="h-4 w-4 accent-brand-secondary" />
            Shown
          </label>
          <button type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} className={smallButtonClass}>↑</button>
          <button type="button" aria-label={`Move section ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)} className={smallButtonClass}>↓</button>
          <button type="button" aria-label={`Remove section ${index + 1}`} onClick={onRemove} className={dangerButtonClass}>Remove</button>
        </div>
      </div>
      {section.type === "bestSellers" ? (
        <div>
          <p className="mb-1 text-[0.625rem] font-bold uppercase tracking-wider text-gray-600">Heading</p>
          <p className="text-sm font-semibold text-navy-900">{section.title}</p>
          <p className="mt-1 text-[0.6875rem] text-gray-600">
            {`This heading is fixed because the row is measured: ${BEST_SELLERS_RULE}. Sample orders and sandbox payments never count. ${BEST_SELLERS_SHOWN}`}
          </p>
        </div>
      ) : (
        <Field label="Heading">
          {(id) => (
            <>
              <input id={id} value={section.title} onChange={(event) => onChange({ ...section, title: event.target.value })}
                aria-invalid={claim ? true : undefined} aria-describedby={claim ? claimId : undefined}
                className={`${inputClass} aria-[invalid=true]:border-error`} />
              {claim && <p id={claimId} className="mt-1 text-xs font-semibold text-error [overflow-wrap:break-word]">{claim}</p>}
            </>
          )}
        </Field>
      )}
      {section.type === "promises" && (
        <p className="text-[0.6875rem] text-gray-600">{SHOPPING_FACTS_NOTE} The heading is read out by screen readers; it isn't shown.</p>
      )}
      {layout && (
        <Field label="Layout">
          {(id) => (
            <WrappingSelect id={id} value={layout} onChange={(event) => onChange({ ...section, layout: event.target.value === "grid" ? "grid" : "rail" })} className={inputClass}>
              <option value="rail">{SECTION_LAYOUT_LABELS.rail}</option>
              <option value="grid">{SECTION_LAYOUT_LABELS.grid}</option>
            </WrappingSelect>
          )}
        </Field>
      )}
      {section.type === "departments" && (
        <IdPicker label="Categories" items={categories} selected={section.categoryIds} max={STOREFRONT_LIMITS.categoryIds}
          onChange={(categoryIds) => onChange({ ...section, categoryIds })} emptyHint="Empty shows every top-level department." />
      )}
      {section.type === "category" && (
        <IdPicker label="Department" items={categories} selected={section.categoryIds} max={1}
          onChange={chooseDepartment} emptyHint="Choose the department whose products this row shows, in the shop's order." />
      )}
      {(section.type === "featured" || section.type === "products") && (
        <IdPicker label="Products" items={products} selected={section.productIds} max={STOREFRONT_LIMITS.productIds}
          onChange={(productIds) => onChange({ ...section, productIds })}
          emptyHint={section.type === "featured" ? "Empty shows products marked Featured." : "Choose at least one product."} />
      )}
      {section.type === "campaign" && (
        <Field label="Campaign">
          {(id) => (
            <WrappingSelect id={id} value={section.campaignId ?? ""} onChange={(event) => onChange({ ...section, campaignId: event.target.value || null })} className={inputClass}>
              <option value="">Choose a campaign…</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
            </WrappingSelect>
          )}
        </Field>
      )}
      {section.type === "carousel" && (
        <>
          <p className="text-[0.6875rem] text-gray-600">{CAROUSEL_NOTE}</p>
          <IdPicker label="Campaigns" items={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.title }))}
            selected={section.campaignIds ?? []} max={CAROUSEL_SLIDES.max}
            onChange={(campaignIds) => onChange({ ...section, campaignIds })} emptyHint="Choose the campaigns to show, first slide first." />
        </>
      )}
    </article>
  );
}

function mediaLabel(asset: MediaAsset) {
  const name = asset.alt || asset.url.split("/").pop() || asset.url;
  return asset.isPlaceholder ? `${name} (sample image)` : name;
}

/** Choose existing media or register an external URL (metadata only; uploads come later). */
export function MediaPicker({
  label, value, media, disabled, onChange, onRegistered,
}: {
  label: string;
  value: string | null;
  media: MediaAsset[];
  disabled?: boolean;
  onChange: (id: string | null) => void;
  onRegistered: (asset: MediaAsset) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const known = value === null || media.some((asset) => asset.id === value);
  const valid = isAcceptedImageUrl(url.trim()) && (!isPlaceholder || (isAcceptedImageUrl(sourceUrl.trim()) && Boolean(license.trim())));

  const register = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await catalogAdminAPI.registerMedia({
        url: url.trim(),
        alt: alt.trim() || null,
        isPlaceholder,
        sourceUrl: sourceUrl.trim() || null,
        license: license.trim() || null,
      });
      onRegistered(data);
      onChange(data.id);
      setAdding(false);
      setUrl("");
      setAlt("");
      setSourceUrl("");
      setLicense("");
      setIsPlaceholder(false);
    } catch (reason) {
      setError(describeApiError(reason, "The image could not be registered."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Field label={label}>
        {(id) => (
          <WrappingSelect id={id} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value || null)} className={inputClass}>
            <option value="">None</option>
            {!known && value && <option value={value}>Unavailable media {value}</option>}
            {media.map((asset) => <option key={asset.id} value={asset.id}>{mediaLabel(asset)}</option>)}
          </WrappingSelect>
        )}
      </Field>
      {!known && <p className="text-[0.6875rem] font-semibold text-error">The selected media is not loaded; choose another image.</p>}
      {!disabled && (
        adding ? (
          <div className="space-y-2 rounded-sm border border-light-gray p-2">
            <input aria-label={`${label}: image URL`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" className={inputClass} />
            <input aria-label={`${label}: alt text`} value={alt} onChange={(event) => setAlt(event.target.value)} placeholder="Alt text (blank if decorative)" className={inputClass} />
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={isPlaceholder} onChange={(event) => setIsPlaceholder(event.target.checked)} className="accent-brand-secondary" />
              Sample image (needs source and licence)
            </label>
            {isPlaceholder && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label={`${label}: source URL`} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Source page (https://…)" className={inputClass} />
                <input aria-label={`${label}: licence`} value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Reuse licence" className={inputClass} />
              </div>
            )}
            <Feedback message={error} tone="error" />
            <div className="flex gap-2">
              <button type="button" disabled={!valid || saving} onClick={() => void register()} className={smallButtonClass}>{saving ? "Registering…" : "Register image"}</button>
              <button type="button" onClick={() => setAdding(false)} className={smallButtonClass}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={smallButtonClass}>+ Image URL</button>
        )
      )}
    </div>
  );
}

const PERCENT_MAX = 100;

function FocalInputs({ label, value, onChange }: { label: string; value: Campaign["desktopFocal"]; onChange: (focal: Campaign["desktopFocal"]) => void }) {
  const clamp = (input: string) => Math.min(PERCENT_MAX, Math.max(0, Number(input) || 0));
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="mb-1 text-[0.625rem] font-bold uppercase tracking-wider text-gray-600">{label} (0–100%)</legend>
      <input aria-label={`${label} horizontal`} type="number" min={0} max={PERCENT_MAX} value={value.x} onChange={(event) => onChange({ ...value, x: clamp(event.target.value) })} className={inputClass} />
      <input aria-label={`${label} vertical`} type="number" min={0} max={PERCENT_MAX} value={value.y} onChange={(event) => onChange({ ...value, y: clamp(event.target.value) })} className={inputClass} />
    </fieldset>
  );
}

export function CampaignEditor({
  campaign, usedBy, media, products, categories, onChange, onRemove, onRegistered,
}: {
  campaign: Campaign;
  usedBy: string[];
  media: MediaAsset[];
  products: PickerItem[];
  categories: PickerItem[];
  onChange: (campaign: Campaign) => void;
  onRemove: () => void;
  onRegistered: (asset: MediaAsset) => void;
}) {
  const targets = campaign.cta.target === "category" ? categories : products;
  return (
    <article className={editorCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-brand-accent">Campaign “{campaign.id}”</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={usedBy.length > 0}
          title={usedBy.length ? `Used by: ${usedBy.join(", ")}` : undefined}
          className={dangerButtonClass}
        >
          Remove
        </button>
      </div>
      {usedBy.length > 0 && <p className="text-[0.6875rem] text-gray-600">Used by: {usedBy.join(", ")}. Take it out of those sections before deleting it.</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Headline">{(id) => <input id={id} value={campaign.title} onChange={(event) => onChange({ ...campaign, title: event.target.value })} className={inputClass} />}</Field>
        <Field label="Layout">
          {(id) => (
            <WrappingSelect id={id} value={campaign.layout} onChange={(event) => onChange({ ...campaign, layout: event.target.value === "overlay" ? "overlay" : event.target.value === "banner" ? "banner" : "split" })} className={inputClass}>
              <option value="split">Split (text beside image)</option>
              <option value="overlay">Overlay (text on image)</option>
              <option value="banner">Banner (compact)</option>
            </WrappingSelect>
          )}
        </Field>
      </div>
      <Field label="Body">{(id) => <textarea id={id} rows={2} value={campaign.body} onChange={(event) => onChange({ ...campaign, body: event.target.value })} className={inputClass} />}</Field>
      <Field label="Conditions" hint="Shown at every screen size alongside the call to action.">
        {(id) => <textarea id={id} rows={2} value={campaign.conditions} onChange={(event) => onChange({ ...campaign, conditions: event.target.value })} className={inputClass} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Button label">{(id) => <input id={id} value={campaign.cta.label} onChange={(event) => onChange({ ...campaign, cta: { ...campaign.cta, label: event.target.value } })} className={inputClass} />}</Field>
        <Field label="Button destination">
          {(id) => (
            <WrappingSelect
              id={id}
              value={campaign.cta.target}
              onChange={(event) => {
                const target = event.target.value === "category" ? "category" : event.target.value === "product" ? "product" : "shop";
                onChange({ ...campaign, cta: { ...campaign.cta, target, targetId: null } });
              }}
              className={inputClass}
            >
              <option value="shop">All products</option>
              <option value="category">A category</option>
              <option value="product">A product</option>
            </WrappingSelect>
          )}
        </Field>
        {campaign.cta.target !== "shop" && (
          <Field label={campaign.cta.target === "category" ? "Category" : "Product"}>
            {(id) => (
              <WrappingSelect id={id} value={campaign.cta.targetId ?? ""} onChange={(event) => onChange({ ...campaign, cta: { ...campaign.cta, targetId: event.target.value || null } })} className={inputClass}>
                <option value="">Choose…</option>
                {campaign.cta.targetId && !targets.some((item) => item.id === campaign.cta.targetId) && (
                  <option value={campaign.cta.targetId}>Unavailable reference {campaign.cta.targetId}</option>
                )}
                {targets.map((item) => <option key={item.id} value={item.id}>{item.label}{item.note ? ` (${item.note})` : ""}</option>)}
              </WrappingSelect>
            )}
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <MediaPicker label="Desktop image" value={campaign.desktopMediaId} media={media} onRegistered={onRegistered}
            onChange={(desktopMediaId) => onChange({ ...campaign, desktopMediaId, mobileMediaId: desktopMediaId ? campaign.mobileMediaId : null })} />
          <FocalInputs label="Desktop focal point" value={campaign.desktopFocal} onChange={(desktopFocal) => onChange({ ...campaign, desktopFocal })} />
        </div>
        <div className="space-y-2">
          <MediaPicker label="Mobile image (optional)" value={campaign.mobileMediaId} media={media} disabled={!campaign.desktopMediaId} onRegistered={onRegistered}
            onChange={(mobileMediaId) => onChange({ ...campaign, mobileMediaId })} />
          <FocalInputs label="Mobile focal point" value={campaign.mobileFocal} onChange={(mobileFocal) => onChange({ ...campaign, mobileFocal })} />
          <p className="text-[0.6875rem] text-gray-600">Without mobile artwork, phones show the desktop image cropped at the mobile focal point.</p>
        </div>
      </div>
    </article>
  );
}
