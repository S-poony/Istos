# Desktop shell

This project is like improves on the desktop concept, as in folders that have special rendering attirbutes.
It treats folders and files as an Entity Component System.
For example, a desktop is a folder (the basic entity of the system) that has an image and a grid component.
All components can combine, for example you could use the timeline component with the grid and render components to arrange sound files through time and create music. 
There are plenty of examples for any media combinations (images in time are diaporamas, these can have music, subtitles, or image inscrustations...)

**Note**: In this system, all files are treated as folders that can be the parent of other entities, but all changes that can be translated into the os file architecture are (for example, moving image A that holds file B into folder C will move both image A and file B to folder C )

It uses SQLite and tauri to work on any operating system and on the web, using file metadata.
The app works by looking over a trove, similar to an obsidian vault.

There is an **edit mode** to edit your entity architecture, components from your entities, and settings from your components (component settings could be a checkbox to allow/disallow user to drag files in the grid for example ) and a **live mode** where you can navigate through the resulting website

Some components:
- renderFile (render a file (self by default, but allows to render other files too for entities that don't have content) )
- renderArchitecture (renders sub entities as connected nodes)
- grid (order sub entities through space)
- timeline (order sub entities through time)
- pin (entity stays visible even if you navigate below it, like headers/footers that stay in a website)

All rendering must be responsive and fast.
Knowing how to scale and position rendered elements is a challenge given the many possible combinations, knowing even more components will be added in the future. This needs to be solved. 

The goal is to allow users to make custom static websites directly from the files in their computer. Some people regularly work in the same folders needing access to the same specific files. I believe current file explorers are not adapted for repetitive work in the same few folders because the UI is general accross your whole coputer. It could me more adapted for specific folders, like an artist who needs to quickly check an image will want to see it rendered without clicking on it... Displaying elements in a custom way takes more time for the user, but allows better performance in the long run.
