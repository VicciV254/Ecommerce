import { useState } from "react";
import { catalogAdminAPI, type CatalogCategory, type CatalogDesigner, type CategoryInput, type DesignerInput } from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { useAdminCatalog } from "./AdminCatalogContext";
import { Feedback, Field, categoryOptions, descendantIds, inputClass, isAcceptedImageUrl } from "./shared";

const MAX_CATEGORY_ORDER = 10_000;
const DESIGNER_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

/** Create or edit one category. The slug is never rewritten just because the name changes. */
export function CategoryForm({
  category, defaultParentId, onClose, onSaved,
}: {
  category: CatalogCategory | null;
  defaultParentId: string | null;
  onClose: () => void;
  onSaved: (saved: CatalogCategory) => void;
}) {
  const { categories } = useAdminCatalog();
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category ? category.parentId ?? "" : defaultParentId ?? "");
  const [order, setOrder] = useState(String(category?.order ?? 0));
  const [image, setImage] = useState(category?.image ?? "");
  const [keys, setKeys] = useState((category?.attributeKeys ?? []).join(", "));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const excluded = category ? new Set([category.id, ...descendantIds(categories, category.id)]) : new Set<string>();
  const parents = categoryOptions(categories).filter((option) => !excluded.has(option.id));
  const orderValue = Number(order);
  const imageValid = !image.trim() || isAcceptedImageUrl(image.trim());
  const valid = name.trim().length >= 2 && Number.isInteger(orderValue) && orderValue >= 0 && orderValue <= MAX_CATEGORY_ORDER && imageValid;

  const save = async () => {
    setSaving(true);
    setError("");
    const input: CategoryInput = {
      name: name.trim(),
      parentId: parentId || null,
      order: orderValue,
      headerImage: image.trim() || null,
      attributeKeys: splitList(keys),
      isActive,
    };
    try {
      const { data } = category
        ? await catalogAdminAPI.updateCategory(category.id, input)
        : await catalogAdminAPI.createCategory(input);
      onSaved(data);
    } catch (reason) {
      setError(describeApiError(reason, "The category could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open
      title={category ? "Edit Category" : "Create New Category"}
      confirmLabel={saving ? "Saving…" : category ? "Save Category" : "Create Category"}
      confirmDisabled={!valid || saving}
      size="lg"
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className="mt-4 space-y-3">
        <Field label="Category Name">
          {(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Smartphones" className={inputClass} />}
        </Field>
        <Field label="Parent" hint="Leave empty to make a top-level department. Hiding a parent hides everything below it.">
          {(id) => (
            <select id={id} value={parentId} onChange={(event) => setParentId(event.target.value)} className={inputClass}>
              <option value="">None (department)</option>
              {parents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display order">
            {(id) => <input id={id} type="number" min={0} max={MAX_CATEGORY_ORDER} value={order} onChange={(event) => setOrder(event.target.value)} className={inputClass} />}
          </Field>
          <label className="mt-6 flex items-center gap-2 text-xs font-semibold text-brand-primary">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-brand-secondary" />
            Visible to shoppers
          </label>
        </div>
        <Field label="Header image URL" hint={imageValid ? "HTTPS address or a /images/ path." : "Use an HTTPS address or a /images/ path."}>
          {(id) => <input id={id} value={image} onChange={(event) => setImage(event.target.value)} placeholder="https://…" className={inputClass} aria-invalid={!imageValid} />}
        </Field>
        <Field label="Specification keys (comma separated)" hint="Suggested fields when editing products in this category.">
          {(id) => <input id={id} value={keys} onChange={(event) => setKeys(event.target.value)} placeholder="Brand, Screen size, Storage" className={inputClass} />}
        </Field>
        {category && <p className="text-[11px] text-gray-600">Slug: <code>{category.slug}</code> (kept when the name changes)</p>}
        <Feedback message={error} tone="error" />
      </div>
    </ConfirmModal>
  );
}

/** Create or edit one designer profile. */
export function DesignerForm({
  designer, onClose, onSaved,
}: {
  designer: CatalogDesigner | null;
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
      title={designer ? "Edit Designer" : "Create New Designer"}
      confirmLabel={saving ? "Saving…" : designer ? "Save Designer" : "Create Designer"}
      confirmDisabled={!valid || saving}
      size="lg"
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <div className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full Name">
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
