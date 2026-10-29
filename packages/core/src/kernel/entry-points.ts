// The kernel build's entry points under the app's names. The shipped build
// calls each by a meaningless label (copy protection, 2026-10-29: the glue
// and .wasm don't say what a call does), so this table is the one place
// the app maps them; the type check fails on a label the build doesn't
// export. The labels are fixed: a new kernel entry point brings a new one.
import * as k from "./wasm/fission_kernel.js";

export const entry = {
  begin: k.at4a9p,
  kernel_version: k.qmdw4c,
  kernel_build: k.eds3ko,
  make_box: k.uxyfpl,
  make_sphere: k.nwekzr,
  make_cylinder: k.xqg0dt,
  make_extrude: k.ld2gsx,
  snap_to_grid: k.u3qr1f,
  place_freely: k.irk2fy,
  sketch_outline: k.jg9yot,
  export_stl: k.f5l94l,
  body_build: k.guf4qz,
  body_view: k.p6rou1,
  body_stl: k.jgu9kn,
  body_step: k.pprlx7,
  body_free: k.vicdld,
  body_count: k.urxw0w,
  slice_stl: k.uq4cun,
};
