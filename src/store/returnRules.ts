import type { CatalogCategory } from "../api/catalog";
import type { ReturnRule } from "../api/orders";
import { buildCategoryTree } from "./catalogModel";

/** The rules that restrict returns; everything else can be returned for any reason. */
export type RestrictedReturnRule = Exclude<ReturnRule, "STANDARD">;

/** Where one restricted rule applies: a category and its descendants, except those named (which have another rule). */
export type ReturnRuleGroup = { name: string; exceptions: string[] };

type Group = { category: CatalogCategory; exceptions: CatalogCategory[] };

/**
 * The categories each restricted return rule covers, in category order. A category's effective rule is its own, else
 * its nearest ancestor's, else STANDARD (as the server's `effectiveReturnRule`); inactive categories and everything
 * under them are left out. A group starts at each category whose effective rule differs from its parent's, and names as
 * exceptions the highest categories below it whose rule differs again. Groups (or one group's exceptions) that share a
 * name are told apart by their parent ("Women › Underwear").
 */
export function returnRuleGroups(categories: readonly CatalogCategory[]): Record<RestrictedReturnRule, ReturnRuleGroup[]> {
  const tree = buildCategoryTree(categories);
  const found: Record<RestrictedReturnRule, Group[]> = { UNOPENED_OR_FAULT: [], FAULT_ONLY: [] };

  const visit = (category: CatalogCategory, parentRule: ReturnRule, enclosing: Group | null) => {
    if (!category.isActive) return;
    const rule = category.returnRule ?? parentRule;
    let group = enclosing;
    if (rule !== parentRule) {
      enclosing?.exceptions.push(category);
      group = null;
      if (rule !== "STANDARD") {
        group = { category, exceptions: [] };
        found[rule].push(group);
      }
    }
    for (const child of tree.children(category.id)) visit(child, rule, group);
  };
  for (const root of tree.roots) visit(root, "STANDARD", null);

  const labeller = (list: readonly CatalogCategory[]) => (category: CatalogCategory) => {
    const parent = category.parentId === null ? undefined : tree.byId.get(category.parentId);
    const shared = list.filter((other) => other.name === category.name).length > 1;
    return shared && parent ? `${parent.name} › ${category.name}` : category.name;
  };
  const groupName = labeller([...found.UNOPENED_OR_FAULT, ...found.FAULT_ONLY].map(({ category }) => category));
  const named = (groups: Group[]) => groups.map(({ category, exceptions }) => ({
    name: groupName(category),
    exceptions: exceptions.map(labeller(exceptions)),
  }));
  return { UNOPENED_OR_FAULT: named(found.UNOPENED_OR_FAULT), FAULT_ONLY: named(found.FAULT_ONLY) };
}
