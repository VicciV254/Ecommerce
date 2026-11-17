import { useEffect, useState } from "react";
import { adminAPI, type AdminUser } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { TableRegion } from "./shared";

/** The same inline padding on every cell, so neighbouring headings and values never run together. */
const headCell = "px-3 py-2";
const bodyCell = "px-3 py-3";
/** Row actions keep their short visible text inside 44px targets; their names add the customer ("Verify Ana Mwangi"). */
const rowAction = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm px-[8px] font-bold hover:underline";
const accountName = (user: AdminUser) => `${user.firstName} ${user.lastName}`.trim() || user.email;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Shopper accounts. Roles that cannot write see the list, search and filters, with no selection or account actions. */
export function CustomersManager({ canWrite, showToast }: { canWrite: boolean; showToast: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]); const [selected, setSelected] = useState<string[]>([]); const [q, setQ] = useState(""); const [verified, setVerified] = useState(""); const [disabled, setDisabled] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  // A reload keeps only the selected accounts it still shows, so a bulk action never reaches a row no longer listed.
  const loadUsers = async () => { setLoading(true); setError(""); try { const { data } = await adminAPI.users.getAll({ q: q || undefined, verified: verified || undefined, disabled: disabled || undefined }); setUsers(data.users); setSelected((current) => current.filter((id) => data.users.some((user) => user.id === id))); } catch (err) { const message = describeApiError(err, "Could not load users."); setError(message); showToast(message); } finally { setLoading(false); } };
  useEffect(() => { loadUsers(); }, [verified, disabled]);
  const toggleSelected = (id: string) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const shownSelected = selected.filter((id) => users.some((user) => user.id === id));
  const sendBulk = async () => { try { const { data } = await adminAPI.users.sendVerificationBulk(shownSelected); const sent = data.results.filter((result) => result.sent).length; showToast(`Verification sent to ${plural(sent, "account", "accounts")}`); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not send verification links.")); } };
  const sendOne = async (id: string) => { try { const { data } = await adminAPI.users.sendVerification(id); showToast(data.sent ? "Verification link sent" : "Verification email could not be sent"); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not send verification link.")); } };
  const setAccountDisabled = async (id: string, value: boolean) => { try { await adminAPI.users.setDisabled(id, value); showToast(value ? "Account disabled" : "Account enabled"); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not update account.")); } };
  const handleDeleteClick = (id: string) => { setDeleteUserId(id); setDeleteConfirmOpen(true); };
  const handleDeleteConfirm = async () => { if (!deleteUserId) return; try { await adminAPI.users.delete(deleteUserId); showToast("User deleted"); await loadUsers(); setDeleteConfirmOpen(false); setDeleteUserId(null); } catch (error) { showToast(describeApiError(error, "Could not delete user.")); } };
  return (
    <>
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Users</h3>
            <p className="mt-1 text-xs text-gray-500">
              {canWrite
                ? "View accounts, send verification links, disable accounts, or delete accounts without orders."
                : "View only: your role can see customer accounts but cannot change them."}
            </p>
            {canWrite ? (
              <p className="mt-1 text-xs text-navy-900">
                <span className="font-semibold">{shownSelected.length} of {plural(users.length, "account", "accounts")} shown selected.</span>{" "}
                Bulk actions apply only to the selected accounts.
              </p>
            ) : (
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand-accent">Showing {plural(users.length, "user", "users")}</p>
            )}
          </div>
          {canWrite && (
            <button type="button" onClick={sendBulk} disabled={!shownSelected.length}
              className="min-h-[44px] rounded-sm bg-brand-primary px-[14px] py-2 text-[11px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-50">
              Send verification to {shownSelected.length} selected
            </button>
          )}
        </div>
        {/* Sized to their text, so the row wraps at larger text sizes instead of widening the page. */}
        <div className="mt-4 flex flex-wrap gap-3">
          <input aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="min-w-0 flex-[1_1_16rem] rounded-sm border border-light-gray px-3 py-2 text-xs" />
          <select aria-label="Filter by verification" value={verified} onChange={(e) => setVerified(e.target.value)} className="min-w-0 flex-[1_1_10rem] rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All verification</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
          <select aria-label="Filter by account status" value={disabled} onChange={(e) => setDisabled(e.target.value)} className="min-w-0 flex-[1_1_10rem] rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All accounts</option>
            <option value="false">Active</option>
            <option value="true">Disabled</option>
          </select>
          <button onClick={loadUsers} className="flex-none rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Search</button>
        </div>
        <TableRegion label="Customer accounts table" className="mt-[14px]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                {canWrite && <th className={headCell}>Select</th>}
                <th className={headCell}>User</th>
                <th className={headCell}>Status</th>
                <th className={headCell}>Orders</th>
                <th className={headCell}>Joined</th>
                {canWrite && <th className={headCell}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={canWrite ? 6 : 4} className={`${bodyCell} text-center font-semibold text-error`}>{error}</td></tr>}
              {loading && <tr><td colSpan={canWrite ? 6 : 4} className={`${bodyCell} text-center text-muted`}>Loading users...</td></tr>}
              {!loading && users.map((user) => (
                <tr key={user.id} className="border-b border-light-gray/70">
                  {canWrite && (
                    <td className={bodyCell}>
                      {/* The whole 44px square selects; the visible box stays small. */}
                      <label className="inline-flex size-[44px] cursor-pointer items-center justify-center rounded-sm hover:bg-surface-soft">
                        <input type="checkbox" aria-label={`Select ${accountName(user)}`} checked={selected.includes(user.id)} onChange={() => toggleSelected(user.id)} />
                      </label>
                    </td>
                  )}
                  <td className={bodyCell}>
                    <p className="font-semibold text-brand-primary">{user.firstName} {user.lastName}</p>
                    <p className="text-gray-500">{user.email}</p>
                  </td>
                  <td className={bodyCell}><span className={user.isDisabled ? "text-error" : user.emailVerified ? "text-success" : "text-warning"}>{user.isDisabled ? "Disabled" : user.emailVerified ? "Verified" : "Unverified"}</span></td>
                  <td className={bodyCell}>{user._count?.orders ?? 0}</td>
                  <td className={bodyCell}>{new Date(user.createdAt).toLocaleDateString("en-KE")}</td>
                  {canWrite && (
                    <td className={`${bodyCell} space-x-2 whitespace-nowrap`}>
                      <button type="button" onClick={() => sendOne(user.id)} className={`${rowAction} text-ocean-blue`}>Verify<span className="sr-only"> {accountName(user)}</span></button>
                      <button type="button" onClick={() => setAccountDisabled(user.id, !user.isDisabled)} className={`${rowAction} text-warning`}>
                        {user.isDisabled ? "Enable" : "Disable"}<span className="sr-only"> {accountName(user)}</span>
                      </button>
                      <button type="button" onClick={() => handleDeleteClick(user.id)} className={`${rowAction} text-error`}>Delete<span className="sr-only"> {accountName(user)}</span></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </div>
      <ConfirmModal
        open={deleteConfirmOpen}
        title="Delete user?"
        message="This action cannot be undone. The user account will be permanently deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleteConfirmOpen(false); setDeleteUserId(null); }}
      />
    </>
  );
}
