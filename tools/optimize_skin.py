"""Pipeline d'optimisation de skins GLB (hors-ligne, Python + Pillow + numpy).
 - supprime animations, morph targets, textures non-couleur, extensions
 - réduit les textures (max 1024 px, JPEG ou PNG si transparence)
 - ne garde que POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 / WEIGHTS_0
 - normalise : hauteur 1,8 m, pieds à y=0, centré en x/z (nœud racine ajouté)
"""
import json, struct, io, sys
import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
CTN = {np.dtype(v): k for k, v in CT.items()}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}

def load_glb(path):
    d = open(path, 'rb').read(); off = 12; j = None; b = None
    while off < len(d):
        cl, ct = struct.unpack('<II', d[off:off+8])
        if ct == 0x4E4F534A: j = json.loads(d[off+8:off+8+cl])
        elif ct == 0x004E4942: b = d[off+8:off+8+cl]
        off += 8 + cl
    return j, b

def read_accessor(j, b, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', n * dt.itemsize); cnt = a['count']
    if stride == n * dt.itemsize:
        return np.frombuffer(b, dtype=dt, count=cnt*n, offset=start).reshape(cnt, n).copy()
    out = np.zeros((cnt, n), dtype=dt)
    raw = np.frombuffer(b, dtype=np.uint8)
    for k in range(cnt):
        out[k] = np.frombuffer(raw[start+k*stride:start+k*stride+n*dt.itemsize].tobytes(), dtype=dt)
    return out

def node_local(n):
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0]), float); x, y, z, w = n.get('rotation', [0, 0, 0, 1]); s = np.array(n.get('scale', [1, 1, 1]), float)
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * s; M[:3, 3] = t; return M

def world_matrices(j):
    nodes = j['nodes']; W = [None] * len(nodes); parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    def get(i):
        if W[i] is None:
            W[i] = (get(parent[i]) if i in parent else np.eye(4)) @ node_local(nodes[i])
        return W[i]
    for i in range(len(nodes)): get(i)
    return W, parent

def rest_world_vertices(j, b):
    """Positions monde au repos de tous les sommets (LBS glTF)."""
    W, _ = world_matrices(j); out = []
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n: continue
        skin = j['skins'][n['skin']] if 'skin' in n else None
        for pr in j['meshes'][n['mesh']]['primitives']:
            P = read_accessor(j, b, pr['attributes']['POSITION']).astype(float)
            Ph = np.c_[P, np.ones(len(P))]
            if skin and 'JOINTS_0' in pr['attributes']:
                J = read_accessor(j, b, pr['attributes']['JOINTS_0']).astype(int)
                Wt = read_accessor(j, b, pr['attributes']['WEIGHTS_0']).astype(float)
                if Wt.max() > 1.5: Wt = Wt / np.iinfo(np.uint16 if Wt.max() > 255 else np.uint8).max
                ibm = read_accessor(j, b, skin['inverseBindMatrices']).astype(float).reshape(-1, 4, 4).transpose(0, 2, 1)
                mats = np.array([W[skin['joints'][k]] @ ibm[k] for k in range(len(skin['joints']))])
                acc = np.zeros((len(P), 3))
                for k in range(4):
                    jm = mats[J[:, k]]
                    acc += Wt[:, k:k+1] * np.einsum('nij,nj->ni', jm, Ph)[:, :3]
                out.append(acc)
            else:
                out.append((W[ni] @ Ph.T).T[:, :3])
    return np.concatenate(out)

