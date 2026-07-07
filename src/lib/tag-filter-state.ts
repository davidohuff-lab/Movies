export type TagFilterMode = "include" | "exclude";

export type TagFilterStateMap = Record<string, TagFilterMode>;

export function parseStoredTagFilterStates(value: string | null, validTags: readonly string[]): TagFilterStateMap {
  if (!value) {
    return {};
  }

  const validTagSet = new Set(validTags);

  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.reduce<TagFilterStateMap>((accumulator, tag) => {
        if (typeof tag === "string" && validTagSet.has(tag)) {
          accumulator[tag] = "include";
        }
        return accumulator;
      }, {});
    }

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed).reduce<TagFilterStateMap>((accumulator, [tag, mode]) => {
      if (validTagSet.has(tag) && (mode === "include" || mode === "exclude")) {
        accumulator[tag] = mode;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

export function cycleTagFilterMode(current?: TagFilterMode): TagFilterMode | undefined {
  if (current === "include") {
    return "exclude";
  }
  if (current === "exclude") {
    return undefined;
  }
  return "include";
}

export function setTagFilterMode(states: TagFilterStateMap, tag: string, mode?: TagFilterMode): TagFilterStateMap {
  if (!mode) {
    const { [tag]: _, ...rest } = states;
    return rest;
  }

  return {
    ...states,
    [tag]: mode
  };
}

export function getIncludedTagFilters(states: TagFilterStateMap): string[] {
  return Object.entries(states)
    .filter(([, mode]) => mode === "include")
    .map(([tag]) => tag);
}

export function getExcludedTagFilters(states: TagFilterStateMap): string[] {
  return Object.entries(states)
    .filter(([, mode]) => mode === "exclude")
    .map(([tag]) => tag);
}

export function matchesTagFilterStates(itemTags: string[], states: TagFilterStateMap): boolean {
  const included = getIncludedTagFilters(states);
  const excluded = getExcludedTagFilters(states);

  if (excluded.some((tag) => itemTags.includes(tag))) {
    return false;
  }

  if (included.length === 0) {
    return true;
  }

  return included.some((tag) => itemTags.includes(tag));
}
