import { useCallback, useEffect, useId, useMemo } from "react";
import { adminAPI, type ActivityPage } from "../../api/admin";
import type { Pagination } from "../../api/orders";
import { Link, navigate, useRoute } from "../../router";
import { formatNairobiDateTime } from "../../utils/nairobiDate";
import { activityLink, activitySentence, parseActivityPage } from "./activityModel";
import { ACTIVITY_TYPES, activityRoute, isActivityType, parseActivityParams } from "./adminRoutes";
import { roleLabel } from "./permissions";
import { usePage } from "./usePage";
import { WrappingSelect } from "./shared";

const controlClass =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-light-gray px-3 py-2 text-sm font-semibold text-navy-900 hover:border-brand-primary hover:text-brand-primary";

function Pager({ pagination, onPage }: { pagination: Pagination; onPage: (page: number) => void }) {
  if (pagination.pages <= 1) return null;
  const { page, pages } = pagination;
  return (
    <nav aria-label="Staff activity pages" className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-disabled={page <= 1 || undefined} onClick={() => { if (page > 1) onPage(page - 1); }} className={`${controlClass} aria-disabled:opacity-50`}>
        Previous
      </button>
      <p className="text-sm text-gray-600">Page {page} of {pages}</p>
      <button type="button" aria-disabled={page >= pages || undefined} onClick={() => { if (page < pages) onPage(page + 1); }} className={`${controlClass} aria-disabled:opacity-50`}>
        Next
      </button>
    </nav>
  );
}

/**
 * Staff activity for SUPER_ADMIN and ADMIN: sign-ins and changes, newest first, 25 a page, in Nairobi time. The "Show"
 * filter and the page live in the address (`?type=catalog&page=2`) and change with a replace; an unknown value is
 * corrected in place.
 */
export function StaffActivity() {
  const route = useRoute();
  const selectId = useId();
  const { filters, invalid } = useMemo(() => parseActivityParams(route), [route]);
  const { type, page } = filters;
  const correction = invalid ? activityRoute(filters) : null;
  useEffect(() => {
    if (correction !== null) navigate(correction, { replace: true });
  }, [correction]);

  const load = useCallback(async (current: number) => {
    const parsed = parseActivityPage((await adminAPI.activity.getAll({ type, page: current })).data);
    if (!parsed) throw new Error("Unexpected staff activity response");
    return parsed;
  }, [type]);
  const { state, setPage, retry } = usePage<ActivityPage>(load, 0, "Couldn't load staff activity.", {
    page, onPage: (next) => navigate(activityRoute({ type, page: next }), { replace: true }),
  });
  const data = state.status === "ready" ? state.data : null;

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="w-full md:w-72">
          <label htmlFor={selectId} className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-600">Show</label>
          <WrappingSelect
            id={selectId}
            value={type}
            onChange={(event) => { if (isActivityType(event.target.value)) navigate(activityRoute({ type: event.target.value }), { replace: true }); }}
            className="min-h-11 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm"
          >
            {ACTIVITY_TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </WrappingSelect>
        </div>
        {data && <p className="text-sm font-semibold text-gray-600">{data.pagination.total} {data.pagination.total === 1 ? "entry" : "entries"}</p>}
      </div>

      {state.status === "loading" && <p role="status" className="mt-4 text-sm text-gray-600">Loading staff activity…</p>}
      {state.status === "error" && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          <span>{state.message}</span>
          <button type="button" onClick={retry} className="min-h-11 font-bold underline">Try again</button>
        </div>
      )}
      {data && !data.entries.length && (
        <p className="mt-4 text-sm text-gray-600">{type === "all" ? "No staff activity yet." : "No activity of this type."}</p>
      )}
      {data && data.entries.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-light-gray">
            {data.entries.map((entry) => {
              const link = activityLink(entry);
              return (
                <li key={entry.id} className="grid grid-cols-1 gap-y-1 py-3 first:pt-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,3fr)] xl:gap-x-6">
                  <p className="min-w-0 text-sm font-semibold text-navy-900 [overflow-wrap:break-word] xl:col-start-3 xl:row-start-1">{activitySentence(entry)}</p>
                  <p className="min-w-0 text-sm text-gray-600 [overflow-wrap:break-word] xl:col-span-2 xl:col-start-1 xl:row-start-1 xl:grid xl:grid-cols-subgrid">
                    <span className="min-w-0 xl:col-start-2 xl:row-start-1">{entry.staff.username} · {roleLabel(entry.staff.role)}</span>
                    <span className="xl:hidden"> · </span>
                    <time dateTime={entry.at} className="min-w-0 xl:col-start-1 xl:row-start-1">{formatNairobiDateTime(entry.at)}</time>
                  </p>
                  {link && (
                    <div className="xl:col-start-3">
                      <Link to={link.to} aria-label={link.name} className={controlClass}>{link.text}</Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}
