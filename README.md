# BeePEE

A package authoring tool for BEEMOD. You can make, delete, and edit items in BeePEE.
BeePEE is a full rewrite of BPE (Beemod package editor) and has been combined with BeePKG's features.
BeePEE includes features such as:

## Features
### Item Editing
* Basic information editing
* Input / Output editing
* Instances editing
* VBSP edting
* Custom model generator

### Package Editing
* Package title editor
* Package description editor
* Package loading / saving
* Package creation

# Tutorial
Open the app and hit create package if you wish to make a new one,
Then fill out package name and description. After you have created a package, press the add button on the item browser.
You will be prompted to input a item id. Put in whatever you want the ID to be.
When you hit done, you will enter the item editor.

## Basic Information
Enter the name, author, and description of the item
Also give the item a icon by pressing the file button on the icon thing.
To generate custom models, You will need a instance(s) of your item.

> [!IMPORTANT]
> Custom models cannot be generated if portal 2 is not installed.

## Input Output
Press Add Input or navigate to the outputs page, and press Add Output.
In the input output editor, you will pick the entity, kinda like how the hammer I/O works.

> [!WARNING]
> Entities will only show when a instance file is present.

> [!IMPORTANT]
> Entites I/O stuff will only show up if there is a .fgd file

## Instances
To add a instance, hit Add VMF Instance and pick a VMF file.
If you vmf file contains custom assets, The program will automatically pack any custom assets into the package.
The program will also enter in the stats for your vmf instance.

> [!WARNING]
> The program cannot pack if the custom asset is in a .vpk.

> [!CAUTION]
> If your custom asset is not mounted to portal 2, ie: Not in a DLC folder, not mounted to gameinfo.txt
> It will not be able to find it.

> [!IMPORTANT]
> Autopack will only work if you have portal 2 installed.
## Varibles
Varibles are things the user can change when right clicking the item. 
This includes stuff like Start Enabled, Start Disabled, etc

> [!NOTE]
> Button type has not been implemented yet.

## Conditions
Conditions allow you to edit the VBSP config of the item.
Stuff like if cubetype = standard, change instance to x.
You will use blocks to configure the configuration.

## Exporting
When you are done editing, go to file then export package to export it as a .bee_pack. 


# Acknowledgements

## MareTF
For enabling VTF conversion (MIT License - Copyright (c) 2025 Laura Lewis)

## VMF2OBJ
BeePEE's VMF to OBJ conversion is a JavaScript port of VMF2OBJ (MIT License - Copyright (c) 2020 Dylancyclone)

## Crowbar
For decompiling prop models during VMF to OBJ conversion. BeePEE bundles the unmodified [Crowbar Command Line](https://github.com/UltraTechX/Crowbar-Command-Line) by ZeqMacaw, modified by Fay (UltraTechX), under the [Creative Commons Attribution-ShareAlike 3.0 Unported License](http://creativecommons.org/licenses/by-sa/3.0/) (see `backend/libs/crowbar/LICENSE.txt`)

## STUDIOMDL (Source SDK)
For enabling OBJ to MDL model compilation (Valve Corporation)