#!/usr/bin/env bash
#
# Rebuild a headless Blender (bpy) environment from scratch.
#
# Why this exists: `pip install bpy` gives you a Blender that will not
# import on a slim container, because its GHOST windowing layer is linked
# against eight X11/GL shared libraries that are not present - even though
# Blender never actually enters GHOST in background mode. On a box with
# root you would apt-get them. Here there is no root and no reachable
# Debian mirror, so instead we synthesise stub libraries that satisfy the
# dynamic loader and nothing else.
#
# That is safe *specifically because* nothing ever calls into them. If you
# ever run Blender with a UI, throw these away and install the real ones.
#
#   bash tools/setup_blender.sh
#   LD_LIBRARY_PATH=$HOME/.local/blenderstubs ~/.venv/bin/python tools/render_snapshots.py in out
#
set -euo pipefail

VENV="${VENV:-$HOME/.venv}"
STUBS="${STUBS:-$HOME/.local/blenderstubs}"
BPY_VERSION="${BPY_VERSION:-4.2.0}"

command -v gcc >/dev/null || { echo "need gcc to build the stubs"; exit 1; }

echo "==> python venv at $VENV"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
echo "==> installing bpy==$BPY_VERSION (this is a ~500 MB wheel)"
"$VENV/bin/pip" install -q "bpy==$BPY_VERSION" numpy

PYV=$("$VENV/bin/python" -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
BPYDIR="$VENV/lib/$PYV/site-packages/bpy"
[ -d "$BPYDIR" ] || { echo "cannot find bpy at $BPYDIR"; exit 1; }

mkdir -p "$STUBS"
cd "$STUBS"

# ---------------------------------------------------------------------
# 1. Which sonames does bpy want that the system does not have?
# ---------------------------------------------------------------------
echo "==> finding unsatisfied shared libraries"
MISSING=$(ldd "$BPYDIR"/*.so 2>/dev/null | awk '/not found/ {print $1}' | sort -u)
if [ -z "$MISSING" ]; then
  echo "    nothing missing - trying the import anyway"
else
  echo "$MISSING" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------
# 2. Which symbols are genuinely unresolved?
#
# Take every undefined symbol across bpy's own objects, subtract
# everything that IS defined somewhere in the resolvable closure, and
# subtract the CPython API (the interpreter provides that).
# ---------------------------------------------------------------------
echo "==> computing the unresolved symbol set"
SOFILES=$(ls "$BPYDIR"/*.so "$BPYDIR"/lib/*.so* 2>/dev/null || true)
nm -D --undefined-only $SOFILES 2>/dev/null | awk '{print $NF}' | sort -u > /tmp/_undef.txt
nm -D --defined-only $SOFILES 2>/dev/null | awk '{print $NF}' | sort -u > /tmp/_def.txt
comm -23 /tmp/_undef.txt /tmp/_def.txt | grep -Ev '^(_?Py|_ITM_|__gmon|_Jv_)' > /tmp/_need.txt || true
echo "    $(wc -l < /tmp/_need.txt) unresolved symbols"

# Bucket them by prefix onto the library that owns them. Anything that
# does not match stays unresolved, which is fine - it will be a dlopen-only
# CUDA/HIP/LevelZero entry point that Blender probes for at runtime.
bucket() {  # $1 = soname, $2.. = egrep patterns
  local soname="$1"; shift
  local pat; pat=$(printf '%s|' "$@"); pat="${pat%|}"
  grep -E "^($pat)" /tmp/_need.txt || true
}

declare -A LIBS=(
  [libXrender.so.1]='XRender|Xrender'
  [libXxf86vm.so.1]='XF86VidMode'
  [libXfixes.so.3]='XFixes'
  [libXi.so.6]='XOpenDevice|XCloseDevice|XFreeDevice|XListInputDevices|XQueryDeviceState|XSelectExtensionEvent|XGetExtensionVersion|_XiGet|XiSelect'
  [libxkbcommon.so.0]='xkb_'
  [libSM.so.6]='Smc|SM'
  [libICE.so.6]='Ice|ICE'
  [libGL.so.1]='glX|gl[A-Z]'
)

for soname in "${!LIBS[@]}"; do
  syms=$(bucket "$soname" "${LIBS[$soname]}")
  base="${soname%%.so*}"
  src="$base.c"
  {
    echo "/* generated stub for $soname - satisfies the loader, does nothing */"
    if [ -z "$syms" ]; then
      echo "void ${base}_stub_placeholder(void) {}"
    else
      while read -r s; do [ -n "$s" ] && echo "void $s(void) {}"; done <<< "$syms"
    fi
  } > "$src"

  # libxkbcommon is referenced with an explicit symbol version. Without a
  # matching .gnu.version_d the loader aborts with
  #   Inconsistency detected by ld.so: dl-lookup.c: check_match
  extra=()
  if [ "$soname" = "libxkbcommon.so.0" ]; then
    printf 'V_0.5.0 { global: xkb_*; local: *; };\n' > xkb.map
    extra=(-Wl,--version-script=xkb.map)
  fi

  gcc -shared -fPIC -o "$soname" "$src" -Wl,-soname,"$soname" "${extra[@]}"
  echo "    built $soname ($(grep -c '^void' "$src") symbols)"
done

# ---------------------------------------------------------------------
# 3. Prove it
# ---------------------------------------------------------------------
echo "==> verifying"
if LD_LIBRARY_PATH="$STUBS" "$VENV/bin/python" -c \
    'import bpy; print("BPY OK", bpy.app.version_string)'; then
  cat <<EOF

Done. Every bpy invocation must carry the stub path:

  LD_LIBRARY_PATH=$STUBS $VENV/bin/python tools/blend_inspect.py <file.blend>
  LD_LIBRARY_PATH=$STUBS $VENV/bin/python tools/render_snapshots.py <objdir> <imgdir>

Note: BLENDER_WORKBENCH needs a real GL context, which these stubs cannot
provide. Render with CYCLES and cycles.device = 'CPU'.
EOF
else
  echo "import still failing - check 'ldd $BPYDIR/*.so' for remaining gaps"
  exit 1
fi
