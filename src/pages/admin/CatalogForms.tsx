import { useState } from "react";
import {
  catalogAdminAPI,
  type AdminCatalogCategory,
  type CatalogCategory,
  type CatalogDesigner,
  type CategoryInput,
  type DesignerInput,
} from "../../api/catalog";
import { apiErrorCode, describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { useAdminCatalog } from "./AdminCatalogContext";
import { Feedback, Field, WrappingSelect, categoryOptions, descendantIds, inputClass, isAcceptedImageUrl, smallButtonClass } from "./shared";
import { useUnsavedChanges } from "./unsavedChanges";

const DESIGNER_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Refusals that reloading the category answers: someone else saved it, or another save raced this one. */
const CATEGORY_RELOAD_CODES = new Set(["CATEGORY_CHANGED", "CATALOG_CHANGED"]);

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

/**
 * Create or edit one category. The slug is never rewritten just because the name changes. Order is set with the tree's
 * Up and Down buttons, and a new category goes after its last sibling. A save is made against the version the form
 * opened with; if someone else saved the category since, the server refuses it and the form offers a reload.
 */
export function CategoryForm({
  category, defaultParentId, keeps, onClose, onSaved, onReload,
}: {
  category: AdminCatalogCategory | null;
  defaultParentId: string | null;
  /** Routes that keep the form open, when it sits inside another editor (by default, the page it was opened on). */
  keeps?: (route: string) => boolean;
  onClose: () => void;
  onSaved: (saved: CatalogCategory) => void;
  /** Reopens the form from the catalog as it is now (after a conflict). */
  onReload?: () => void;
}) {
  const { categories } = useAdminCatalog();
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category ? category.parentId ?? "" : defaultParentId ?? "");
  const [image, setImage] = useState(category?.image ?? "");
  const [keys, setKeys] = useState((category?.attributeKeys ?? []).join(", "));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [reloading, setReloading] = useState(false);
  const formState = JSON.stringify([name, parentId, image, keys, isActive]);
  const [loadedState] = useState(formState);
  const { confirmLeave } = useUnsavedChanges(formState !== loadedState, "Category form", keeps);

  const excluded = category ? new Set([category.id, ...descendantIds(categories, category.id)]) : new Set<string>();
  const parents = categoryOptions(categories).filter((option) => !excluded.has(option.id));
  const imageValid = !image.trim() || isAcceptedImageUrl(image.trim());
  const valid = name.trim().length >= 2 && imageValid;

  const save = async () => {
    setSaving(true);
    setError("");
    setChangedElsewhere(false);
    const input: CategoryInput = {
      name: name.trim(),
      parentId: parentId || null,
      headerImage: image.trim() || null,
      attributeKeys: splitList(keys),
      isActive,
    };
    try {
      // `category` is the record as this form opened it (the parent reopens the form for a newer one).
      const { data } = category
        ? await catalogAdminAPI.updateCategory(category.id, { ...input, expectedUpdatedAt: category.updatedAt })
        : await catalogAdminAPI.createCategory(input);
      onSaved(data);
    } catch (reason) {
      setError(describeApiError(reason, "The category could not be saved."));
      setChangedElsewhere(CATEGORY_RELOAD_CODES.has(apiErrorCode(reason) ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open
      title={category ? "Edit category" : "Create new category"}
      confirmLabel={saving ? "Saving…" : category ? "Save category" : "Create category"}
      confirmDisabled={!valid || saving}
      size="lg"
      onConfirm={() => void save()}
      onCancel={() => confirmLeave(onClose)}
    >
      <div className="mt-4 space-y-3">
        <Field label="Category name">
          {(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Smartphones" className={inputClass} />}
        </Field>
        <Field label="Parent" hint="Leave empty to make a top-level department. Hiding a parent hides everything below it.">
          {(id) => (
            <WrappingSelect id={id} value={parentId} onChange={(event) => setParentId(event.target.value)} className={inputClass}>
              <option value="">None (department)</option>
              {parents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </WrappingSelect>
          )}
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-brand-primary">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-brand-secondary" />
          Visible to shoppers
        </label>
        <Field label="Header image URL" hint={imageValid ? "HTTPS address or a /images/ path." : "Use an HTTPS address or a /images/ path."}>
          {(id) => <input id={id} value={image} onChange={(event) => setImage(event.target.value)} placeholder="https://…" className={inputClass} aria-invalid={!imageValid} />}
        </Field>
        <Field label="Specification keys (comma separated)" hint="Suggested fields when editing products in this category.">
          {(id) => <input id={id} value={keys} onChange={(event) => setKeys(event.target.value)} placeholder="Brand, Screen size, Storage" className={inputClass} />}
        </Field>
        {category && <p className="text-[0.6875rem] text-gray-600">Slug: <code>{category.slug}</code> (kept when the name changes)</p>}
        <Feedback message={error} tone="error" />
        {changedElsewhere && onReload && (
          <button
            type="button"
            disabled={reloading}
            onClick={() => confirmLeave(() => {
              setReloading(true);
              onReload();
            })}
            className={`min-h-[44px] ${smallButtonClass}`}
          >
            {reloading ? "Reloading…" : "Reload category"}
          </button>
        )}
      </div>
    </ConfirmModal>
  );
}

/** Create or edit one designer profile. */
export function DesignerForm({
  designer, keeps, onClose, onSaved,
}: {
  designer: CatalogDesigner | null;
  /** Routes that keep the form open, when it sits inside another editor (by default, the page it was opened on). */
  keeps?: (route: string) => boolean;
  onClose: () => void;
  onSaved: (saved: CatalogDesigner) => void;
}) {
  const [handle, setHandle] = useState(designer?.slug ?? "");
  const [name, setName] = useState(designer?.name ?? "");
  const [specialty, setSpecialty] = useState(designer?.specialty ?? "");
  const [location, setLocation] = useState(designer?.location ?? "");
  const [image, setImage] = useState(designer?.image ?? "");
  const [heading, setHeading] = useState(designer?.spotlightTitle ?? "");
  const [text, setText] = useState(designer?.spotlightText ?? "");
  const [isActive, setIsActive] = useState(designer?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formState = JSON.stringify([handle, name, specialty, location, image, heading, text, isActive]);
  const [loadedState] = useState(formState);
  const { confirmLeave } = useUnsavedChanges(formState !== loadedState, "Designer form", keeps);

  const imageValid = !image.trim() || isAcceptedImageUrl(image.trim());
  const handleValid = DESIGNER_HANDLE.test(handle.trim());
  const valid = handleValid && name.trim().length >= 2 && specialty.trim().length >= 2 && imageValid;

  const save = async () => {
    setSaving(true);
    setError("");
    const input: DesignerInput = {
      designerId: handle.trim(),
      fullName: name.trim(),
      specialty: specialty.trim(),
      location: location.trim(),
      profileImage: image.trim() || null,
      spotlightHeading: heading.trim() || null,
      spotlightText: text.trim() || null,
      isActive,
    };
    try {
      const { data } = designer
        ? await catalogAdminAPI.updateDesigner(designer.id, input)
        : await catalogAdminAPI.createDesigner(input);
      onSaved(data);
    } catch (reason) {
      setError(describeApiError(reason, "The designer could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open
      title={designer ? "Edit designer" : "Create new designer"}
      confirmLabel={saving ? "Saving…" : designer ? "Save designer" : "Create designer"}
      confirmDisabled={!valid || saving}
      size="lg"
      onConfirm={() => void save()}
      onCancel={() => confirmLeave(onClose)}
    >
      <div className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            {(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />}
          </Field>
          <Field label="Handle" hint={handleValid || !handle ? "Lowercase letters, numbers and hyphens." : "Use lowercase letters, numbers and single hyphens."}>
            {(id) => <input id={id} value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="e.g. studio-name" className={inputClass} aria-invalid={Boolean(handle) && !handleValid} />}
          </Field>
          <Field label="Specialty">
            {(id) => <input id={id} value={specialty} onChange={(event) => setSpecialty(event.target.value)} className={inputClass} />}
          </Field>
          <Field label="Location (optional)">
            {(id) => <input id={id} value={location} onChange={(event) => setLocation(event.target.value)} className={inputClass} />}
          </Field>
        </div>
        <Field label="Profile image URL (optional)" hint={imageValid ? undefined : "Use an HTTPS address or a /images/ path."}>
          {(id) => <input id={id} value={image} onChange={(event) => setImage(event.target.value)} placeholder="https://…" className={inputClass} aria-invalid={!imageValid} />}
        </Field>
        <Field label="Spotlight heading (optional)">
          {(id) => <input id={id} value={heading} onChange={(event) => setHeading(event.target.value)} className={inputClass} />}
        </Field>
        <Field label="Spotlight text (optional)">
          {(id) => <textarea id={id} rows={3} value={text} onChange={(event) => setText(event.target.value)} className={inputClass} />}
        </Field>
        <label className="flex items-center gap-2 text-xs font-semibold text-brand-primary">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-brand-secondary" />
          Visible to shoppers
        </label>
        <Feedback message={error} tone="error" />
      </div>
    </ConfirmModal>
  );
}
