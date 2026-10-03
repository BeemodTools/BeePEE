# BeePEE Project - Development Notes

## Project Overview

BeePEE is an Electron-based application for creating and editing Portal 2 Puzzle Editor items. It manages item packages, instances, conditions, and various item properties.

## BEEmod doccumentation for beemod itself and package things can be found in /docs_backup

---

## Editor Window UI Style Guide

All editor windows (ItemEditor, SettingsPage, SignageEditor, etc.) should follow these styling conventions for consistency.

### Window Structure

```jsx
<Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
    {/* Main Content Area with Vertical Sidebar */}
    <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Vertical Tab Sidebar */}
        <Tabs orientation="vertical" ... />

        {/* Content Area */}
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
            {/* Tab Content */}
        </Box>
    </Box>

    {/* Footer */}
    <Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
        {/* Save/Close buttons */}
    </Box>
</Box>
```

### Vertical Tab Sidebar

```jsx
<Tabs
    orientation="vertical"
    variant="scrollable"
    sx={{
        borderRight: 1,
        borderColor: "divider",
        minWidth: 56,
        maxWidth: 56,
        bgcolor: "background.paper",
        "& .MuiTabs-indicator": {
            left: 0,
            width: 3,
        },
        "& .MuiTab-root": {
            minWidth: 56,
            width: 56,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
        },
    }}>
    <Tooltip title="Tab Name" placement="right">
        <Tab icon={<IconName />} />
    </Tooltip>
</Tabs>
```

### Tab Content Layout

```jsx
<Box>
    {/* Header */}
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6">Tab Title</Typography>
    </Box>

    {/* Content */}
    <Stack spacing={2}>
        {/* Form fields, etc. */}
    </Stack>
</Box>
```

### Form Fields

- **TextFields**: Use `fullWidth`, `variant="outlined"`, `size="small"` for compact layouts
- **Stack spacing**: Use `spacing={2}` for form field groups
- **Section labels**: Use `variant="subtitle2"` with `fontWeight={600}`
- **Helper text**: Use `variant="caption"` with `color="text.secondary"`
- **Icons in labels**: `sx={{ fontSize: 18, color: "text.secondary" }}`

### Buttons

```jsx
{/* Primary action */}
<Button variant="contained" startIcon={<Save />} sx={{ flex: 1 }}>Save</Button>

{/* Secondary action */}
<Button variant="outlined" startIcon={<Close />} sx={{ flex: 1 }}>Close</Button>

{/* Destructive action */}
<Button variant="outlined" color="error" startIcon={<Delete />}>Delete</Button>

{/* Browse/file picker */}
<Button variant="outlined" size="small" sx={{ minWidth: 80 }}>
    <FolderOpen sx={{ fontSize: 18 }} />
</Button>
```

### Footer Layout

```jsx
<Box sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
    <Stack direction="row" spacing={1}>
        <Button variant="contained" sx={{ flex: 1 }}>Save</Button>
        <Button variant="outlined" sx={{ flex: 1 }}>Close</Button>
        {/* Optional spacer for right-aligned buttons */}
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" color="error">Delete</Button>
    </Stack>
</Box>
```

### Key Values

| Property | Value |
|----------|-------|
| Content padding | `p: 2` |
| Header margin bottom | `mb: 2` |
| Stack spacing | `spacing={2}` |
| Tab sidebar width | `56px` |
| Tab indicator | `left: 0, width: 3` |
| Footer padding | `p: 2` |
| Button spacing | `spacing={1}` |

### Window Dimensions (backend)

Standard editor windows use `width: 960, height: 1024` in `backend/items/itemEditor.js`.

---

## Recent Development Work

### Welcome Screen & Package Creation

- **Implemented**: Welcome screen that shows when no package is loaded
- **Features**:
    - Three main actions: New Package, Open Package, Import Package
    - Compact, modern card-based UI
    - Package creation in separate window
    - Package ID format: `PACKAGENAME_UUID` (4 characters)
    - Required fields: Package Name, Description
    - Automatic transition to ItemBrowser after package load
    - State management tracks whether a package is loaded
    - Creates proper package structure with `info.json`

### Item Creation System

- **Implemented**: Full item creation workflow with separate window
- **Features**:
    - Generates unique item IDs using format: `bpee_{itemName}_{author}_{UUID}`
    - UUID is 4 characters long (e.g., `bpee_test_areng_A3F9`)
    - Collision detection ensures unique IDs
    - Required fields: Name, Description, Icon, Instances (at least one)
    - Creates necessary file structure:
        - `items/{itemName}_{author}/editoritems.json`
        - `items/{itemName}_{author}/properties.json`
        - `resources/BEE2/items/{packageId}/{itemName}.png` (icon)
        - `resources/instances/bpee/{itemId}/instance.vmf` (and instance_1.vmf, instance_2.vmf, etc. for multiple instances)
        - Instance paths in editoritems: `instances/BEE2/bpee/{itemId}/instance.vmf`
    - Updates package `info.json` with new item entry
    - Window automatically closes on successful creation

### Item Deletion System

- **Implemented**: Comprehensive item deletion with confirmation
- **Features**:
    - Delete button in item editor footer
    - Confirmation dialog with warning about permanent deletion
    - Shows what will be deleted (configuration, instances, conditions, etc.)
    - Cleans up all associated files:
        - Item folder (`items/{itemName}_{author}/`)
        - Instance files in `resources/instances/bpee/{itemId}/`
        - Icon file in `resources/BEE2/items/`
        - Entry in package `info.json`
    - Updates in-memory package data
    - Refreshes UI automatically

### VBSP Conditions - Random Array Support

- **Implemented**: Support for "random" arrays in VBSP conditions
- **Features**:
    - Parses random selection structures from condition results
    - Visual block editor with "Random Selection" block type
    - Displays options as numbered list in the UI
    - Validates random selection blocks
    - Uses `Hive` icon for visual representation

