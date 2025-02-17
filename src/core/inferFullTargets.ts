import {
  Mark,
  Modifier,
  PartialListTargetDescriptor,
  PartialPrimitiveTargetDescriptor,
  PartialRangeTargetDescriptor,
  PartialTargetDescriptor,
  PositionModifier,
  PrimitiveTargetDescriptor,
  RangeTargetDescriptor,
  TargetDescriptor,
} from "../typings/targetDescriptor.types";

/**
 * Performs inference on the partial targets provided by the user, using
 * previous targets, global defaults, and action-specific defaults to fill out
 * any details that may have been omitted in the spoken form.
 * For example, we would automatically infer that `"take funk air and bat"` is
 * equivalent to `"take funk air and funk bat"`.
 * @param targets The partial targets which need to be completed by inference.
 * @returns Target objects fully filled out and ready to be processed by {@link processTargets}.
 */
export default function inferFullTargets(
  targets: PartialTargetDescriptor[]
): TargetDescriptor[] {
  return targets.map((target, index) =>
    inferTarget(target, targets.slice(0, index))
  );
}

function inferTarget(
  target: PartialTargetDescriptor,
  previousTargets: PartialTargetDescriptor[]
): TargetDescriptor {
  switch (target.type) {
    case "list":
      return inferListTarget(target, previousTargets);
    case "range":
    case "primitive":
      return inferNonListTarget(target, previousTargets);
  }
}

function inferListTarget(
  target: PartialListTargetDescriptor,
  previousTargets: PartialTargetDescriptor[]
): TargetDescriptor {
  return {
    ...target,
    elements: target.elements.map((element, index) =>
      inferNonListTarget(
        element,
        previousTargets.concat(target.elements.slice(0, index))
      )
    ),
  };
}

function inferNonListTarget(
  target: PartialPrimitiveTargetDescriptor | PartialRangeTargetDescriptor,
  previousTargets: PartialTargetDescriptor[]
): PrimitiveTargetDescriptor | RangeTargetDescriptor {
  switch (target.type) {
    case "primitive":
      return inferPrimitiveTarget(target, previousTargets);
    case "range":
      return inferRangeTarget(target, previousTargets);
  }
}

function inferRangeTarget(
  target: PartialRangeTargetDescriptor,
  previousTargets: PartialTargetDescriptor[]
): RangeTargetDescriptor {
  return {
    type: "range",
    excludeAnchor: target.excludeAnchor ?? false,
    excludeActive: target.excludeActive ?? false,
    rangeType: target.rangeType ?? "continuous",
    anchor: inferPrimitiveTarget(target.anchor, previousTargets),
    active: inferPrimitiveTarget(
      target.active,
      previousTargets.concat(target.anchor)
    ),
  };
}

function inferPrimitiveTarget(
  target: PartialPrimitiveTargetDescriptor,
  previousTargets: PartialTargetDescriptor[]
): PrimitiveTargetDescriptor {
  if (target.isImplicit) {
    return {
      type: "primitive",
      mark: { type: "cursor" },
      modifiers: [{ type: "toRawSelection" }],
    };
  }

  const ownPositionModifier = getPositionModifier(target);
  const ownNonPositionModifiers = getNonPositionModifiers(target);

  // Position without a mark can be something like "take air past end of line"
  // We will remove this case when we implement #736
  const mark = target.mark ??
    (ownPositionModifier == null ? null : getPreviousMark(previousTargets)) ?? {
      type: "cursor",
    };

  const modifiers =
    ownNonPositionModifiers ??
    getPreviousNonPositionModifiers(previousTargets) ??
    [];

  const positionModifier =
    ownPositionModifier ?? getPreviousPositionModifier(previousTargets);

  return {
    type: target.type,
    mark,
    modifiers,
    positionModifier,
  };
}

function getPositionModifier(
  target: PartialPrimitiveTargetDescriptor
): PositionModifier | undefined {
  if (target.modifiers == null) {
    return undefined;
  }

  const positionModifierIndex = target.modifiers.findIndex(
    (modifier) => modifier.type === "position"
  );

  if (positionModifierIndex > 0) {
    throw Error("Position modifiers must be at the start of a modifier chain");
  }

  return positionModifierIndex === -1
    ? undefined
    : (target.modifiers[positionModifierIndex] as PositionModifier);
}

/**
 * Return a list of non-positional modifiers on the given target. We return
 * undefined if there are none. Note that we will never return an empty list; we
 * will always return `undefined` if there are no non-positional modifiers.
 * @param target The target from which to get the non-positional modifiers
 * @returns A list of non-positional modifiers or `undefined` if there are none
 */
function getNonPositionModifiers(
  target: PartialPrimitiveTargetDescriptor
): Modifier[] | undefined {
  const nonPositionModifiers = target.modifiers?.filter(
    (modifier) => modifier.type !== "position"
  );
  return nonPositionModifiers == null || nonPositionModifiers.length === 0
    ? undefined
    : nonPositionModifiers;
}

function getPreviousMark(
  previousTargets: PartialTargetDescriptor[]
): Mark | undefined {
  return getPreviousTargetAttribute(
    previousTargets,
    (target: PartialPrimitiveTargetDescriptor) => target.mark
  );
}

function getPreviousNonPositionModifiers(
  previousTargets: PartialTargetDescriptor[]
): Modifier[] | undefined {
  return getPreviousTargetAttribute(previousTargets, getNonPositionModifiers);
}

function getPreviousPositionModifier(
  previousTargets: PartialTargetDescriptor[]
): PositionModifier | undefined {
  return getPreviousTargetAttribute(previousTargets, getPositionModifier);
}

/**
 * Walks backward through the given targets and their descendants trying to find
 * the first target for which the given attribute extractor returns a
 * non-nullish value. Returns `undefined` if none could be found
 * @param previousTargets The targets that precede the target we are trying to
 * infer. We look in these targets and their descendants for the given attribute
 * @param getAttribute The function used to extract the attribute from a
 * primitive target
 * @returns The extracted attribute or undefined if one could not be found
 */
function getPreviousTargetAttribute<T>(
  previousTargets: PartialTargetDescriptor[],
  getAttribute: (target: PartialPrimitiveTargetDescriptor) => T | undefined
): T | undefined {
  // Search from back(last) to front(first)
  for (let i = previousTargets.length - 1; i > -1; --i) {
    const target = previousTargets[i];
    switch (target.type) {
      case "primitive": {
        const attributeValue = getAttribute(target);
        if (attributeValue != null) {
          return attributeValue;
        }
        break;
      }
      case "range": {
        const attributeValue = getAttribute(target.anchor);
        if (attributeValue != null) {
          return attributeValue;
        }
        break;
      }
      case "list":
        const attributeValue = getPreviousTargetAttribute(
          target.elements,
          getAttribute
        );
        if (attributeValue != null) {
          return attributeValue;
        }
        break;
    }
  }
  return undefined;
}
