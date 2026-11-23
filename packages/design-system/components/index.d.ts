// Plaintask components: each returns an HTML string; behaviours act on the elements those strings made.
export type IconName = 'inbox' | 'today' | 'upcoming' | 'anytime' | 'someday' | 'completed' | 'plus' | 'folder' | 'chevron' | 'back' | 'repeat' | 'close' | 'search' | 'tick' | 'arrow-back' | 'trash' | 'restore';
export type Platform = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

export interface ButtonProps { label: string; variant?: 'primary' | 'ghost' | 'danger'; icon?: IconName; iconOnly?: boolean; kbd?: string; type?: 'button' | 'submit' }
export declare function Button(props: ButtonProps): string;
export interface FabProps { label?: string; expanded?: boolean }
export declare function Fab(props: FabProps): string;
export interface CheckboxProps { label: string; checked?: boolean }
export declare function Checkbox(props: CheckboxProps): string;
/** Dates arrive as display text: when "Today", due "Due Fri". */
export interface Task { id: string; title: string; project?: string; tags?: string[]; repeat?: string; when?: string; due?: string; dueSoon?: boolean; done?: boolean; doneLabel?: string; trashed?: boolean }
export interface TaskRowProps { showProject?: boolean; showWhen?: boolean; trashButton?: boolean }
export declare function TaskRow(task: Task, opts?: TaskRowProps): string;
export declare function Tag(text: string): string;
export declare function Badge(count: number, key?: string): string;
export interface GroupHeaderProps { label: string; note?: string }
export declare function GroupHeader(props: GroupHeaderProps): string;
export interface EmptyStateProps { title: string; body: string }
export declare function EmptyState(props: EmptyStateProps): string;
export interface NavItem { id: string; label: string; icon?: IconName; count?: number; current?: boolean }
export interface SidebarProps { items: NavItem[]; sections?: { label: string; items: NavItem[] }[] }
export declare function Sidebar(props: SidebarProps): string;
export interface TabBarProps { tabs: { id: string; label: string; icon: IconName; current?: boolean }[] }
export declare function TabBar(props: TabBarProps): string;
export interface ViewHeaderProps { title: string; subtitle?: string; large?: boolean; back?: string; action?: ButtonProps }
export declare function ViewHeader(props: ViewHeaderProps): string;
export interface FieldProps { id: string; name: string; label: string; placeholder?: string; value?: string; invalid?: boolean; options?: [string, string, boolean?][] }
export declare function Field(props: FieldProps): string;
export interface ComposerProps { idPrefix?: string; card?: boolean; stacked?: boolean; title?: string; error?: string; projects?: [string, string, boolean?][]; whens?: [string, string, boolean?][] }
export declare function Composer(props?: ComposerProps): string;
export interface SheetProps { title: string; body: string }
export declare function Sheet(props: SheetProps): string;
export interface ToastProps { message: string; action?: string }
export declare function Toast(props: ToastProps): string;

export declare function icon(name: IconName, className?: string): string;
export declare function complete(row: HTMLElement, onCommit?: () => void): void;
/** Folds a row out at once (no tick); pair with a "Moved to Trash" toast and Undo. */
export declare function trash(row: HTMLElement, onCommit?: () => void): void;
export declare function enter(row: HTMLElement): void;
export declare function bump(badge: HTMLElement): void;
export declare function moveIndicator(nav: HTMLElement): void;
export declare function openSheet(host: HTMLElement): void;
export declare function closeSheet(host: HTMLElement): void;
/** onAction runs at most once per toast, however often its button is clicked. */
export declare function toast(host: HTMLElement, message: string, action?: string, onAction?: () => void): HTMLElement;
export declare function shake(el: HTMLElement): void;
/** A guess from the user agent; apps should set data-platform on .pt-root themselves. */
export declare function platform(): Platform;
/** "\u2318K" on macOS and iOS, "Ctrl+K" on Windows, Linux and Android. */
export declare function shortcut(key: string, on?: Platform): string;

declare global { interface Window { Plaintask: typeof import('./index') } }