### Item Metadata Tracking

- **Implemented**: Automatic tracking of item characteristics in `meta.json`
- **Features**:
    - **Timestamps**: Automatically tracks creation and last modified dates
    - **Custom Model Status**: Tracks when an item has a custom BeePEE-generated model (`hasCustomModel`)
    - **Import Status**: Tracks when an item was imported from VBSP config (`isImported`, `_vbsp_imported`)
    - Displayed in Metadata tab of item editor
    - Automatically updated when:
        - Custom models are generated and saved
        - Items are imported from VBSP
        - Item files are modified
- **File Structure**:
    ```json
    {
        "created": "2025-11-07T19:31:24.862Z",
        "lastModified": "2025-11-07T19:31:25.013Z",
        "hasCustomModel": true,
        "isImported": true,
        "_vbsp_imported": true
    }
    ```

### Beta Release System

- **Making a beta release**:
    1. Set `version` in `package.json` to a prerelease version, e.g. `1.2.0-beta.1`
    2. Update `changelog-beta.json` with the beta's changes
    3. Run `npm run build:beta` - builds the installer locally, publishes NOTHING to GitHub
    4. Share the installer from `release/` (e.g. `BeePEE Setup 1.2.0-beta.1.exe`) directly with testers (Discord etc.)
    5. For the stable release later, set version to `1.2.0`, update `changelog.json`, and run `npm run publish`
- **Distribution**: betas are distributed manually as installer files only - they never appear on GitHub. `build:beta` passes `--publish never` so nothing leaks even if `GH_TOKEN` is set.
- **Beta → stable graduation**: beta builds still check the main repo for updates. New betas won't be offered (they're not on GitHub), but when the stable version ships, semver ranks `1.2.0` above `1.2.0-beta.x`, so beta users are automatically offered the stable update.
- **Channel detection** (`backend/utils/betaInfo.js`): a build is "beta" when its version has a `-beta`/`-alpha`/`-rc` suffix. Everything below keys off this.
- **Version guard** (`scripts/check-release-version.js`): `npm run publish` fails on prerelease versions, `npm run build:beta` fails on plain versions - prevents shipping the wrong channel.
- **Startup popup**: beta builds show a warning dialog on every launch (`backend/main.js`) telling testers the build is bug prone, to stress test, and to report bugs via Help > Report Bug.
- **Beta changelog** (`changelog-beta.json`): beta builds load this file in the What's New window instead of `changelog.json` (falling back to it if missing) - see `load-changelog` in `backend/handlers/updateHandlers.js`. Same JSON structure as the stable changelog.
- **Auto-updater**: beta builds set `allowPrerelease = true` (harmless since the main repo only has stable tags); stable builds filter out any `-beta.x` tagged version by semver suffix.
- **Separate bug report endpoint**: set `CRASH_REPORT_ENDPOINT` (stable) and `CRASH_REPORT_ENDPOINT_BETA` (beta) in `.env`. At build time `scripts/inject-config.js` writes them to `backend/utils/crashEndpoints.generated.json` - a **gitignored** file read at runtime by `crashReportConfig.js`, so real URLs never touch tracked source and can't be committed by accident. `restore-config.js` deletes the generated file after the build. Beta builds report to the beta endpoint (falling back to stable if unset); reports include a `channel` form field (`beta`/`stable`).

## Key Technical Architecture

### Electron IPC Communication

**Main Process** (`backend/events.js`):

- `open-create-item-window` - Opens item creation window
- `create-item` - Handles item creation (file system operations)
- `delete-item` - Handles item deletion (file system cleanup)
- `open-item-editor` - Opens item editor window
- `show-open-dialog` - Exposes file picker dialog

**Preload Script** (`backend/preload.js`):

- Exposes secure APIs to renderer via `contextBridge`
- `window.electron.invoke` - Generic IPC invoker
- `window.electron.showOpenDialog` - File picker
- `window.package.*` - Package-specific APIs
- **Event Listeners**: Uses `ipcRenderer.removeAllListeners()` before adding new listeners to prevent stacking

**Renderer Process** (React components):

- Uses `window.electron.invoke()` for backend communication
- Listens for events via `window.package.on*` methods

### Logging

- **Logger** (`backend/utils/logger.js`): all `console.*` output of the main process goes through it, as plain text (no emojis), to the terminal and `userData/logs/beepee-<time>.log` (Help > Open Logs Folder). Warnings and errors get a `Warning: ` / `Error: ` label automatically.
- **Steps drawn as a tree**: wrap multi-step work in `await logger.section("Model generation for \"X\"", async () => {...})`. Everything logged while it runs (also in the functions it calls, across awaits) is drawn under the title with `├─ │ └─`, and the step ends with `[✓] Done in 1.2 s` or `[✗] Failed after 1.2 s: <reason>` and a spacer line (thrown errors are re-thrown; returning `{ success: false, error }` also counts as failed). Steps run in parallel (`Promise.all`) use `{ buffered: true }`, so each keeps its lines together, in the order they started. Don't wrap code that leaves timers or listeners running.
- **Windows' logs**: `src/utils/logForwarding.js` (imported first in `src/main.jsx`) sends each window's console output and uncaught errors over `renderer:log` to `backend/handlers/logHandlers.js`, which logs them as `[Item Editor] ...` (the window name comes from its `?route=`).
- **Keeping logs small**: log one summary line with counts instead of a line per file, use `logger.debug` for per-file detail (only written in development or with verbose logging), and never dump whole objects. The logger also cuts messages at 4000 characters, writes a line repeated many times in a row once with a count, continues in a new file after 5 MB and keeps the 10 newest files.

Example (Make Model on an item with 3 variants; each line also gets its time in the log file):

