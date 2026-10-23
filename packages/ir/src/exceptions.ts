/**
 * Error-handling vocabulary shared by the validator, the engine and the editor.
 *
 * A `try` block owns two stacks: the body it guards and one or more catch
 * branches. Catch branches are ordinary statement blocks, distinguished by
 * their type prefix so validation and drag-and-drop can recognise them.
 */

/** Statement block that guards its body. */
export const TRY_TYPE = "control.try";

/** Statement block that raises a value as an exception. */
export const THROW_TYPE = "control.throw";

/** Prefix shared by every catch branch block. */
export const CATCH_PREFIX = "control.catch";

/** Port on a `try` block that holds its catch branches. */
export const CATCH_PORT = "catches";

export function isCatchType(type: string): boolean {
  return type.startsWith(CATCH_PREFIX);
}
