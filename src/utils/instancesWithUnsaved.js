/**
 * The instances to show for an item the backend sent while the form has
 * instance changes that aren't saved: the item's instances (their real
 * indices and names), with the form's instances added since the last save
 * ("pending_..." keys) and its marks for removal
 */
export function instancesWithUnsaved(itemInstances = {}, formInstances = {}) {
    const instances = {}
    for (const [index, instance] of Object.entries(itemInstances)) {
        instances[index] = formInstances[index]?._toRemove
            ? { ...instance, _toRemove: true }
            : instance
    }
    for (const [index, instance] of Object.entries(formInstances)) {
        if (instance._pending) instances[index] = instance
    }
    return instances
}