```
Model generation for "Better Floor Button" (BUTTON TYPE variants)
├─ 3 values of BUTTON TYPE use 3 instances
├─ Converting 3 instances to OBJ
│  ├─ better_floor_button_0: instances/beepkg/better_floor_button/better_floor_button_0.vmf
│  │  ├─ 41 brushes (6147 faces), 1 prop, 7 materials
│  │  └─ [✓] Done in 645 ms
│  │
│  ├─ Applied the cartoon style to 12 textures in 571 ms
│  └─ [✓] Done in 2.4 s
│
├─ Compiling 3 models
│  ├─ Making better_floor_button_0.mdl
│  │  ├─ Compiled better_floor_button_0.mdl with studiomdl
│  │  └─ [✓] Done in 7.2 s
│  │
│  └─ [✓] Done in 7.2 s
│
├─ Made 3 of 3 models, staged as 3 subtypes (applied on Save)
└─ [✓] Done in 10.1 s
```

### React State Management

#### ItemBrowser Component

**Critical Fix**: Item click handling uses item ID instead of full object to prevent stale closure issues:

```javascript
// Pass only the ID
;<ItemIcon item={item} onEdit={() => handleEditItem(item.id)} />

// Always look up current item from latest state
const handleEditItem = (itemId) => {
    const currentItem = items.find((i) => i.id === itemId)
    if (!currentItem) {
        console.warn("Item no longer exists, skipping editor open:", itemId)
        return
    }
    window.package.openItemEditor(currentItem)
}
```

**Why this matters**:

- React's `map()` creates closures that capture item objects
- Even after state updates, old DOM elements retain old item references
- Passing primitive IDs ensures we always look up fresh data from current state
- Prevents "Item not found" errors when clicking deleted items

#### Event Listener Management

**Critical Fix**: Prevent listener stacking in `backend/preload.js`:

```javascript
onPackageLoaded: (callback) => {
    ipcRenderer.removeAllListeners("package:loaded") // Remove old listeners
    ipcRenderer.on("package:loaded", (event, items) => callback(items))
}
```

**Why this matters**:

- Multiple listeners would stack up on hot reload or component remount
- Caused duplicate UI updates and inconsistent state
- `removeAllListeners` ensures only one active listener at a time

## File Structure

### Backend Files

- `backend/events.js` - IPC handlers for all application features
- `backend/items/itemEditor.js` - Window management for editor and creation
- `backend/models/items.js` - Item class and data management
- `backend/models/package.js` - Package class managing item collections
- `backend/packageManager.js` - Package loading and conversion (VDF/JSON)
- `backend/saveItem.js` - File system operations for saving items
- `backend/preload.js` - Secure API exposure to renderer

### Frontend Files

- `src/App.jsx` - Main app with routing (supports query-based routes for production)
- `src/components/ItemBrowser.jsx` - Grid view of all items
- `src/components/ItemEditor.jsx` - Main editor with tabs and delete functionality
- `src/components/AddItem.jsx` - Button to open creation window
- `src/pages/CreateItemPage.jsx` - Separate window for item creation
- `src/components/items/` - Individual editor tabs (Info, Instances, Conditions, etc.)

## Known Issues & Solutions

### Issue 1: Items not showing in-game after creation

**Problem**: Instance paths in `editoritems.json` were absolute file system paths instead of relative.

**Solution**: Modified `create-item` handler to use relative paths:

```javascript
const instanceFileName = index === 0 ? "instance.vmf" : `instance_${index}.vmf`
editoritems.Item.Exporting.Instances[index.toString()] = {
    Name: `instances/BEE2/bpee/${itemId}/${instanceFileName}`, // Relative path with BEE2 prefix
    EntityCount: 0,
    BrushCount: 0,
    BrushSideCount: 0,
}
```

### Issue 2: UI not updating after item creation/deletion

**Problem**: Multiple event listeners stacking up, causing inconsistent state updates.

**Solution**: Added `removeAllListeners()` before registering listeners in preload script.

### Issue 3: "Item not found" errors when clicking deleted items

**Problem**: React closures capturing stale item objects.

**Solution**: Changed to pass item IDs and look up fresh data from current state.

### Issue 4: BEE2 "Unknown instance option error" when parsing editoritems

**Problem**: When VMF files don't exist, `vmfParser.js` added an `"error": "File not found"` property to instance stats, which got saved to editoritems.json. BEE2's parser doesn't recognize "error" as a valid instance property.

**Solution**: Modified `backend/models/items.js` to explicitly extract only valid properties (EntityCount, BrushCount, BrushSideCount) instead of using spread operator that includes error property:

```javascript
editoritems.Item.Exporting.Instances[nextIndex.toString()] = {
    Name: instanceName,
    EntityCount: vmfStats.EntityCount || 0,
    BrushCount: vmfStats.BrushCount || 0,
    BrushSideCount: vmfStats.BrushSideCount || 0,
}
```

## Item Creation Flow

1. User clicks "+" button in ItemBrowser
2. `AddItem.jsx` invokes `open-create-item-window`
3. New BrowserWindow opens with `CreateItemPage.jsx`
4. User fills form: name, description, author, selects icon and instance files
5. Click "Create" → invokes `create-item` IPC
6. Backend (`backend/events.js`):
    - Validates input
    - Generates unique ID with collision check
    - Creates folder structure
    - Copies icon and instance files
    - Creates `editoritems.json` and `properties.json`
    - Updates package `info.json`
    - Creates new Item instance
    - Sends `package-loaded` event to refresh UI
    - Closes creation window
7. ItemBrowser receives update and re-renders with new item

## Item Deletion Flow

