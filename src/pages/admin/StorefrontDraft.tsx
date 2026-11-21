import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { catalogAdminAPI, type MediaAsset, type StorefrontDraft, type StorefrontSettings } from "../../api/catalog";
import { apiErrorCode, apiStatus, describeApiError } from "../../api/errors";
import { sectionClaimProblem } from "../../store/storefrontClaims";
import { useStorefront } from "../../store/StorefrontContext";
import { BEST_SELLERS_TITLE, CAROUSEL_SLIDES, isMedia, isStorefrontSettings, takesLayout } from "../../store/storefrontModel";
import { withMediaDefaults } from "../../store/catalogModel";
import { isRecord } from "../../utils/storage";
import { useAdminCatalog } from "./AdminCatalogContext";
import { ADMIN_PREVIEW_ROUTE, adminModuleRoute, routePath } from "./adminRoutes";
import { SECTION_KIND_LABELS, SLUG } from "./StorefrontEditors";
import { useUnsavedChanges } from "./unsavedChanges";

type DraftLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; draft: StorefrontDraft };
type Notice = { text: string; tone: "error" | "success" };
type MediaReference = { id: string; label: string; repairable: boolean };
/** The write in progress; save, publish and restore never overlap. */
type DraftBusy = "" | "save" | "publish" | "restore";

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
/** Refusals after which the editor offers to reload: the draft changed, or a write raced this one. */
const STALE_CODES = ["STOREFRONT_CHANGED", "CATALOG_CHANGED"];

function parseDraft(data: unknown): StorefrontDraft | null {
  if (!isRecord(data) || typeof data.version !== "number" || typeof data.publishedVersion !== "number") return null;
  if (!isNullableString(data.publishedAt) || !isNullableString(data.publishedBy) || !isStorefrontSettings(data.settings)) return null;
  const { media, unavailableMediaIds } = data;
  if (!Array.isArray(media) || !media.every(isMedia)) return null;
  if (!Array.isArray(unavailableMediaIds) || !unavailableMediaIds.every((id) => typeof id === "string")) return null;
  return {
    version: data.version, publishedVersion: data.publishedVersion, publishedAt: data.publishedAt, publishedBy: data.publishedBy,
    settings: data.settings, media: media.map(withMediaDefaults), unavailableMediaIds,
  };
}

/** Every media reference in the settings, labelled by where it is used. */
function mediaReferences(settings: StorefrontSettings): MediaReference[] {
  const references: MediaReference[] = [];
  if (settings.brand.logoMediaId) references.push({ id: settings.brand.logoMediaId, label: "Brand logo", repairable: false });
  if (settings.brand.faviconMediaId) references.push({ id: settings.brand.faviconMediaId, label: "Browser icon", repairable: false });
  for (const campaign of settings.campaigns) {
    if (campaign.desktopMediaId) references.push({ id: campaign.desktopMediaId, label: `Campaign "${campaign.title}" desktop image`, repairable: true });
    if (campaign.mobileMediaId) references.push({ id: campaign.mobileMediaId, label: `Campaign "${campaign.title}" mobile image`, repairable: true });
  }
  return references;
}

/** Problems the API would reject, listed before a save is attempted. */
export function draftProblems(settings: StorefrontSettings): string[] {
  const problems: string[] = [];
  if (!settings.brand.name.trim()) problems.push("Enter a store name.");
  const campaignIds = new Set(settings.campaigns.map((campaign) => campaign.id));
  for (const section of settings.sections) {
    const name = section.title || SECTION_KIND_LABELS[section.type];
    if (!section.title.trim()) problems.push("Every section needs a heading.");
    const claim = sectionClaimProblem(section);
    if (claim) problems.push(claim);
    if (section.type === "products" && !section.productIds.length) problems.push(`"${section.title || "Selected products"}" needs at least one product.`);
    if (section.type === "campaign" && (!section.campaignId || !campaignIds.has(section.campaignId))) problems.push(`"${section.title || "Campaign"}" needs a campaign.`);
    if (section.layout !== undefined && !takesLayout(section.type)) problems.push(`"${name}" has no layout to choose.`);
    if (section.type === "category") {
      if (section.categoryIds.length !== 1) problems.push(`"${name}" needs exactly one department.`);
      if (section.productIds.length) problems.push(`"${name}" shows its department's products, not chosen ones.`);
    }
    if ((section.type === "promises" || section.type === "bestSellers") && (section.productIds.length || section.categoryIds.length)) {
      problems.push(`"${name}" takes no products or categories.`);
    }
    if (section.type === "bestSellers" && section.title.trim() !== BEST_SELLERS_TITLE) problems.push(`The best sellers heading is always "${BEST_SELLERS_TITLE}".`);
    if (section.type !== "campaign" && section.campaignId !== null) problems.push(`"${name}" can't use a single campaign; only a campaign section does.`);
    if (section.type !== "carousel" && section.campaignIds !== undefined) problems.push(`"${name}" can't list campaigns; only a hero carousel does.`);
    if (section.type === "carousel") {
      const listed = section.campaignIds ?? [];
      if (listed.length < CAROUSEL_SLIDES.min || listed.length > CAROUSEL_SLIDES.max) {
        problems.push(`"${name}" needs ${CAROUSEL_SLIDES.min} to ${CAROUSEL_SLIDES.max} campaigns.`);
      }
      if (new Set(listed).size !== listed.length) problems.push(`"${name}" lists a campaign more than once.`);
      for (const id of listed) if (!campaignIds.has(id)) problems.push(`"${name}" lists a campaign that doesn't exist: ${id}.`);
      if (section.productIds.length || section.categoryIds.length) problems.push(`"${name}" takes no products or categories.`);
    }
  }
  const count = (type: StorefrontSettings["sections"][number]["type"]) => settings.sections.filter((section) => section.type === type).length;
  if (count("promises") > 1) problems.push("Only one shopping facts section is allowed.");
  if (count("bestSellers") > 1) problems.push("Only one best sellers section is allowed.");
  if (count("carousel") > 1) problems.push("Only one hero carousel is allowed.");
  for (const campaign of settings.campaigns) {
    if (!SLUG.test(campaign.id)) problems.push(`Campaign ID "${campaign.id}" must use lowercase letters, numbers and hyphens.`);
    if (!campaign.title.trim()) problems.push("Every campaign needs a headline.");
    if (!campaign.cta.label.trim()) problems.push(`Campaign "${campaign.title}" needs a button label.`);
    if (campaign.cta.target !== "shop" && !campaign.cta.targetId) problems.push(`Campaign "${campaign.title}" needs a button destination.`);
  }
  return [...new Set(problems)];
}

