/**
 * The one place the element-naming rule lives: a name is required, and it
 * is stored trimmed.
 *
 * Both the class hierarchy (`ModelElement`, and every element still built
 * from it) and the sealed records WS1 is converting to (`createObjectType`)
 * enforce it, so the message existed in three places by the time
 * `ObjectType` stopped extending the class. Sharing it is what keeps the
 * two halves of the metamodel refusing the same inputs while WS1 is
 * partway through: a change here reaches both, where a fourth copy would
 * let them drift apart silently.
 */
export function requireName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error("Model element name must be a non-empty string.");
  }
  return trimmed;
}
