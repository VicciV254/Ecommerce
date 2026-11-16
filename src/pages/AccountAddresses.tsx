import { useId, useLayoutEffect, useRef, useState } from 'react';
import { describeApiError } from '../api/errors';
import { AddressForm } from '../components/AddressForm';
import { ConfirmModal } from '../components/Modal';
import { useAuth, type Address } from '../contexts/AuthContext';
import { useEntryFocus } from '../router';
import { EMPTY_ADDRESS, type AddressDraft } from '../store/addressModel';

type Message = { tone: 'success' | 'error'; text: string };
/** Which form is open: a new address, or the saved address being edited. */
type Editing = { kind: 'new' } | { kind: 'edit'; address: Address };

const outlineClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft';
const textButtonClass = 'inline-flex min-h-[44px] items-center px-1 font-semibold underline underline-offset-4';

const draftOf = (address: Address): AddressDraft => ({
  street: address.street, city: address.city, county: address.county, postalCode: address.postalCode ?? '',
});

/** Saved delivery addresses: add, edit, choose the default and delete, with each outcome stated on the page. */
export default function AccountAddresses() {
  const { user, addAddress, updateAddress, deleteAddress } = useAuth();
  const addresses: Address[] = user?.addresses ?? [];
  const [editing, setEditing] = useState<Editing | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  /** Where focus goes once the form or dialog that held it has gone. */
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const defaultId = useId();
  useEntryFocus(heading);

  useLayoutEffect(() => {
    if (focusTarget === null) return;
    const target = focusTarget === 'add' ? addButton.current : document.getElementById(focusTarget);
    setFocusTarget(null);
    (target ?? heading.current)?.focus();
  }, [focusTarget]);

  const open = (next: Editing) => {
    setMessage(null);
    setMakeDefault(next.kind === 'edit' ? next.address.isDefault : addresses.length === 0);
    setEditing(next);
  };
  const close = (focus: string) => {
    setEditing(null);
    setFocusTarget(focus);
  };

  const save = async (input: Omit<Address, 'id'>): Promise<Address> => {
    if (editing?.kind === 'edit') {
      // An update changes only the fields it names: an emptied postal code is sent empty so it is cleared.
      const changes = { ...input, postalCode: input.postalCode ?? '' };
      await updateAddress(editing.address.id, changes);
      return { ...changes, id: editing.address.id };
    }
    return addAddress(input);
  };

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteAddress(deleting.id);
      setMessage({ tone: 'success', text: `Address deleted: ${deleting.street}.` });
    } catch (error) {
      setMessage({ tone: 'error', text: describeApiError(error, 'The address could not be deleted. Try again.') });
    } finally {
      setBusy(false);
      setDeleting(null);
      setFocusTarget('add');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900">Addresses</h1>
        <p className="mt-1 text-navy-800">Delivery addresses saved to your account. Checkout uses your default address first.</p>
      </div>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-md p-3 text-sm font-semibold ${message.tone === 'error' ? 'bg-error-tint text-error' : 'bg-success-tint text-success'}`}>
          {message.text}
        </p>
      )}

      {editing ? (
        <div className="rounded-lg bg-surface p-4 shadow-card sm:p-6">
          <AddressForm
            key={editing.kind === 'edit' ? editing.address.id : 'new'}
            title={editing.kind === 'edit' ? 'Edit address' : 'Add a new address'}
            initial={editing.kind === 'edit' ? draftOf(editing.address) : EMPTY_ADDRESS}
            isDefault={makeDefault}
            submitLabel={editing.kind === 'edit' ? 'Save changes' : 'Save address'}
            extra={(
              <div className="flex min-h-[44px] items-center gap-3">
                <input
                  id={defaultId}
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                  className="size-5 shrink-0 accent-navy-900"
                />
                <label htmlFor={defaultId} className="text-navy-900">Use as my default delivery address</label>
              </div>
            )}
            onSave={save}
            onSaved={(address) => {
              setMessage({ tone: 'success', text: editing.kind === 'edit' ? 'Address updated.' : 'Address saved.' });
              close(`address-${address.id}`);
            }}
            onCancel={() => close(editing.kind === 'edit' ? `edit-${editing.address.id}` : 'add')}
          />
        </div>
      ) : (
        <button ref={addButton} type="button" onClick={() => open({ kind: 'new' })} className={outlineClass}>
          Add a new address
        </button>
      )}

      {addresses.length > 0 ? (
        <ul aria-label="Saved addresses" className="grid gap-4 md:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} id={`address-${address.id}`} tabIndex={-1} className="rounded-lg bg-surface p-4 shadow-card [overflow-wrap:anywhere]">
              <p className="font-semibold text-navy-900">{address.street}</p>
              <p className="text-navy-800">{address.city}, {address.county}</p>
              {address.postalCode && <p className="text-sm text-muted">Postal code {address.postalCode}</p>}
              {address.isDefault && (
                <p className="mt-2 inline-block rounded-sm bg-success-tint px-2 py-0.5 text-sm font-semibold text-success">Default</p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4">
                <button id={`edit-${address.id}`} type="button" onClick={() => open({ kind: 'edit', address })} className={`${textButtonClass} text-link hover:text-link-hover`}>
                  Edit<span className="sr-only"> {address.street}</span>
                </button>
                <button type="button" onClick={() => setDeleting(address)} className={`${textButtonClass} text-error`}>
                  Delete<span className="sr-only"> {address.street}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-surface p-6 text-center text-navy-800 shadow-card">No addresses saved yet. Add one here or at checkout.</p>
      )}

      <ConfirmModal
        open={deleting !== null}
        title="Delete address"
        message={deleting ? `Delete ${deleting.street}, ${deleting.city} from your saved addresses?` : undefined}
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        cancelLabel="Keep address"
        tone="danger"
        confirmDisabled={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!busy) { setDeleting(null); setFocusTarget('add'); } }}
      />
    </div>
  );
}
