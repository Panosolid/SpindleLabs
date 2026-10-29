// @fission/ui: shared UI pieces and the theme (theme.css).
export { formatQuantity } from "./format.ts";
export { showPlaceholder, type PlaceholderInfo } from "./placeholder.ts";
export { downstreamChip, type ChipInfo, type ChipState } from "./downstream-chip.ts";
export { changeNote, type ChangeNoteInfo, type NoteState } from "./change-note.ts";
export { linkBadge, type LinkBadgeState } from "./link-badge.ts";
export { workspaceSwitcher, type SwitcherEntry } from "./switcher.ts";
export { SPLIT_MIN_WIDTH_PX, defaultSplit, splitChoices, type SplitEntry } from "./split.ts";
export { WarmPool, type WarmHooks } from "./warm.ts";
export { shortcutList, type ShortcutGroup } from "./shortcut-list.ts";
export { menuButton, menuPlace, MENU_GAP, type MenuButton, type MenuItem, type MenuSection } from "./menu-button.ts";
export { ICONS, ICON_NAMES, iconSvg, withIcon, type IconName, type IconPart } from "./icons.ts";
export { toolGroup, TOOL_ICON_SIZE, type ToolGroup, type ToolGroupOptions } from "./tool-group.ts";
export { fileMenu, fileSections, noExport, noNew, EXPORT_STL_ID, NEW_ID, type FileMenuEntry, type FileMenuParts } from "./file-menu.ts";
export { openElsewhere, openElsewhereWords, type OpenElsewhere } from "./open-elsewhere.ts";
export { askName, PROJECT_KIND, STL_KIND, baseNameOf, fileNameFor, pickerOf, saveFile, type FileHandle, type SaveKind, type SaveRequest, type SaveResult } from "./save-file.ts";
export { adoptSkeleton, holdSkeleton, leaveAfter, skeleton, whileLoading, SKELETON_DELAY_MS, SKELETON_FADE_MS, type HeldSkeleton, type SkeletonShape } from "./skeleton.ts";
