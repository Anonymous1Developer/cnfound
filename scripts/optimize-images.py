#!/usr/bin/env python3
"""
Batch-convert product images to optimized WebP.
Creates two sizes per image:
  - thumb/  → 400px wide (for grid cards on mobile/desktop)
  - mid/    → 800px wide (for detail view)
Originals stay untouched in Images/.
"""

import os
import sys
from PIL import Image, UnidentifiedImageError

SRC_DIR = "Images"
THUMB_DIR = "images-opt/thumb"
MID_DIR = "images-opt/mid"
THUMB_MAX = 400
MID_MAX = 800
WEBP_QUALITY = 80

os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(MID_DIR, exist_ok=True)

SUPPORTED = {'.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp'}

total = 0
converted = 0
skipped = 0
errors = 0
saved_bytes = 0

for fname in sorted(os.listdir(SRC_DIR)):
    ext = os.path.splitext(fname)[1].lower()
    if ext not in SUPPORTED:
        continue
    total += 1
    src_path = os.path.join(SRC_DIR, fname)
    base = os.path.splitext(fname)[0]
    thumb_path = os.path.join(THUMB_DIR, base + ".webp")
    mid_path = os.path.join(MID_DIR, base + ".webp")

    if os.path.exists(thumb_path) and os.path.exists(mid_path):
        skipped += 1
        continue

    try:
        img = Image.open(src_path)
        if img.mode == 'RGBA' or img.mode == 'PA':
            pass  # keep alpha channel for transparent PNGs
        else:
            img = img.convert("RGB")
        orig_size = os.path.getsize(src_path)

        for out_path, max_dim in [(thumb_path, THUMB_MAX), (mid_path, MID_MAX)]:
            resized = img.copy()
            resized.thumbnail((max_dim, max_dim), Image.LANCZOS)
            resized.save(out_path, "WEBP", quality=WEBP_QUALITY, method=4)

        new_size = os.path.getsize(thumb_path) + os.path.getsize(mid_path)
        saved_bytes += (orig_size - new_size)
        converted += 1

        if converted % 50 == 0:
            print(f"  ...converted {converted}/{total}")

    except (UnidentifiedImageError, Exception) as e:
        errors += 1
        print(f"  ERROR: {fname}: {e}")

print(f"\nDone: {converted} converted, {skipped} skipped, {errors} errors")
print(f"Saved ~{saved_bytes / 1024 / 1024:.1f} MB vs originals")

# Show new folder sizes
thumb_total = sum(os.path.getsize(os.path.join(THUMB_DIR, f)) for f in os.listdir(THUMB_DIR))
mid_total = sum(os.path.getsize(os.path.join(MID_DIR, f)) for f in os.listdir(MID_DIR))
print(f"Thumb folder: {thumb_total / 1024 / 1024:.1f} MB")
print(f"Mid folder: {mid_total / 1024 / 1024:.1f} MB")
print(f"Total optimized: {(thumb_total + mid_total) / 1024 / 1024:.1f} MB (was {saved_bytes / 1024 / 1024 + (thumb_total + mid_total) / 1024 / 1024:.1f} MB)")