1. User opens item in editor
2. Clicks "Delete" button in footer
3. Confirmation dialog appears with warnings
4. User confirms → invokes `delete-item` IPC with itemId
5. Backend (`backend/events.js`):
    - Finds item in package
    - Deletes item folder recursively
    - Deletes all instance files
    - Deletes icon file
    - Updates package `info.json` (removes item entry)
    - Removes from in-memory package items array
    - Sends `package-loaded` event to refresh UI
6. ItemBrowser receives update and re-renders without deleted item
7. Editor window closes automatically

## Development Best Practices

1. **Always use `removeAllListeners`** before registering IPC event listeners
2. **Pass primitive values** (IDs) in React callbacks, not full objects
3. **Look up fresh state** inside event handlers, don't rely on closures
4. **Use relative paths** for game resources (instances, icons)
5. **Validate input** on both frontend and backend
6. **Clean up resources** completely when deleting items
7. **Update UI** by sending events, not relying on component state alone
8. **Handle errors gracefully** with console warnings and user feedback

## Routing System

### Development

Uses normal React Router with `BrowserRouter`.

### Production

Uses query parameters to determine which window to render:

- `?route=editor` → Item Editor
- `?route=create-item` → Create Item Window
- No query → Main ItemBrowser

Example:

```javascript
const urlParams = new URLSearchParams(window.location.search)
const routeParam = urlParams.get("route")
const showEditor = routeParam === "editor"
const showCreateItem = routeParam === "create-item"
```

## Future Considerations

- Consider adding undo functionality for item deletion
- Add item duplication feature
- Implement item search/filter in browser
- Add batch operations (delete multiple items)
- Export/import individual items between packages
- Validation for instance file compatibility

---

## Custom Model Conversion System

### Overview

Automatically converts VMF instances → OBJ files → Source Engine MDL files, and **stages** changes to editoritems.json (applied on Save).

### Model Generation Staging System

**IMPORTANT**: Model generation now uses a **complete staging system** - changes are NOT applied immediately to the package files. Instead:

1. **Temporary files** are generated in `.bpee/tempmdl/` (OBJ, QC, extracted textures)
2. **Model files** (MDL, VVD, VTX) are staged in `.bpee/models/` (not `resources/models/`)
3. **Material files** (VTF, VMT) are staged in `.bpee/materials/` (not `resources/materials/`)
4. **3DS collision models** are staged in `.bpee/models/puzzlemaker/`
5. **editoritems.json changes** are staged in memory and returned to the frontend
6. The Save button becomes enabled with pending model changes
7. User must click **Save** in the Item Editor to:
   - Copy all staged files from `.bpee/` to `resources/`
   - Apply editoritems.json changes to disk
   - Clean up staging directories (models and materials copied, staging deleted)
8. The Save button is **blocked** during model generation to prevent mid-generation saves

### What Happens When You Click "Make Model"

1. **VMF → OBJ Conversion**
    - Converts the VMF instance file to OBJ format
    - Extracts textures and applies optional cartoonish styling
    - Outputs to: `{package}/.bpee/tempmdl/{instance}.obj`

2. **Material Staging**
    - Converts PNG/TGA textures to VTF format
    - Generates VMT material files
    - **Stages in**: `{package}/.bpee/materials/models/props_map_editor/bpee/{itemName}/`
    - **NOT copied to resources/ until Save is clicked**

3. **OBJ → MDL Conversion**
    - Generates a QC (QuakeC) file that describes the model compilation
    - Uses STUDIOMDL from the Source SDK to compile the OBJ into MDL
    - Compiles to Portal 2 directory (STUDIOMDL requirement)
    - Creates multiple files: `.mdl`, `.vvd`, `.vtx` (various formats: plain, dx90, dx80, sw)
    - **Stages in**: `{package}/.bpee/models/props_map_editor/bpee/{itemName}/`
    - **NOT copied to resources/ until Save is clicked**
    - **Cleans up Portal 2 directory** - deletes compiled files and empty folders

4. **3DS Collision Model Staging**
    - Converts OBJ to 3DS format for collision detection
    - **Stages in**: `{package}/.bpee/models/puzzlemaker/selection_bpee/{itemName}/`
    - **NOT copied to resources/ until Save is clicked**

5. **editoritems.json Staging** (STAGED - not saved immediately!)
    - Creates a modified copy of editoritems.json in memory (not saved to disk)
    - Adds/updates the Model section:
        ```json
        "Model": {
            "ModelName": "bpee/item/bpee_myitem_areng_a3f9.mdl"
        }
        ```
    - Returns staged editoritems to frontend via `stagedEditorItems` field
    - **User must click Save** in the Item Editor to apply changes
    - Uses the item ID as the model filename to ensure each item has a unique model

### Files Created

**New Utility: `backend/utils/mdlConverter.js`**

- `getStudioMDLPath()` - Locates STUDIOMDL executable
- `generateQCFile()` - Creates QC compilation script
- `convertObjToMDL()` - Runs STUDIOMDL compilation
- `copyMDLToPackage()` - Copies compiled files to package and cleans up Portal 2 directory
- `convertAndInstallMDL()` - Main orchestration function

**Updated Files:**

- `backend/events.js` - Enhanced `convert-instance-to-obj` handler with MDL conversion and staging system
  - Added `save-staged-editoritems` IPC handler to save staged changes on demand
  - Model generation now returns `stagedEditorItems` instead of saving immediately
- `src/components/ItemEditor.jsx` - Added model generation state management
  - `isGeneratingModel` state blocks Save button during generation
  - `stagedEditorItems` state holds pending editoritems changes
  - Save handler applies staged changes via `save-staged-editoritems` IPC call
- `src/components/items/Other.jsx` - Added generation callbacks
  - Calls `onModelGenerationStart()` when generation begins
  - Calls `onModelGenerationComplete(stagedEditorItems)` when complete
  - Extracts `stagedEditorItems` from backend response
