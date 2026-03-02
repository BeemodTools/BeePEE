# BeePEE Project - Development Notes

## Project Overview

BeePEE is an Electron-based application for creating and editing Portal 2 Puzzle Editor items. It manages item packages, instances, conditions, and various item properties.

## BEEmod doccumentation for beemod itself and package things can be found in /docs_backup

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

3. **OBJ → 3DS Conversion** (NEW!)
    - Converts the same OBJ file to 3DS format for collision detection
    - Uses PyAssimp with triangulation and normal generation
    - Outputs to: `{package}/temp_models/{itemName}.3ds`

4. **3DS Installation** (NEW!)
    - Copies 3DS file to: `{package}/resources/models/puzzlemaker/selection_bee2/bpee/{itemName}/{itemName}.3ds`
    - Updates `editoritems.json` with `CollisionModelName` field

### Files Created

**New Utility: `backend/libs/areng_obj23ds/convert_obj_to_3ds.py`**

- Python script using PyAssimp for OBJ to 3DS conversion
- Handles triangulation (3DS requirement)
- Generates normals if missing
- Optimizes vertex data

**New Functions in `backend/utils/mdlConverter.js`:**

- `convertObjTo3DS()` - Executes Python converter script
- `copy3DSToPackage()` - Copies 3DS to correct package directory

**Updated Files:**

- `backend/utils/mdlConverter.js` - Added 3DS conversion to `convertAndInstallMDL()`
- `backend/events.js` - Updated all model conversion handlers to include 3DS paths
- `package.json` - Added `areng_obj23ds` to extraResources

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

**Option A: Blender (Recommended)**

1. **Blender** - Install from https://www.blender.org/
2. No additional setup required
3. Automatically detected in common installation paths

**Option B: PyAssimp (Fallback)**

1. **Python 3.x** - Must be available in system PATH
2. **PyAssimp** - Install with: `pip install pyassimp`
3. **Assimp Library DLL** - Must be in system PATH (not included with PyAssimp)

**Automatic Fallback:** BeePEE tries Blender first, then falls back to PyAssimp if Blender is unavailable.

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

## VMF2OBJ Tool

### Overview

VMF2OBJ converts Source engine VMF files into OBJ files with materials. It handles brushes, displacements, entities, and models.

**Location:** `backend/libs/VMF2OBJ/VMF2OBJ.jar`

**Bundled JRE:** `backend/libs/VMF2OBJ/jre/` (auto-downloaded if missing from Eclipse Adoptium)

### Command Line Interface

```bash
java -jar VMF2OBJ.jar [VMF_FILE] [args...]

Options:
  -h, --help                  Show help message
  -o, --output <arg>          Output file name (defaults to VMF filename)
  -q, --quiet                 Suppress warnings
  -r, --resourcePaths <arg>   Semi-colon separated list of VPK files and folders
  -t, --tools                 Ignore tool brushes
```

### Resource Paths (-r flag)

The `-r` flag accepts a semi-colon separated list of:
- **VPK files** (e.g., `pak01_dir.vpk`)
- **Folders** containing `materials/` and/or `models/` subdirectories

**IMPORTANT:** When using folders, point to the PARENT folder that contains `materials/` or `models/`, NOT to those folders directly:

```
custom-content/        <-- SELECT THIS
├── materials/         <-- NOT this
│   └── models/
│       └── props/
└── models/            <-- NOT this
    └── props/
```

### Known Bug: Files Without Extensions

**Problem:** VMF2OBJ crashes with `StringIndexOutOfBoundsException: Range [0, -1)` when scanning directories that contain files without extensions.

**Cause:** The `addExtraFiles` method at line 308 tries to extract file extensions using `lastIndexOf('.')`. If a file has no extension, this returns -1, causing `substring(0, -1)` to fail.

**Workaround:** Only pass VPK files to the `-r` flag, or ensure resource folders don't contain extension-less files.

### Supported Features

- ✅ Brushes
- ✅ Displacements
- ✅ Materials & Textures
- ✅ Bump Maps
- ✅ Transparency
- ✅ Brush Entities
- ✅ prop_* Entities (geometry, normals, materials)

### Unsupported Features

- ❌ prop_* skins (texture/QC mismatch issues)
- ❌ Displacement blend materials (would require texture generation or per-vertex materials)
- ❌ infodecal (projection logic unknown)
- ❌ info_overlay (complex multi-face projection)

### JRE Auto-Download

If the bundled JRE is not found, BeePEE automatically downloads Eclipse Temurin JRE 17 (~45MB) from:
```
https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse
```

The download includes progress reporting and extracts to the correct location automatically.
