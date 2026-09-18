#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
VRM 模型减面优化工具（VRM 0.x）
================================

用途
----
把制作级高模 VRM（几十万~上百万三角面）压到可实时渲染的面数，解决数字人视口卡顿。

核心难点
--------
通用的网格简化工具（如 meshoptimizer 的 `gltfpack`）不认识 VRM 扩展，会在处理时把
`extensions.VRM` 整个丢弃，导致骨架/表情/弹簧骨骼全部失效——模型就只剩一坨几何。

本工具的解法
------------
gltfpack 在简化时**保持了骨骼节点的相对顺序**，只是在节点数组里调整了位置（通常是插入
若干网格节点）。因此可以：

  1. 用 `skin.joints` 逐项交叉验证，推算出一个**恒定的索引偏移量**；
  2. 把原 VRM 扩展中所有「引用骨骼节点」的字段按该偏移平移后原样搬回；
  3. 网格索引(mesh)、贴图索引、枚举值一律保持不变。

用法
----
    # 1. 先确认 gltfpack 可用（需要 Node.js）：
    #      npx gltfpack -h
    # 2. 跑优化：
    python scripts/optimize_vrm.py 输入.vrm -o 输出.vrm -si 0.15 -se 0.005

参数
----
    -o,  --output     输出路径（默认 <输入名>_optimized.vrm）
    -si, --ratio      gltfpack 的 -si，目标三角面比例 (0~1)。越小越激进，默认 0.15
    -se, --error      gltfpack 的 -se，形状误差上限 (0~1)。它会让简化自适应：大网格砍得
                      多、小网格（眼睛等）被保护。默认 0.005
    -t,  --tmpdir     中间文件目录（默认系统临时目录）
    --keep-tmp        保留中间产物，便于排查

注意
----
* 仅支持 VRM 0.x（`extensions.VRM`）。VRM 1.0 的扩展结构不同，需另行适配。
* gltfpack 的 `-si 1` 表示「不简化」，此时 `-se` 不再起作用；要真正减面，`-si` 必须 < 1。
* **gltfpack 会回收"仅被 VRM 扩展引用"的贴图**（如 `_SphereAdd`、`_OutlineWidthTexture`），
  因为它只看得懂 glTF 标准材质的纹理引用。这会让 `textures` 数组变短、VRM 里的旧索引越界，
  典型症状是加载时抛 `Cannot read properties of undefined (reading 'extensions')`。
  本脚本会把这类纹理补回数组末尾并重映射索引。
* **必须传 `-kv`**。gltfpack 默认按"材质用不用得上"裁剪顶点属性，而 MToon 的法线贴图记在
  VRM 扩展里，它看不懂，于是把 `NORMAL` 整列删掉——材质却还挂着 `normalTexture`，
  渲染时法线取 (0,0,0)，模型**整个变黑**。`TEXCOORD_1` 也会被同样处理。
* **必须传 `-noq`（禁用量化）**。量化会把 UV 压进 `[0, 1/15]` 这样的窄区间，再在材质上写
  `KHR_texture_transform` 补偿；但 three-vrm 给 VRM 0.x 绑 MToon 贴图时不读这个补偿
  （所有 `*UvTransform` 保持单位矩阵），于是所有贴图都去采样纹理左上角的极小区域，
  **同样是整个模型变黑**。量化同时也把顶点属性变成整数并给节点加 scale，弊大于利：
  本工具的目标是减少三角面（GPU 顶点处理量），保留浮点属性即可。
* **务必先备份原模型**，并在浏览器里确认外观与表情正常后再替换。静态自检通过不等于能加载。
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