- `package.json` - Added extraResources configuration for STUDIOMDL

### QC File Structure

```qc
$modelname "props_map_editor/bpee/item/bpee_myitem_areng_a3f9.mdl"
$staticprop
$body body "instance.obj"
$surfaceprop "default"
$cdmaterials "models/props_map_editor/"
$scale 1.0
$sequence idle "instance.obj" fps 30
```

The model name uses the item ID (sanitized for filenames) to ensure uniqueness.

**Path structure:** `props_map_editor/bpee/item/` - Simple and clean!

### Directory Structure

**During Compilation (temporary):**

```
C:\...\Portal 2\portal2\models\props_map_editor\bpee\item\
├── bpee_myitem_areng_a3f9.mdl        (compiled here by STUDIOMDL)
├── bpee_myitem_areng_a3f9.vvd
├── bpee_myitem_areng_a3f9.vtx        (can be .vtx, .dx90.vtx, .dx80.vtx, .sw.vtx)
```

**After Copy & Cleanup (Portal 2 files deleted):**

```
{package}/
├── temp_models/                    (temporary build files)
│   ├── instance.obj
│   ├── instance.mtl
│   ├── instance.qc
│   └── materials/                  (extracted textures)
└── resources/
    └── models/
        └── props_map_editor/
            └── bpee/
                └── item/
                    ├── bpee_myitem_areng_a3f9.mdl  (Source model - COPIED)
                    ├── bpee_myitem_areng_a3f9.vvd  (Vertex data - COPIED)
                    └── bpee_myitem_areng_a3f9.vtx  (Vertex indices - COPIED, any format)
```

**Note:** Each item gets its own uniquely named model based on the item ID to prevent conflicts!

**⚠️ All files are needed!** Source Engine requires all file types (.mdl, .vvd, .vtx) to load the model correctly.

### Requirements

1. **STUDIOMDL** - Located in `backend/libs/studiomdl/studiomdl.exe`
2. **Portal 2 Installation** - Required for STUDIOMDL's `-game` parameter (points to `gameinfo.txt`)
3. **Valid OBJ File** - Must be generated from VMF first

### User Experience

**Success Messages:**

- ✅ Full Success: "Model generated successfully! OBJ: ... MDL: ... **Changes will be applied when you click Save in the editor.**"
- ⚠️ Partial Success: "OBJ created but MDL conversion failed" (OBJ preview still works)
- ❌ Failure: Specific error message with details

**Workflow:**

1. User clicks "Make Model" in the Other tab
2. Save button becomes **disabled** during generation
3. Model files are created and copied to package
4. editoritems changes are **staged in memory** (not saved to disk)
5. Save button becomes **enabled** with pending changes
6. User clicks **Save** to apply staged editoritems changes
7. Staged changes are cleared after successful save

### Error Handling

Graceful degradation:

- If MDL conversion fails, OBJ file is still available for preview
- Error messages include specific failure reasons
- editoritems.json changes are **staged only if MDL conversion succeeds**
- Staged changes are **not applied** if user discards without saving
- Portal 2 directory cleanup continues even if individual file deletion fails
- Save button is blocked during generation to prevent corruption

### Compilation Flow

1. **Compile**: STUDIOMDL must output to `{Portal 2}/portal2/models/props_map_editor/bpee/item/` (hardcoded by Source SDK)
2. **Copy**: All `.mdl`, `.vvd`, and any `.vtx` files copied to package `resources/models/props_map_editor/bpee/item/`
3. **Cleanup**: Delete all compiled files from Portal 2 directory
4. **Cleanup Directories**: Remove empty `item/` and `bpee/` folders if empty
5. **Stage**: Create modified editoritems.json in memory with Model section (`bpee/item/{itemId}.mdl`)
6. **Return**: Send staged editoritems to frontend via `stagedEditorItems` field
7. **Wait for Save**: User must click Save button to apply changes to disk via `save-staged-editoritems` IPC

### Why Portal 2 Directory is Used

- STUDIOMDL's `-game` parameter requires the folder containing `gameinfo.txt`
- The tool **always** outputs relative to `{-game}/models/{$modelname}`
- There's no way to specify a custom output directory
- We copy the files out and clean up immediately after compilation

### Export Behavior

When exporting packages:

- `.bpee/` directory is **automatically excluded** from exports
- This folder only contains:
  - Temporary build files (`.bpee/tempmdl/`: OBJ, QC, MTL, extracted textures)
  - Staged model files (`.bpee/models/`: MDL, VVD, VTX, 3DS - only if not yet saved)
  - Staged material files (`.bpee/materials/`: VTF, VMT - only if not yet saved)
- Final MDL and material files are in `resources/` after the user clicks Save and will be included in exports

---

## 3DS Collision Model System

### Overview

Automatically generates 3DS collision models alongside MDL files for proper physics interaction in the Portal 2 Puzzle Editor.

### What Happens When You Click "Make Model"

1. **VMF → OBJ Conversion** (existing functionality)
    - Converts the VMF instance file to OBJ format
    - Extracts textures and applies optional cartoonish styling
    - Outputs to: `{package}/temp_models/{instance}.obj`

2. **OBJ → MDL Conversion** (existing functionality)
    - Generates QC file and compiles with STUDIOMDL
    - Creates MDL, VVD, VTX files
    - Copies to: `{package}/resources/models/props_map_editor/bpee/{itemName}/`

3. **OBJ → 3DS Conversion**
    - Converts the same OBJ file to 3DS format for collision detection (`backend/utils/objTo3ds.js`), scaled and rotated for the editor
    - Outputs to: `{package}/temp_models/{itemName}.3ds`

4. **3DS Installation** (NEW!)
    - Copies 3DS file to: `{package}/resources/models/puzzlemaker/selection_bee2/bpee/{itemName}/{itemName}.3ds`
    - Updates `editoritems.json` with `CollisionModelName` field

