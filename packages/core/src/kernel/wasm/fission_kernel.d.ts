
export function begin(key: string): boolean;

export function body_build(spec: any): number;

export function body_count(): number;

export function body_free(body: number): void;

export function body_step(body: number): any;

export function body_stl(body: number, name: string): any;

export function body_view(body: number): any;

export function export_stl(spec: any, name: string): any;

export function kernel_build(): string;

export function kernel_version(): string;

export function make_box(width: number, depth: number, height: number): any;

export function make_cylinder(radius: number, height: number): any;

export function make_extrude(profile: any, distance: number): any;

export function make_sphere(radius: number): any;

export function place_freely(x: number, y: number, pixel: number): any;

export function sketch_outline(lines: any, circles: any, arcs: any): any;

export function snap_to_grid(x: number, y: number, spacing: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly begin: (a: number, b: number) => number;
    readonly body_build: (a: any) => [number, number, number];
    readonly body_count: () => number;
    readonly body_free: (a: number) => [number, number];
    readonly body_step: (a: number) => [number, number, number];
    readonly body_stl: (a: number, b: number, c: number) => [number, number, number];
    readonly body_view: (a: number) => [number, number, number];
    readonly export_stl: (a: any, b: number, c: number) => [number, number, number];
    readonly kernel_build: () => [number, number];
    readonly kernel_version: () => [number, number];
    readonly make_box: (a: number, b: number, c: number) => [number, number, number];
    readonly make_cylinder: (a: number, b: number) => [number, number, number];
    readonly make_extrude: (a: any, b: number) => [number, number, number];
    readonly make_sphere: (a: number) => [number, number, number];
    readonly place_freely: (a: number, b: number, c: number) => [number, number, number];
    readonly sketch_outline: (a: any, b: any, c: any) => [number, number, number];
    readonly snap_to_grid: (a: number, b: number, c: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