def optimize(src, dst, max_tex=1024, alpha_tex=512, decimate=None):
    j, b = load_glb(src)
    j.pop('animations', None); j['extensionsUsed'] = []; j.pop('extensionsRequired', None); j.pop('extensions', None)
    j.pop('cameras', None)

    # ---- matériaux : couleur de base uniquement
    for m in j.get('materials', []):
        pbr = m.setdefault('pbrMetallicRoughness', {})
        for k in ('metallicRoughnessTexture',): pbr.pop(k, None)
        pbr['metallicFactor'] = 0.0; pbr['roughnessFactor'] = 0.85
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture', 'emissiveFactor', 'extensions'): m.pop(k, None)

    # ---- textures utilisées -> nouvelles images
    used_tex = []
    for m in j.get('materials', []):
        bt = m['pbrMetallicRoughness'].get('baseColorTexture')
        if bt is not None:
            if bt['index'] not in used_tex: used_tex.append(bt['index'])
    tex_map = {t: i for i, t in enumerate(used_tex)}
    for m in j.get('materials', []):
        bt = m['pbrMetallicRoughness'].get('baseColorTexture')
        if bt is not None:
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': tex_map[bt['index']], 'texCoord': 0}
    new_images = []; img_alpha = {}
    # alpha requis ?
    for mi, m in enumerate(j.get('materials', [])):
        bt = m['pbrMetallicRoughness'].get('baseColorTexture')
        if bt is not None and m.get('alphaMode', 'OPAQUE') != 'OPAQUE':
            ti = used_tex[bt['index']]; img_alpha[j['textures'][ti]['source']] = True
    new_textures = []; img_remap = {}
    for t in used_tex:
        tx = j['textures'][t]; src_i = tx['source']
        if src_i not in img_remap:
            img = j['images'][src_i]; bv = j['bufferViews'][img['bufferView']]
            raw = b[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
            im = Image.open(io.BytesIO(raw)); im.load()
            need_alpha = img_alpha.get(src_i, False)
            lim = alpha_tex if need_alpha else max_tex
            if max(im.size) > lim:
                r = lim / max(im.size); im = im.resize((max(1, int(im.size[0]*r)), max(1, int(im.size[1]*r))), Image.LANCZOS)
            buf = io.BytesIO()
            if need_alpha and im.mode in ('RGBA', 'LA', 'P'):
                im.convert('RGBA').save(buf, 'PNG', optimize=True); mime = 'image/png'
            else:
                im.convert('RGB').save(buf, 'JPEG', quality=82, optimize=True, progressive=True); mime = 'image/jpeg'
            img_remap[src_i] = len(new_images); new_images.append((buf.getvalue(), mime))
        nt = {'source': img_remap[src_i]}
        if 'sampler' in tx: nt['sampler'] = tx['sampler']
        new_textures.append(nt)

    # ---- géométrie : on ne garde que les attributs utiles, sans morph targets
    keep_attr = ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')
    acc_new = []; blob = bytearray(); bvs = []
    def add_view(data, target=None):
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: v['target'] = target
        bvs.append(v); return len(bvs) - 1
    cache = {}
    def add_acc(old_i, target=None, arr=None, ctype=None, typ=None, normalized=None):
        key = (old_i, target) if arr is None else None
        if key and key in cache: return cache[key]
        if arr is None:
            a = j['accessors'][old_i]; arr = read_accessor(j, b, old_i); ctype = a['componentType']; typ = a['type']; normalized = a.get('normalized')
        bi = add_view(np.ascontiguousarray(arr).tobytes(), target)
        na = {'bufferView': bi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if normalized: na['normalized'] = True
        if typ == 'VEC3' and ctype == 5126 and target == 34962 and arr.shape[1] == 3:
            na['min'] = arr.min(0).astype(float).tolist(); na['max'] = arr.max(0).astype(float).tolist()
        acc_new.append(na); idx = len(acc_new) - 1
        if key: cache[key] = idx
        return idx

    stats = {'tris_in': 0, 'tris_out': 0}
    for me in j['meshes']:
        me.pop('weights', None)
        for pr in me['primitives']:
            pr.pop('targets', None); pr.pop('extras', None)
            at = pr['attributes']
            if decimate and 'JOINTS_0' not in at:
                P = read_accessor(j, b, at['POSITION']).astype(np.float64)
                N = read_accessor(j, b, at['NORMAL']).astype(np.float64) if 'NORMAL' in at else None
                UV = read_accessor(j, b, at['TEXCOORD_0']).astype(np.float64)
                I = read_accessor(j, b, pr['indices']).astype(np.int64).reshape(-1, 3)
                stats['tris_in'] += len(I)
                cell, uvcell = decimate
                key = np.c_[np.floor(P / cell), np.floor(UV / uvcell)].astype(np.int64)
                uniq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
                cnt = np.bincount(inv, minlength=len(uniq)).astype(float)
                P2 = np.zeros((len(uniq), 3)); UV2 = np.zeros((len(uniq), 2))
                for k in range(3): P2[:, k] = np.bincount(inv, weights=P[:, k], minlength=len(uniq)) / cnt
                for k in range(2): UV2[:, k] = np.bincount(inv, weights=UV[:, k], minlength=len(uniq)) / cnt
                T = inv[I]
                ok = (T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])
                T = T[ok]
                # normales recalculées (pondérées par l'aire)
                fn = np.cross(P2[T[:, 1]] - P2[T[:, 0]], P2[T[:, 2]] - P2[T[:, 0]])
                N2 = np.zeros_like(P2)
                for k in range(3): np.add.at(N2, T[:, k], fn)
                N2 /= (np.linalg.norm(N2, axis=1, keepdims=True) + 1e-12)
                stats['tris_out'] += len(T)
                new_at = {'POSITION': add_acc(None, 34962, P2.astype(np.float32), 5126, 'VEC3'),
                          'NORMAL': add_acc(None, 34962, N2.astype(np.float32), 5126, 'VEC3'),
                          'TEXCOORD_0': add_acc(None, 34962, UV2.astype(np.float32), 5126, 'VEC2')}
                pr['attributes'] = new_at
                pr['indices'] = add_acc(None, 34963, T.astype(np.uint32).reshape(-1, 1), 5125, 'SCALAR')
            else:
                new_at = {}
                for k in keep_attr:
                    if k in at: new_at[k] = add_acc(at[k], 34962)
                pr['attributes'] = new_at
                if 'indices' in pr:
                    ia = j['accessors'][pr['indices']]; stats['tris_out'] += ia['count'] // 3; stats['tris_in'] += ia['count'] // 3
                    pr['indices'] = add_acc(pr['indices'], 34963)
    for s in j.get('skins', []):
        s['inverseBindMatrices'] = add_acc(s['inverseBindMatrices'], None)

    # ---- images dans le blob
    img_json = []
    for data, mime in new_images:
        bi = add_view(data); img_json.append({'bufferView': bi, 'mimeType': mime})

    j['accessors'] = acc_new; j['bufferViews'] = bvs; j['images'] = img_json
    j['textures'] = new_textures
    if not img_json: j.pop('images'); j.pop('textures')
    j.pop('samplers', None) if not new_textures else None
    j['buffers'] = [{'byteLength': len(blob)}]

    # ---- normalisation : hauteur 1.8, pieds à 0, centré
    tmp_bin = bytes(blob)
    V = rest_world_vertices(j, tmp_bin)
    mn, mx = V.min(0), V.max(0); h = mx[1] - mn[1]; s = 1.8 / h
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    # cx/cz : centre des pieds (plus fiable que l'écartement des bras)
    feet = V[V[:, 1] < mn[1] + 0.05 * h]
    cx, cz = feet[:, 0].mean(), feet[:, 2].mean()
    scene = j['scenes'][j.get('scene', 0)]
    root = {'name': 'SkinRoot', 'translation': [float(-cx * s), float(-mn[1] * s), float(-cz * s)], 'scale': [float(s)] * 3, 'children': list(scene['nodes'])}
    j['nodes'].append(root); scene['nodes'] = [len(j['nodes']) - 1]

    # ---- écriture
    jb = json.dumps(j, separators=(',', ':')).encode()
    while len(jb) % 4: jb += b' '
    bb = bytes(blob)
    while len(bb) % 4: bb += b'\0'
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bb)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(bb), 0x004E4942) + bb
    open(dst, 'wb').write(out)
    return {'size_mb': len(out) / 1e6, 'height_raw_world': float(h), 'scale': float(s), 'tris': stats, 'images': len(img_json), 'textures_mb': sum(len(d) for d, _ in new_images) / 1e6}

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description="Optimise un skin .glb pour PixelRift (textures 1024 px, maillage nettoyé, hauteur 1,80 m, pieds au sol).")
    ap.add_argument('entree'); ap.add_argument('sortie')
    ap.add_argument('--decimate', nargs=2, type=float, metavar=('CELLULE_M', 'CELLULE_UV'), help="réduit les modèles non riggés très lourds (scans), ex. --decimate 0.014 0.025")
    a = ap.parse_args()
    r = optimize(a.entree, a.sortie, decimate=tuple(a.decimate) if a.decimate else None)
    print(f"OK : {r['size_mb']:.2f} Mo, {r['tris']['tris_out']} triangles, {r['images']} textures")
    print("Importe ensuite ce fichier dans Quartier général > Administration > Importer (coche « déjà à l'échelle »).")
