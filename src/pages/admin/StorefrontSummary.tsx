import type { Campaign, MediaAsset, StorefrontSettings } from "../../api/catalog";
import { COLOR_SLOTS, FONT_OPTIONS } from "../../store/storefrontTheme";
import { sectionLayout, takesLayout } from "../../store/storefrontModel";
import {
  BEST_SELLERS_RULE, BEST_SELLERS_SHOWN, SECTION_KIND_LABELS, SECTION_LAYOUT_LABELS, SHOPPING_FACTS_NOTE, type PickerItem,
} from "./StorefrontEditors";
import { Panel } from "./shared";

const LAYOUTS: Record<Campaign["layout"], string> = {
  split: "Split (text beside image)", overlay: "Overlay (text on image)", banner: "Banner (compact)",
};

const termClass = "text-xs font-semibold text-muted";
const valueClass = "text-sm text-navy-900 [overflow-wrap:anywhere]";

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-x-6 gap-y-3">
      {rows.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className={termClass}>{term}</dt>
          <dd className={valueClass}>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function names(ids: readonly string[], items: readonly PickerItem[], emptyText: string) {
  if (!ids.length) return emptyText;
  const byId = new Map(items.map((item) => [item.id, item.label]));
  return ids.map((id) => byId.get(id) ?? `Unavailable reference ${id}`).join(", ");
}

function mediaName(id: string | null, media: readonly MediaAsset[]) {
  if (!id) return "None";
  const asset = media.find((item) => item.id === id);
  if (!asset) return `Unavailable media ${id}`;
  const name = asset.alt || asset.url.split("/").pop() || asset.url;
  return asset.isPlaceholder ? `${name} (sample image)` : name;
}

/**
 * The storefront draft as text, for roles that may read it but not change it: no field looks editable, and the draft
 * preview shows how it renders.
 */
export function StorefrontSummary({ settings, media, products, categories }: {
  settings: StorefrontSettings;
  media: readonly MediaAsset[];
  products: readonly PickerItem[];
  categories: readonly PickerItem[];
}) {
  const font = FONT_OPTIONS.find((option) => option.id === settings.theme.fontId)?.label ?? settings.theme.fontId;
  const destination = (campaign: Campaign) => {
    if (campaign.cta.target === "shop") return "All products";
    const items = campaign.cta.target === "category" ? categories : products;
    const kind = campaign.cta.target === "category" ? "Category" : "Product";
    return `${kind}: ${names(campaign.cta.targetId ? [campaign.cta.targetId] : [], items, "not chosen")}`;
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Brand">
          <Facts rows={[["Store name", settings.brand.name], ["Tagline", settings.brand.tagline]]} />
        </Panel>
        <Panel title="Theme">
          <Facts rows={[["Fonts", font]]} />
          <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-2">
            {COLOR_SLOTS.map((slot) => (
              <li key={slot.key} className="flex min-w-0 items-center gap-2 text-sm text-navy-800">
                <span aria-hidden="true" className="size-[24px] shrink-0 rounded-sm border border-control" style={{ backgroundColor: settings.theme.colors[slot.key] }} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{slot.label}: <span className="font-mono text-xs">{settings.theme.colors[slot.key]}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title={`Sections (${settings.sections.length})`} description="Sections appear on the home page in this order.">
        {settings.sections.length ? (
          <ol className="space-y-3">
            {settings.sections.map((section, index) => (
              <li key={section.id} className="rounded-md border border-divider p-[16px]">
                <p className="text-xs font-semibold text-gold-text">{index + 1}. {SECTION_KIND_LABELS[section.type]} · {section.enabled ? "Shown" : "Hidden"}</p>
                <p className="mt-1 font-semibold text-navy-900 [overflow-wrap:anywhere]">{section.title || "Untitled section"}</p>
                {section.type === "departments" && (
                  <p className="mt-1 text-sm text-navy-800 [overflow-wrap:anywhere]">Categories: {names(section.categoryIds, categories, "every top-level department")}</p>
                )}
                {(section.type === "featured" || section.type === "products") && (
                  <p className="mt-1 text-sm text-navy-800 [overflow-wrap:anywhere]">
                    Products: {names(section.productIds, products, section.type === "featured" ? "products marked Featured" : "none chosen")}
                  </p>
                )}
                {section.type === "category" && (
                  <p className="mt-1 text-sm text-navy-800 [overflow-wrap:anywhere]">Department: {names(section.categoryIds, categories, "not chosen")}</p>
                )}
                {section.type === "promises" && <p className="mt-1 text-sm text-navy-800">{SHOPPING_FACTS_NOTE}</p>}
                {section.type === "bestSellers" && <p className="mt-1 text-sm text-navy-800">{`Measured: ${BEST_SELLERS_RULE}. ${BEST_SELLERS_SHOWN}`}</p>}
                {section.type === "campaign" && (
                  <p className="mt-1 text-sm text-navy-800 [overflow-wrap:anywhere]">
                    Campaign: {settings.campaigns.find((campaign) => campaign.id === section.campaignId)?.title ?? "not chosen"}
                  </p>
                )}
                {section.type === "carousel" && (
                  <p className="mt-1 text-sm text-navy-800 [overflow-wrap:anywhere]">
                    Campaigns: {names(section.campaignIds ?? [], settings.campaigns.map((campaign) => ({ id: campaign.id, label: campaign.title })), "none chosen")}
                  </p>
                )}
                {takesLayout(section.type) && (
                  <p className="mt-1 text-sm text-navy-800">Layout: {SECTION_LAYOUT_LABELS[sectionLayout({ ...section, type: section.type })]}</p>
                )}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted">No sections. The home page will say that nothing is published yet.</p>}
      </Panel>

      <Panel title={`Campaigns (${settings.campaigns.length})`}>
        {settings.campaigns.length ? (
          <ul className="space-y-3">
            {settings.campaigns.map((campaign) => (
              <li key={campaign.id} className="rounded-md border border-divider p-[16px]">
                <p className="mb-3 font-semibold text-navy-900 [overflow-wrap:anywhere]">{campaign.title || "Untitled campaign"}</p>
                <Facts rows={[
                  ["Layout", LAYOUTS[campaign.layout]],
                  ["Body", campaign.body],
                  ["Conditions", campaign.conditions],
                  ["Button", `${campaign.cta.label} → ${destination(campaign)}`],
                  ["Desktop image", mediaName(campaign.desktopMediaId, media)],
                  ["Mobile image", mediaName(campaign.mobileMediaId, media)],
                  ["Desktop focal point", `${campaign.desktopFocal.x}% across, ${campaign.desktopFocal.y}% down`],
                  ["Mobile focal point", `${campaign.mobileFocal.x}% across, ${campaign.mobileFocal.y}% down`],
                ]} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No campaigns yet.</p>}
      </Panel>
    </div>
  );
}