/** The editor and its preview: moving between them keeps the draft open. */
const keepsStorefront = (route: string) => {
  const path = routePath(route);
  return path === adminModuleRoute("storefront") || path === ADMIN_PREVIEW_ROUTE;
};

type StorefrontDraftValue = {
  load: DraftLoad;
  settings: StorefrontSettings | null;
  dirty: boolean;
  busy: DraftBusy;
  notice: Notice;
  /** The last save, publish or restore was refused because someone else changed the draft. */
  stale: boolean;
  /**
   * Changes after each restore, which replaces the draft in place, so an open history refreshes. A publish reloads the
   * whole editor, history included.
   */
  historyToken: number;
  /** Saved references resolve through the draft's media, plus product images and images registered in this session. */
  media: MediaAsset[];
  mediaById: ReadonlyMap<string, MediaAsset>;
  /** References that resolve to nothing; they stay listed so they can be repaired. */
  unresolved: MediaReference[];
  update: (next: StorefrontSettings) => void;
  register: (asset: MediaAsset) => void;
  reloadDraft: () => void;
  save: () => Promise<void>;
  publish: () => Promise<void>;
  /** Copies published version `revision` into the draft; resolves true once the draft is that version. */
  restore: (revision: number) => Promise<boolean>;
};

const StorefrontDraftContext = createContext<StorefrontDraftValue | null>(null);

/**
 * The storefront draft for the Storefront group: loaded once, edited in the editor, shown in the preview. Nothing from
 * it reaches browser storage or the published storefront context; it is gone once the staff member leaves the group.
 */
export function StorefrontDraftProvider({ canWrite, showToast, children }: {
  canWrite: boolean;
  showToast: (message: string) => void;
  children: ReactNode;
}) {
  const published = useStorefront();
  const { data } = useAdminCatalog();
  const [load, setLoad] = useState<DraftLoad>({ status: "loading" });
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<DraftBusy>("");
  const [notice, setNotice] = useState<Notice>({ text: "", tone: "success" });
  const [stale, setStale] = useState(false);
  const [historyToken, setHistoryToken] = useState(0);
  const [registered, setRegistered] = useState<MediaAsset[]>([]);
  const [attempt, setAttempt] = useState(0);
  useUnsavedChanges(canWrite && dirty, "Storefront draft", keepsStorefront);

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
  const unresolved = useMemo(
    () => (settings ? mediaReferences(settings).filter((reference) => !mediaById.has(reference.id)) : []),
    [settings, mediaById],
  );

  const update = useCallback((next: StorefrontSettings) => {
    setSettings(next);
    setDirty(true);
    setNotice({ text: "", tone: "success" });
  }, []);
  const register = useCallback((asset: MediaAsset) => setRegistered((assets) => [...assets, asset]), []);

  const save = async () => {
    if (!loadedDraft || !settings) return;
    setBusy("save");
    setNotice({ text: "", tone: "success" });
    try {
      const { data: body } = await catalogAdminAPI.saveStorefrontDraft(loadedDraft.version, settings);
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
    if (!loadedDraft) return;
    setBusy("publish");
    setNotice({ text: "", tone: "success" });
    try {
      await catalogAdminAPI.publishStorefront(loadedDraft.version);
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

  const restore = async (revision: number) => {
    if (!loadedDraft || dirty || busy !== "") return false;
    setBusy("restore");
    setNotice({ text: "", tone: "success" });
    try {
      const { data: body } = await catalogAdminAPI.restoreStorefrontRevision(revision, loadedDraft.version);
      const restored = parseDraft(body);
      if (!restored) throw new Error("Unexpected draft response");
      setLoad({ status: "ready", draft: restored });
      setSettings(restored.settings);
      setDirty(false);
      setStale(false);
      setHistoryToken((value) => value + 1);
      setNotice({ text: `Version ${revision} is now the draft. Preview it, then publish to show it to shoppers.`, tone: "success" });
      return true;
    } catch (reason) {
      // A stale draft offers the reload; a version that can't be restored says why, in the server's words.
      setStale(STALE_CODES.includes(apiErrorCode(reason) ?? ""));
      setNotice({ text: describeApiError(reason, "The version could not be restored."), tone: "error" });
      return false;
    } finally {
      setBusy("");
    }
  };

  const value: StorefrontDraftValue = {
    load, settings, dirty, busy, notice, stale, historyToken, media, mediaById, unresolved, update, register, reloadDraft, save, publish, restore,
  };
  return <StorefrontDraftContext.Provider value={value}>{children}</StorefrontDraftContext.Provider>;
}

export function useStorefrontDraft() {
  const context = useContext(StorefrontDraftContext);
  if (!context) throw new Error("useStorefrontDraft must be used within StorefrontDraftProvider");
  return context;
}
