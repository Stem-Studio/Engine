/**
 * Open-source/playground local-user identity.
 *
 * In the open-source app there is no real authentication: AuthorizationContext
 * stamps a synthetic dbUser, and the network adapters synthesize asset/scene
 * records on read with a hard-coded owner id. Both sides must use the SAME
 * id, otherwise downstream UI gates that compare `item.userId === dbUser.id`
 * (CardMenu "Edit"/"Publish"/"Delete", `getItemStatus` author detection,
 * `isSceneOwner` checks, etc.) silently fail in playground mode and strip
 * Stem-edit affordances even though the user is the only person around.
 *
 * Treat this constant as the single source of truth — do NOT introduce new
 * literal `"local"` or alternative ids for the playground user.
 */
export const OSS_LOCAL_USER_ID = "stemstudio-local-user";
