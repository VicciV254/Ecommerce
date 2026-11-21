import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel } from "../components/ui";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { listingRoute } from "../store/listingQuery";
import { usePageReady } from "../components/pageReady";
import { useReveal } from "../components/reveal";

const groupLink =
  "flex min-h-[44px] items-center justify-between gap-3 rounded-sm px-2 text-navy-800 transition-colors duration-(--motion-feedback) hover:bg-surface-soft hover:text-navy-900";

/** Department cards a loading page shows: two rows at three columns. */
const SKELETON_TILES = 6;
/** Groups each loading card shows under its heading. */
const SKELETON_GROUPS = 4;

/** The department tiles' shape while the catalog loads. */
function DepartmentsSkeleton() {
  const bar = "skeleton rounded-sm";
  return (
    <>
      <p role="status" className="sr-only">Loading departments…</p>
      <div aria-hidden="true" className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <div key={index} className="rounded-lg border border-divider bg-surface p-5 shadow-card">
            <div className={`h-6 w-1/2 ${bar}`} />
            <div className={`mt-4 h-4 w-1/3 ${bar}`} />
            <div className="mt-4 space-y-4 border-t border-divider pt-4">
              {Array.from({ length: SKELETON_GROUPS }, (_, group) => <div key={group} className={`h-4 w-2/3 ${bar}`} />)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Every department with its groups; each listing then offers its narrower categories. */
export default function Departments() {
  const { status, error, categories, reload } = useCatalog();
  const reveal = useReveal<HTMLLIElement>({ stagger: true });
  usePageReady(status === "ready");

  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={[{ label: "Departments" }]} />
      <div className="mt-4"><DemoCatalogNotice /></div>
      <h1 className="mt-5 type-h1 text-navy-900">All departments</h1>
      <p className="mt-2 max-w-2xl text-muted">Choose a department or one of its groups. Each listing then offers its narrower categories.</p>

      {status === "loading" && <DepartmentsSkeleton />}
      {status === "error" && (
        <div className="mt-8">
          <ErrorPanel title="Departments are unavailable" message={error ?? "The catalog could not be loaded."} onRetry={reload} />
        </div>
      )}
      {status === "ready" && (
        <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.roots.map((department) => (
            <li key={department.id} ref={reveal} className="min-w-0">
              <section aria-labelledby={`department-${department.id}`} className="h-full rounded-lg border border-divider bg-surface p-5 shadow-card">
                <h2 id={`department-${department.id}`} className="type-h3 break-words text-navy-900">{department.name}</h2>
                <Link
                  to={listingRoute({ cat: department.slug })}
                  className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover"
                >
                  Shop all {department.name}
                </Link>
                <ul className="mt-2 border-t border-divider pt-2">
                  {categories.children(department.id).map((group) => (
                    <li key={group.id}>
                      <Link to={listingRoute({ cat: group.slug })} className={groupLink}>
                        <span className="min-w-0 break-words">{group.name}</span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">{group.productCount}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