# --------------------------------------------------------------------------- GLB I/O
def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} 不是 GLB/VRM 文件")
    off, gl, bin_chunk = 12, None, b""
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        body = data[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            gl = json.loads(body.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            bin_chunk = body
        off += 8 + clen
    if gl is None:
        raise ValueError(f"{path} 缺少 JSON chunk")
    return gl, bin_chunk


def write_glb(path, gl, bin_chunk):
    jb = json.dumps(gl, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    chunks = struct.pack("<I", len(jb)) + b"JSON" + jb
    if bin_chunk:
        bb = bin_chunk + b"\x00" * ((4 - len(bin_chunk) % 4) % 4)
        chunks += struct.pack("<I", len(bb)) + b"BIN\x00" + bb
    with open(path, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks)


def mesh_stats(gl):
    v = sum(gl["accessors"][p["attributes"]["POSITION"]]["count"]
            for m in gl.get("meshes", []) for p in m["primitives"])
    t = sum(gl["accessors"][p["indices"]]["count"] // 3
            for m in gl.get("meshes", []) for p in m["primitives"] if "indices" in p)
    return v, t


def attribute_coverage(gl):
    """统计每种顶点属性覆盖了多少个 primitive（用于检查 gltfpack 有没有丢属性）"""
    counts, prims = {}, 0
    for m in gl.get("meshes", []):
        for p in m.get("primitives", []):
            prims += 1
            for k in p.get("attributes", {}):
                counts[k] = counts.get(k, 0) + 1
    return counts, prims


# 只有这些属性的编码会改变外观。JOINTS_0 / WEIGHTS_0 被编成字节或归一化字节是 glTF 核心
# 允许的正常优化，不参与判断，否则会产生误报。
APPEARANCE_ATTRS = ("POSITION", "NORMAL", "TANGENT", "TEXCOORD_0", "TEXCOORD_1",
                    "TEXCOORD_2", "COLOR_0")


def attribute_encoding(gl):
    """统计每种外观属性出现的 (componentType, normalized) 组合。

    量化会把 float 属性变成整数并调整 normalized，同时改写 UV 数值范围——这正是
    "模型全黑"的第二种成因（three-vrm 不读量化附带的 KHR_texture_transform 补偿）。
    对比前后该组合即可发现是否发生了量化。
    """
    enc = {}
    for m in gl.get("meshes", []):
        for p in m.get("primitives", []):
            for k, ai in p.get("attributes", {}).items():
                if k not in APPEARANCE_ATTRS:
                    continue
                a = gl["accessors"][ai]
                enc.setdefault(k, set()).add((a["componentType"], bool(a.get("normalized"))))
    return {k: sorted(v) for k, v in enc.items()}


# --------------------------------------------------------------------------- gltfpack
def run_gltfpack(src, dst, ratio, error):
    """调用 gltfpack（经 npx）。gltfpack 按扩展名判断格式，故输入需为 .glb。"""
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("未找到 npx，请先安装 Node.js（https://nodejs.org）")

    cmd = [npx, "--yes", "gltfpack",
           "-i", src, "-o", dst,
           "-si", str(ratio), "-se", str(error),
           "-kn",   # 保留命名节点：VRM 骨架依赖它
           "-km",   # 保留命名材质，禁止合并（VRM 材质按名字匹配）
           "-ke",   # 保留 extras
           "-kv",   # 保留"看似没被使用"的顶点属性：MToon 的 NORMAL / TEXCOORD_1 全靠它
           "-noq"]  # 禁用量化：量化会改写 UV 并靠 KHR_texture_transform 补偿，而 three-vrm 不读
    print(f"[gltfpack] {' '.join(cmd[2:])}")
    r = subprocess.run(cmd, capture_output=True, text=True, shell=False)
    if r.returncode != 0 or not os.path.exists(dst):
        raise RuntimeError(f"gltfpack 失败 (exit {r.returncode}):\n{r.stdout}\n{r.stderr}")


# --------------------------------------------------------------------------- 核心：搬回 VRM 扩展
def remap_texture_indices(src_gl, sim_gl, vrm):
    """修复 VRM 扩展中的纹理索引。

    gltfpack 只看得懂 glTF 标准材质对纹理的引用。像 `_SphereAdd`、`_OutlineWidthTexture`
    这类**仅被 VRM 扩展引用**的贴图，在它眼里属于"无人使用"，会被直接回收，
    使 `textures` 数组变短（例如 12 → 10），而 VRM 里记录的仍是原索引，
    结果 three-vrm 取到越界索引并抛 "Cannot read properties of undefined (reading 'extensions')"。

    处理办法：以 (source, sampler) 为键在原/新纹理间建立对应；对已被回收、
    但 VRM 仍在引用的纹理，**把定义补回数组末尾**，从而保持索引语义正确。
    """
    src_tex = src_gl.get("textures", [])
    sim_tex = sim_gl.setdefault("textures", [])

    def key(t):
        return (t.get("source"), t.get("sampler"))

    new_by_key = {}
    for j, t in enumerate(sim_tex):
        new_by_key.setdefault(key(t), j)

    mapping = {}
    restore = []          # 需要补回的纹理定义
    for i, t in enumerate(src_tex):
        k = key(t)
        if k in new_by_key:
            mapping[i] = new_by_key[k]
        else:
            restore.append((i, t))

    for i, t in restore:
        sim_tex.append(json.loads(json.dumps(t)))
        mapping[i] = len(sim_tex) - 1

    total = moved = 0
    for prop in vrm.get("materialProperties") or []:
        tp = prop.get("textureProperties") or {}
        for k, val in list(tp.items()):
            if not isinstance(val, int):
                continue
            total += 1
            if val not in mapping:
                raise ValueError(
                    f"纹理索引 {val}（材质 {prop.get('name')!r} 的 {k}）无法定位到任何纹理")
            if mapping[val] != val:
                moved += 1
            tp[k] = mapping[val]

    return {"total": total, "moved": moved, "restored": len(restore), "texCount": len(sim_tex)}


def validate_texture_refs(gl):
    """校验 glTF 材质引用的纹理索引均有效"""
    n = len(gl.get("textures", []))
    bad = []
    for i, m in enumerate(gl.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness") or {}
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            ref = pbr.get(key)
            if ref and ref.get("index", 0) >= n:
                bad.append((i, m.get("name"), key, ref.get("index")))
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            ref = m.get(key)
            if ref and ref.get("index", 0) >= n:
                bad.append((i, m.get("name"), key, ref.get("index")))
    return bad


def port_vrm_extension(src_gl, sim_gl):
    """把原模型的 VRM 扩展平移后挂到简化模型上，返回 (vrm_ext, offset, report)"""
    if "VRM" not in (src_gl.get("extensions") or {}):
        raise ValueError("源文件没有 extensions.VRM（可能是 VRM 1.0，本工具暂不支持）")

    src_skins = src_gl.get("skins") or []
    sim_skins = sim_gl.get("skins") or []
    if not src_skins or not sim_skins:
        raise ValueError("模型缺少 skin 数据，无法安全推算索引偏移")

    src_joints = src_skins[0]["joints"]
    sim_joints = sim_skins[0]["joints"]
    if len(src_joints) != len(sim_joints):
        raise ValueError(f"joints 数量不一致（原 {len(src_joints)} / 新 {len(sim_joints)}），"
                         "gltfpack 可能重排了骨架，无法安全映射")

    deltas = {y - x for x, y in zip(src_joints, sim_joints)}
    if len(deltas) != 1:
        raise ValueError(f"骨骼索引偏移不恒定（{sorted(deltas)[:8]}…），无法安全映射")
    off = deltas.pop()

    vrm = json.loads(json.dumps(src_gl["extensions"]["VRM"]))
    report = {"offset": off, "humanBones": 0, "firstPersonBone": 0,
              "springBones": 0, "boneGroupCenter": 0, "colliderGroups": 0}

    # --- 仅平移「引用骨骼节点」的字段，显式白名单，避免误伤贴图/mesh/枚举索引 ---
    hb = vrm.get("humanoid", {}).get("humanBones")
    entries = hb if isinstance(hb, list) else (hb or {}).values() if isinstance(hb, dict) else []
    for e in entries:
        if isinstance(e, dict) and isinstance(e.get("node"), int):
            e["node"] += off
            report["humanBones"] += 1

    fp = vrm.get("firstPerson") or {}
    if isinstance(fp.get("firstPersonBone"), int):
        fp["firstPersonBone"] += off
        report["firstPersonBone"] += 1
    # fp["meshAnnotations"][*]["mesh"] 是网格索引 -> 不动

    sa = vrm.get("secondaryAnimation") or {}
    for g in sa.get("boneGroups") or []:
        g["bones"] = [b + off if isinstance(b, int) else b for b in (g.get("bones") or [])]
        report["springBones"] += len(g["bones"])
        if isinstance(g.get("center"), int):
            g["center"] += off
            report["boneGroupCenter"] += 1
        # g["colliderGroups"] 是碰撞体组的序号 -> 不动
    for cg in sa.get("colliderGroups") or []:
        if isinstance(cg.get("node"), int):
            cg["node"] += off
            report["colliderGroups"] += 1

    # gltfpack 会回收"仅被 VRM 扩展引用"的纹理，需要重映射并把缺失的补回来
    tex = remap_texture_indices(src_gl, sim_gl, vrm)
    report["textures"] = tex["total"]
    report["texturesMoved"] = tex["moved"]
    report["texturesRestored"] = tex["restored"]

    return vrm, off, report


def selfcheck(src_gl, out_gl, off):
    """逐骨骼比对原节点[i] 与新节点[i+off] 的 translation，验证映射正确性"""
    a, b = src_gl["nodes"], out_gl["nodes"]
    vrm = out_gl["extensions"]["VRM"]
    hb = vrm["humanoid"]["humanBones"]
    entries = hb if isinstance(hb, list) else list(hb.values())
    ok = bad = 0
    fails = []
    for e in entries:
        ni = e.get("node")
        if not isinstance(ni, int):
            continue
        oi = ni - off
        if oi < 0 or ni >= len(b) or oi >= len(a):
            bad += 1
            continue
        ta = a[oi].get("translation")
        tb = b[ni].get("translation")
        if ta is None and tb is None:
            ok += 1
        elif ta is not None and tb is not None and max(abs(x - y) for x, y in zip(ta, tb)) < 1e-3:
            ok += 1
        else:
            bad += 1
            fails.append((e.get("bone"), oi, ni))
    return ok, bad, fails


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="VRM 0.x 减面优化（gltfpack + VRM 扩展回植）")
    ap.add_argument("input", help="输入 .vrm/.glb")
    ap.add_argument("-o", "--output", help="输出 .vrm（默认 <输入>_optimized.vrm）")
    ap.add_argument("-si", "--ratio", type=float, default=0.15, help="目标三角面比例，默认 0.15")
    ap.add_argument("-se", "--error", type=float, default=0.005, help="形状误差上限，默认 0.005")
    ap.add_argument("-t", "--tmpdir", help="中间文件目录")
    ap.add_argument("--keep-tmp", action="store_true", help="保留中间文件")
    args = ap.parse_args()

    src_path = os.path.abspath(args.input)
    if not os.path.exists(src_path):
        sys.exit(f"输入不存在: {src_path}")
    out_path = os.path.abspath(args.output or
                               os.path.splitext(src_path)[0] + "_optimized.vrm")

    tmp = args.tmpdir or tempfile.mkdtemp(prefix="vrmopt_")
    os.makedirs(tmp, exist_ok=True)
    src_glb = os.path.join(tmp, "src.glb")      # gltfpack 只认 .glb/.gltf/.obj
    sim_glb = os.path.join(tmp, "simplified.glb")

    print("=" * 66)
    print(f"输入: {src_path}  ({os.path.getsize(src_path)/1024/1024:.2f} MB)")
    print(f"输出: {out_path}")
    print(f"参数: -si {args.ratio}  -se {args.error}")
    print("=" * 66)

    shutil.copyfile(src_path, src_glb)

    src_gl, _ = load_glb(src_glb)
    v0, t0 = mesh_stats(src_gl)
    print(f"[原始] 顶点 {v0:,}  三角面 {t0:,}")

    run_gltfpack(src_glb, sim_glb, args.ratio, args.error)

    sim_gl, sim_bin = load_glb(sim_glb)
    v1, t1 = mesh_stats(sim_gl)
    print(f"[简化] 顶点 {v1:,}  三角面 {t1:,}  ({t1/t0*100:.1f}%)")

    vrm, off, report = port_vrm_extension(src_gl, sim_gl)
    print(f"[回植] 骨骼索引偏移 +{off}")
    print(f"        humanBones={report['humanBones']}  firstPersonBone={report['firstPersonBone']}  "
          f"springBones={report['springBones']}  center={report['boneGroupCenter']}  "
          f"colliderGroups={report['colliderGroups']}")
    print(f"        纹理引用 {report['textures']} 处；补回被 gltfpack 回收的纹理 "
          f"{report['texturesRestored']} 个，重映射 {report['texturesMoved']} 处")

    sim_gl.setdefault("extensions", {})["VRM"] = vrm
    used = sim_gl.setdefault("extensionsUsed", [])
    if "VRM" not in used:
        used.insert(0, "VRM")
    write_glb(out_path, sim_gl, sim_bin)

    out_gl, _ = load_glb(out_path)
    ok, bad, fails = selfcheck(src_gl, out_gl, off)
    print(f"[自检] 骨骼映射一致 {ok}/{ok + bad}")
    for f in fails[:6]:
        print(f"       [X] {f}")

    # 顶点属性覆盖对比：NORMAL 一旦被丢，模型会在渲染时全黑
    src_attrs, n_prim = attribute_coverage(src_gl)
    out_attrs, _ = attribute_coverage(out_gl)
    lost = {k: v for k, v in src_attrs.items() if out_attrs.get(k, 0) < v}
    if lost:
        print("[校验] !! 顶点属性丢失（原始->输出）："
              + "  ".join(f"{k} {v}->{out_attrs.get(k, 0)}" for k, v in sorted(lost.items())))
        bad += 1
    else:
        print(f"[校验] 顶点属性完整（{n_prim} primitives）："
              + "  ".join(f"{k}={out_attrs.get(k, 0)}" for k in sorted(src_attrs)))

    # 属性编码对比：一旦发生量化，UV 会被压缩并依赖 KHR_texture_transform，three-vrm 不读该补偿
    src_enc = attribute_encoding(src_gl)
    out_enc = attribute_encoding(out_gl)
    changed = {k: (src_enc[k], out_enc.get(k)) for k in src_enc if out_enc.get(k) != src_enc[k]}
    gained_quant = "KHR_mesh_quantization" in (out_gl.get("extensionsUsed") or [])
    if changed or gained_quant:
        print(f"[校验] !! 顶点属性编码被改动（说明发生了量化，UV 会错位）：{changed}"
              f"  KHR_mesh_quantization={gained_quant}")
        bad += 1
    else:
        print("[校验] 顶点属性编码未改变（未发生量化，UV 保持原值）")

    groups = (out_gl["extensions"]["VRM"].get("blendShapeMaster") or {}).get("blendShapeGroups") or []
    n_tex = len(out_gl.get("textures", []))
    print(f"[校验] 弹簧骨骼 {report['springBones']} 根   表情组 {len(groups)} 个   "
          f"贴图 {len(out_gl.get('images', []))} 张 / 纹理 {n_tex} 个")

    # 纹理索引校验：越界会让 three-vrm 在加载时抛 "reading 'extensions'"
    tex_bad = validate_texture_refs(out_gl)
    vrm_tex_bad = []
    for prop in out_gl["extensions"]["VRM"].get("materialProperties") or []:
        for k, v in (prop.get("textureProperties") or {}).items():
            if isinstance(v, int) and not (0 <= v < n_tex):
                vrm_tex_bad.append((prop.get("name"), k, v))
    if tex_bad or vrm_tex_bad:
        print(f"[校验] !! 纹理索引越界：glTF 材质 {tex_bad[:3]}  VRM 扩展 {vrm_tex_bad[:3]}")
        bad += 1
    else:
        print("[校验] 纹理索引全部有效")

    print(f"[输出] {out_path}  ({os.path.getsize(out_path)/1024/1024:.2f} MB)")

    if not args.keep_tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        print(f"[中间文件] {tmp}")

    if bad:
        print("\n!! 自检未全部通过，请勿直接替换原模型 !!")
        sys.exit(1)
    print("\n完成。请在浏览器中确认外观/表情/头发摆动正常后，再替换原模型。")


if __name__ == "__main__":
    main()