### Files

**`backend/utils/objTo3ds.js`** (replaced the Python `convert_obj_to_3ds.exe`, writing the same bytes)

- Writes one triangle mesh object named "collision": vertices are scaled, then rotated by roll (X), pitch (Y) and yaw (Z); polygons become triangle fans
- 3DS counts are 16-bit, so meshes with more than 65,535 vertices or faces are split into several objects ("collision", "collision2", ...)

**Functions in `backend/utils/mdlConverter.js`:**

- `convertObjTo3DS()` - Converts the OBJ with `objTo3ds.js`
- `copy3DSToPackage()` - Copies 3DS to correct package directory
- `convertAndInstallMDL()` - Runs the 3DS conversion after the MDL compile

### Directory Structure

```
{package}/
├── temp_models/                    (temporary build files)
│   ├── instance.obj               (source geometry)
│   ├── instance.mtl
│   ├── instance.qc
│   ├── {itemName}.3ds            (temporary 3DS file)
│   └── materials/
└── resources/
    └── models/
        ├── props_map_editor/       (MDL display models)
        │   └── bpee/
        │       └── {itemName}/
        │           ├── {itemName}.mdl
        │           ├── {itemName}.vvd
        │           └── {itemName}.vtx
        └── puzzlemaker/            (3DS collision models)
            └── selection_bee2/
                └── bpee/
                    └── {itemName}/
                        └── {itemName}.3ds
```

### editoritems.json Structure

```json
{
    "Item": {
        "Editor": {
            "SubType": {
                "Model": {
                    "ModelName": "bpee/{itemName}/{itemName}.mdl",
                    "CollisionModelName": "puzzlemaker/selection_bee2/bpee/{itemName}/{itemName}.3ds"
                }
            }
        }
    }
}
```

### Requirements

None: the conversion runs inside BeePEE.

### User Experience

**Success Messages:**

- ✅ Full Success: "MDL and 3DS collision models created successfully!"
- ⚠️ Partial Success: "MDL created but 3DS collision model failed" (MDL still works)
- ❌ Failure: Specific error message with details

### Error Handling

Graceful degradation:

- If 3DS conversion fails, MDL model is still created successfully
- Error messages include specific failure reasons
- editoritems.json is only updated with CollisionModelName if 3DS succeeds
- 3DS is optional - items will still work in-game with just MDL

### Why Two Model Formats?

- **MDL (.mdl, .vvd, .vtx)** - Source Engine display model with materials and shading
- **3DS (.3ds)** - Simplified collision geometry for physics interaction in Puzzle Editor
- Portal 2's Puzzle Editor uses 3DS for selection bounds and collision detection
- This matches the standard BEE2 item format structure

---

## Model Dependencies

`backend/utils/mdlDependencies.js` lists the materials and textures a model needs, for the autopacker (`autopacker.js`) and the instance asset check (`instanceHandlers.js`). It replaced the Python `find_mdl_deps.exe` (srctools) and gives the same results (checked on all 270 models used by the packages), about 100x faster since the file index is built once and reused.

It follows srctools' `PackList` rules:

- The model's textures resolve to the first VMT found in its `$cdmaterials` folders (plus the textures' own folders and the root), for the skin table columns its meshes use
- Each VMT adds its `patch` parents, every parameter srctools types as a texture (listed even if the file is missing; `env_cubemap` and `_rt_` buffers skipped) and material parameters (`$bottommaterial`, `$crackmaterial`, `$translucent_material`)
- Included models (`$includemodel`) and gibs (`break` models in the `.phy`) are followed too
- Files are looked up like the game does: the search paths in `gameinfo.txt`, plus the DLC, `update` and `platform` folders, VPKs before loose files

No Python is needed anywhere in BeePEE.

---

## Autopacking

When an instance is added to an item (or replaced), `backend/utils/autopacker.js` copies the files it uses that aren't part of the game into the package's `resources/` (same paths). The instance asset check (`check-vmf-external-assets`) sorts files the same way; the Instances tab runs it on the VMFs the user picks and, when files are missing, shows the **Missing Files** dialog ("These files don't exist or aren't mounted properly") with Add Anyway / Cancel. A replaced instance shows it too, after packing.

**What the instance needs** (`vmfAssetExtractor.js` reads the VMF with the KeyValues parser):

