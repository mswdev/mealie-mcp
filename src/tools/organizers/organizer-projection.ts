/** The three parallel organizer resources behind one tool family. */
export const ORGANIZER_TYPES = ["category", "tag", "tool"] as const;

/** A single organizer resource type. */
export type OrganizerType = (typeof ORGANIZER_TYPES)[number];

/** Irregular plurals — never `type + "s"` (that would yield "categorys"). */
const PLURALS: Record<OrganizerType, string> = {
  category: "categories",
  tag: "tags",
  tool: "tools",
};

/** Concise fields shared by every category/tag/tool response shape. */
const CONCISE_FIELDS = ["id", "slug", "name"] as const;

/**
 * Builds the collection base path for an organizer type.
 *
 * @param type - The organizer resource type
 * @returns The `/api/organizers/{plural}` base path
 */
export function organizerBasePath(type: OrganizerType): string {
  return `/api/organizers/${PLURALS[type]}`;
}

/**
 * Projects an organizer to a concise view (id/slug/name) or returns it whole.
 * The concise shape is uniform across category/tag/tool even though their full
 * responses differ; detailed passes through whatever Mealie returned.
 *
 * @param organizer - The organizer object (shape varies by type; may be untyped)
 * @param format - "concise" trims to id/slug/name; "detailed" returns everything
 * @returns The projected organizer as a plain record
 */
export function projectOrganizer(
  organizer: unknown,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return organizer as Record<string, unknown>;
  const source = organizer as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}
