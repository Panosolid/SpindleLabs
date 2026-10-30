
export function at4a9p(p0: string): boolean;

export function eds3ko(): string;

export function f5l94l(p0: any, p1: string): any;

export function guf4qz(p0: any): number;

export function irk2fy(p0: number, p1: number, p2: number): any;

export function jg9yot(p0: any, p1: any, p2: any): any;

export function jgu9kn(p0: number, p1: string): any;

export function ld2gsx(p0: any, p1: number): any;

export function nwekzr(p0: number): any;

export function p6rou1(p0: number): any;

export function pprlx7(p0: number): any;

export function qmdw4c(): string;

export function u3qr1f(p0: number, p1: number, p2: number): any;

export function uq4cun(p0: Uint8Array, p1: number, p2: number, p3: number, p4: boolean | null): any;

export function urxw0w(): number;

export function uxyfpl(p0: number, p1: number, p2: number): any;

export function vicdld(p0: number): void;

export function xqg0dt(p0: number, p1: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly at4a9p: (a: number, b: number) => number;
    readonly eds3ko: () => [number, number];
    readonly f5l94l: (a: any, b: number, c: number) => [number, number, number];
    readonly guf4qz: (a: any) => [number, number, number];
    readonly irk2fy: (a: number, b: number, c: number) => [number, number, number];
    readonly jg9yot: (a: any, b: any, c: any) => [number, number, number];
    readonly jgu9kn: (a: number, b: number, c: number) => [number, number, number];
    readonly ld2gsx: (a: any, b: number) => [number, number, number];
    readonly nwekzr: (a: number) => [number, number, number];
    readonly p6rou1: (a: number) => [number, number, number];
    readonly pprlx7: (a: number) => [number, number, number];
    readonly qmdw4c: () => [number, number];
    readonly u3qr1f: (a: number, b: number, c: number) => [number, number, number];
    readonly uq4cun: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly urxw0w: () => number;
    readonly uxyfpl: (a: number, b: number, c: number) => [number, number, number];
    readonly vicdld: (a: number) => [number, number];
    readonly xqg0dt: (a: number, b: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