- Models (`model`; sprite `.vmt`/`.spr` models are materials), with all their files (`.vvd`, `.phy`, `.ani`, `.vtx`), materials, `$includemodel`s and gibs (`mdlDependencies.js`)
- Materials: brush faces, `material`/`texture`/`texturename`/`ropematerial`/`spritename`/`overlaynameN`... keys (numbers like `func_breakable`'s `material` skipped), with their textures and included materials
- Sounds: sound files in any key (`.wav`/`.mp3`/`.ogg`, sound characters like `)` stripped) and soundscript names in sound keys (`ambient_generic`'s `message`, `noise1`, ...). A custom soundscript entry brings its sound files and its soundscript file.
- VScripts: `vscripts` (several, `.nut` optional, under `scripts/vscripts/`) and `RunScriptFile` outputs

**Where each file comes from** (the game's file index, VPKs first):

- **The original game, never packed**: the game's VPKs; the official DLC folders (`portal2_dlc1`, `portal2_dlc2`), `platform` and `update` (only the game has files there); and loose files in `Portal 2/portal2` dated like the game's own files (the dates of its VPKs and of the `platform` files, when Steam installed or updated it) - the game ships ~250 scripts loose there, outside its VPKs
- **BEE2's, never packed**: `bee2/`, the DLC folder BEE2 puts its generated VPK in (marked with `bee2_vpk_autogen_marker.txt`), and `bee2/` content paths that don't exist yet (made when BEE2 exports)
- **In the package already**: nothing to do
- **Custom, packed**: everything else - custom content folders, files added to `Portal 2/portal2` later, other VPKs (extracted)
- **Missing**: reported (dialog and log) when the instance names the file, or when custom content needs it (a custom material's texture, a custom model's materials), with what needs it; missing files the original game's content names (like gibs the game itself lacks) only go to the debug log

## VMF to OBJ Conversion (VMF2OBJ port)

### Overview

`backend/utils/vmfConverter/` converts VMF instances into OBJ + MTL files with PNG textures, in-process (no Java). It is a JavaScript port of [VMF2OBJ](https://github.com/Dylancyclone/VMF2OBJ) by Dylancyclone (MIT, see `LICENSE-VMF2OBJ.txt` in that folder) and handles brushes, brush entities, displacements, model entities (props, NPCs, ...), overlays and decals.

`backend/utils/vmf2obj.js` wraps it for BeePEE: it builds the resource path list, rotates the OBJ into Three.js space and applies the cartoon texture style.

The cartoon style (`backend/utils/cartoonFilter.js`, in JS; it replaced the Python `cartoon.exe`) aims for the look of the puzzle editor's own models: flat clean colors, light neutral greys and vivid accents. Each texture is shrunk to at most 256 px (power-of-two sizes; texture coordinates are relative, so the stretch doesn't matter), flattened with a Kuwahara filter, graded (lifted darks, neutral near-greys, livelier real colors) and smoothed with a surface blur that melts faint detail like logos but keeps strong edges. All steps wrap around the texture's edges, so tiling textures stay seamless, and alpha is kept.

| Module | Purpose |
| --- | --- |
| `index.js` | `VmfConverter` session (shared caches) and OBJ/MTL writing |
| `vmf.js` / `keyvalues.js` | VMF/KeyValues parsing |
| `brushes.js` | Side planes → face polygons, displacement grids |
| `models.js` | Crowbar decompile, QC/SMD parsing, posing props |
| `textures.js` | VMT parsing, VTF decoding, PNG encoding |
| `overlays.js` | Baking `info_overlay`s and `infodecal`s into the textures of their faces |
| `blends.js` | Baking displacement blend materials into a texture per displacement |
| `vpk.js` / `resources.js` | VPK reading and the content lookup across VPKs/folders |

### Usage

```js
const { convertVmfToObj, convertVmfsToObj } = require("./backend/utils/vmf2obj")

// One instance -> outputDir/<vmf name>.obj/.mtl + outputDir/materials/**.png
await convertVmfToObj(vmfPath, { outputDir, textureStyle: "cartoon" })

// Several instances in one session (multi-model items); outputs are named by outputName
await convertVmfsToObj([{ vmfPath, outputName: "item_0" }], { outputDir })
```

### Resource Paths

Resource paths are a list of:
- **VPK files** (e.g., `pak01_dir.vpk`)
- **Folders** containing `materials/` and/or `models/` subdirectories

Earlier paths win when several contain the same file. By default: Portal 2's `pak01_dir.vpk`, the VMF's package `resources` folder, then the paths configured at startup (gameinfo search paths such as `Portal 2/bee2`, and DLC VPKs). `|gameinfo_path|` search paths are relative to the `portal2` folder that holds gameinfo.txt. Only the `materials/` and `models/` subfolders of a folder are indexed.

**IMPORTANT:** When using folders, point to the PARENT folder that contains `materials/` or `models/`, NOT to those folders directly:

```
custom-content/        <-- SELECT THIS
├── materials/         <-- NOT this
│   └── models/
│       └── props/
└── models/            <-- NOT this
    └── props/
```

### Props

- Any entity with a model is converted, not just `prop_*`. Entities whose model is set in game code (e.g. `npc_security_camera`, buttons, chamber doors, `prop_weighted_cube` by `CubeType`) use the built-in table in `index.js`. `info_*` entities and `models/editor/` helper models are skipped.
- Models are decompiled with Crowbar (`backend/libs/crowbar/CrowbarCommandLineDecomp.exe`, previously bundled inside VMF2OBJ.jar), a few at a time.
- `prop_static` uses the reference pose. Other props are posed with their `DefaultAnim` (sequence name or activity) or the first sequence, like the engine does. This is what makes animated props such as item droppers stand upright.
- Placement: Crowbar's SMDs are rotated 90° about Z from model space, then Source's entity angles are applied (roll, then pitch, then yaw), then `uniformscale`/`modelscale` and `origin`.
- The first option of each body group is used; `skin` selects a `$texturegroup` row.

### Overlays and Decals

- `info_overlay`s and `infodecal`s are baked into the textures of the brush faces they're on (`overlays.js`). Each such face gets its own texture, `materials/bpee_overlays/bpee_overlay_<output name>_<side id>.png`, covering the face's texture coordinates: the face's (tinted) texture copied texel for texel, with the overlays and decals drawn over it. The face's UVs are remapped onto it.
- As in Source, an overlay is projected along `BasisNormal` onto each face in its `sides` and clipped to it (corners `uv0`–`uv3` around `BasisOrigin`, texture coordinates from `StartU`/`EndU`/`StartV`/`EndV`). So overlays can't overhang their faces, z-fight or need transparency.
- A decal goes on every face whose plane is within 4 units of its origin (the engine's `DECAL_DISTANCE`), centered on the origin and as big as its texture times `$decalscale`. Its orientation follows the engine's `R_DecalComputeBasis`: on floors and ceilings S runs along +X, on walls T points down.
- Overlays are drawn in `RenderOrder`, then VMF order, followed by decals in VMF order. Both blend like their shader: `$translucent` alpha blending, `$alphatest` cutouts, `$additive`, `DecalModulate` (2 × overlay × face) and `$alpha`. Opaque materials cover the face.
- A face's baked texture gets up to 8 pixels per face texel when an overlay or decal is sharper than the face's texture, and is at most 2048 px wide/high.
- Overlays and decals that end up on no visible face (overlays without `sides` or with sides that aren't in the instance, decals with no face within 4 units, anything only on displacements or skipped tool faces) are left out with a warning. Many decals in item instances are meant for the chamber's walls and floors, which aren't part of the instance.

### Displacement Blends

- Displacements with a blend material (`WorldVertexTransition` with `$basetexture2`) get a texture with the blend baked in (`blends.js`): `materials/bpee_blends/bpee_blend_<output name>_<side id>.png`. It spans the displacement's vertex grid, and each vertex's texture coordinates become (column, row) / (size − 1) on it.
- Each texel blends `$basetexture` and `$basetexture2` by the vertex alphas (`alphas` in the dispinfo, 0 = first texture, 255 = second), sampled at the grid's texture coordinates. A `$blendmodulatetexture` sharpens the blend like the shader does: `smoothstep(g − r, g + r, alpha)`.
- Displacements whose alphas are all 0 keep their normal material and texture coordinates.

### Materials

- VMTs are parsed as KeyValues: shader fallback blocks are ignored, `patch` materials follow their `include`, and GPU/srgb key conditions are evaluated.
- Base textures are decoded from VTF (DXT1/3/5 and the uncompressed formats) and written as PNG; the PNG keeps alpha only for `$translucent`/`$alphatest` materials.
- Those materials get `illum 4` and a `# beepee:translucent` / `# beepee:alphatest` line in the MTL. `convertMaterialsToPackage` (`mdlConverter.js`) reads the marker and `editorVmt` writes `$translucent 1` or `$alphatest 1` without `$selfillum`: with `$selfillum` on, Source's shaders use the base alpha as the self-illumination mask and ignore it for opacity.
- BeePEE skips `$bumpmap` textures (`includeBumpMaps: false`) since editor models only use the base texture.
- Tints are baked into texture copies (`<texture>_tint_<rgb>.png`): the entity's `rendercolor` (props, NPCs, brush entities) times the material's `$color`/`$color2`, masked by alpha with `$blendtintbybasealpha`.
- Materials or textures that can't be found or read get a purple/black checkerboard (`bpee_missing_texture.png`) instead of being dropped. With `skipTools`, faces using `tools/` materials are skipped.
- A conversion that produces no faces throws a user-facing error (`assertHasGeometry`) instead of producing an empty model.

### Unsupported Features

- ❌ Overlays and decals on displacements
- ❌ Body group selection via the `body` keyvalue
- ❌ Compressed (Strata) VTFs

### Tests

`backend/__tests__/vmfConverter.test.js` covers parsing, brush geometry, entity angles, QC/SMD handling and posing, the VTF/PNG/VPK codecs, overlays, decals, displacement blends, editor VMTs and an end-to-end conversion.


---

## Icon Maker

The item editor's Info tab has **Make Icon**, which opens the icon maker in its own window (`createIconMakerWindow` in `backend/items/itemEditor.js`, route `icon-maker`: `src/pages/IconMakerPage.jsx` with `src/components/items/IconMaker.jsx`). There's one per item; opening it again brings it up, and it closes with the item's editor and when the package closes. It shows one of the item's instances as a model in a square three.js view, as big as the window lets it be (the settings scroll beside it, or under it in a narrow window), to line up the shot:

- **Instance**: the instances whose VMF exists and has something to draw. Each one's model is made by `icon-maker-generate-model` (`backend/handlers/iconHandlers.js`: VMF to OBJ with the cartoon style) and kept in `.bpee/<item>/icon/models/<instance>/` with a stamp of its VMF, so it's only made again when the VMF changes; once one shows, the others are made in the background. The OBJ, MTL and textures are sent as text and data URLs. The Model Chooser can use these models as the item's model too.
- **Views**: 3/4 (the default), Front, Side, Top. Each frames the model: its vertices fill 85% of the frame, centered. **Reset Camera** goes back to the 3/4 view and the 30° lens. Switching instances keeps the camera where it is.
- Left-drag rotates, right-drag moves, the wheel zooms; **Lens** (field of view, perspective only) keeps the framing
- **Camera presets**: the built-in **Palette** is the palette icons' shot: isometric, 30° down and 30° off the item's front. It's the camera of Konclan's Blender icon renderer for BEEmod (angles 60 0 330), turned a quarter turn from the decompiled model's axes to the instance's. Saved presets are kept in the app's settings (`iconMakerCameraPresets`, shared by all items) relative to the model's framing, so they give the same shot on any item.
- **Model rotation**: pitch, yaw and roll that turn the model like an instance's angles in Hammer (around its origin), with +90° buttons; turning it frames it again from where the camera looks. The scene has Hammer's axes with Z up as Y (`x, z, -y`), so the angles are a `YZX` Euler of roll, yaw and -pitch.
- **Advanced camera**: Perspective or Isometric (an orthographic camera that follows the perspective one), the camera's yaw, pitch, roll and distance, its position and the point it looks at
- **Shadow** (a soft contact shadow under the model), **Size** (128/256/512; the icon is drawn at 1024 px, whatever the view's size on screen, and scaled down in halves), **Background** (the palette icons' grayish white by default, `ICON_BACKGROUND`: `#E5E9E9`, RGB 229 233 233)

**Use as Icon** saves the PNG (`icon-maker-save-icon`, `.bpee/<item>/icon/icon_<time>.png`) and hands it to the item's editor (`icon-maker-send-to-editor`; the editor gets `icon-made` and comes up), which stages it like a picked icon file: Save copies it to `resources/BEE2/items/` and makes the palette VTF.