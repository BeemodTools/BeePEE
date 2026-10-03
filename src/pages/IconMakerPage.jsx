import { useEffect, useState } from "react"
import IconMaker from "../components/items/IconMaker"

/**
 * The icon maker's window (item editor > Info > Make Icon). The item comes
 * from the window's address; the icon goes to the item's editor, which
 * stages it like a picked icon file.
 */
export default function IconMakerPage() {
    const [item] = useState(() => {
        const params = new URLSearchParams(window.location.search)
        return { id: params.get("itemId"), name: params.get("itemName") ?? "" }
    })

    useEffect(() => {
        document.title = `Make Icon: ${item.name}`
    }, [item])

    const sendToEditor = async (filePath, fileName) => {
        const result = await window.package.sendMadeIconToEditor(
            item.id,
            filePath,
            fileName,
        )
        if (!result?.success) {
            throw new Error(
                result?.error ?? "The item's editor didn't get the icon",
            )
        }
    }

    return (
        <IconMaker
            item={item}
            onClose={() => window.close()}
            onIconMade={sendToEditor}
        />
    )
}
