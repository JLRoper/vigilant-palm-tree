import os
import random
from collections import Counter
from PIL import Image


def sample_corner_pixels(pixels, width, height, corner_size=12):
    """
    Sample corner_size pixels from each of the four corners.
    Returns a flat list of (r, g, b, a) tuples.
    """
    samples = []

    # Each corner: sample a grid of pixels within a small region
    # Use int(w**0.5) as the grid dimension
    grid_dim = int(corner_size ** 0.5)  # 3x4-ish or 4x3

    corners = [
        (0, 0),                       # top-left
        (width - grid_dim, 0),         # top-right
        (0, height - grid_dim),        # bottom-left
        (width - grid_dim, height - grid_dim),  # bottom-right
    ]

    for cx, cy in corners:
        for dx in range(grid_dim):
            for dy in range(grid_dim):
                sx = min(cx + dx, width - 1)
                sy = min(cy + dy, height - 1)
                samples.append(pixels[sx, sy])

    return samples


def detect_background_color(input_path):
    """
    Sample 12 pixels in each corner (48 total), find the mode color.
    Returns (r, g, b, a) of the most common corner pixel.
    """
    with Image.open(input_path) as img:
        rgba_img = img.convert("RGBA")
        pixels = rgba_img.load()
        width, height = rgba_img.size

        # Skip tiny images
        if width < 4 or height < 4:
            return None

        corner_pixels = sample_corner_pixels(pixels, width, height, corner_size=12)
        counter = Counter(corner_pixels)
        mode_color = counter.most_common(1)[0][0]
        return mode_color


def color_within_tolerance(pixel, target, tolerance):
    return (
        abs(pixel[0] - target[0]) <= tolerance
        and abs(pixel[1] - target[1]) <= tolerance
        and abs(pixel[2] - target[2]) <= tolerance
    )


def is_near_white(pixel, tolerance_percent=5):
    threshold = int(255 * (1 - tolerance_percent / 100))
    return pixel[0] >= threshold and pixel[1] >= threshold and pixel[2] >= threshold


def get_neighbors(x, y, width, height):
    neighbors = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                neighbors.append((nx, ny))
    return neighbors


def strip_fringe(pixels, width, height, target_rgba, sample_size=500,
                 fringe_threshold_pct=3, white_tolerance_pct=5):
    """
    Detect white outline fringe pixels and remove them if:
    - the original background was near-white (auto-strip), OR
    - >= fringe_threshold_pct of sampled fringe pixels are near-white.
    """
    # Collect all fringe pixels
    fringe_positions = []
    for x in range(width):
        for y in range(height):
            if pixels[x, y][3] == 0:
                continue
            for nx, ny in get_neighbors(x, y, width, height):
                if pixels[nx, ny][3] == 0:
                    fringe_positions.append((x, y))
                    break

    if not fringe_positions:
        return 0

    # Sample the fringe pixels
    sample = fringe_positions
    if len(fringe_positions) > sample_size:
        sample = random.sample(fringe_positions, sample_size)

    near_white_count = sum(
        1 for x, y in sample if is_near_white(pixels[x, y], white_tolerance_pct)
    )
    near_white_pct = near_white_count * 100 / len(sample)

    bg_is_white = is_near_white(target_rgba)

    print(f"  Fringe: {len(fringe_positions)} pixels, {near_white_pct:.1f}% near-white, bg_white={bg_is_white}")

    should_strip = bg_is_white or (near_white_pct >= fringe_threshold_pct)

    if should_strip:
        for x, y in fringe_positions:
            pixels[x, y] = (0, 0, 0, 0)
        reason = "auto (white bg)" if bg_is_white else f">= {fringe_threshold_pct}% threshold"
        print(f"  -> Stripped {len(fringe_positions)} fringe pixels ({reason})")
        return len(fringe_positions)

    print(f"  -> Skipped")
    return 0


def remove_background(input_path, output_path, target_rgba, tolerance_percent=2):
    """
    Remove pixels whose RGB channels are all within tolerance_percent % of target_rgba.
    Then strip any white outline fringe.
    """
    tolerance = int(255 * tolerance_percent / 100)

    with Image.open(input_path) as img:
        rgba_img = img.convert("RGBA")
        pixels = rgba_img.load()
        width, height = rgba_img.size

        for x in range(width):
            for y in range(height):
                current = pixels[x, y]
                if color_within_tolerance(current, target_rgba, tolerance):
                    pixels[x, y] = (0, 0, 0, 0)

        print(f"  Removed background {target_rgba[:3]} (+/-{tolerance_percent}%) -> {os.path.basename(input_path)}")

        strip_fringe(pixels, width, height, target_rgba)

        rgba_img.save(output_path, "PNG")


def fringe_only_pass(input_path, output_path):
    """
    Run only the fringe stripping pass on an already-transparent image.
    Uses (255, 255, 255) as the assumed former background for auto-detect.
    """
    with Image.open(input_path) as img:
        rgba_img = img.convert("RGBA")
        pixels = rgba_img.load()
        width, height = rgba_img.size

        # Treat as if the original background was white (most common case)
        white_rgba = (255, 255, 255, 255)
        stripped = strip_fringe(pixels, width, height, white_rgba)

        if stripped > 0:
            rgba_img.save(output_path, "PNG")
            return True

    return False


def process_single_file(input_path, output_path):
    """
    Process a single image file: detect background, remove it, strip fringe.
    Works on opaque-background images and already-transparent images alike.
    """
    filename = os.path.basename(input_path)
    bg = detect_background_color(input_path)

    if bg is None:
        print(f"  [error] {filename}: too small to process")
        return

    if bg[3] == 0:
        print(f"  [already transparent, checking fringe] -> {filename}")
        fringe_only_pass(input_path, output_path)
    else:
        remove_background(input_path, output_path, bg)


def process_folder(folder_path, output_folder=None):
    """
    Process all PNGs in folder_path.
    If output_folder is given, outputs there directly.
    Otherwise outputs to 'transparent_output' subfolder.
    """
    if output_folder is None:
        output_folder = os.path.join(folder_path, "transparent_output")
    os.makedirs(output_folder, exist_ok=True)

    valid_extensions = (".png", ".jpg", ".jpeg", ".bmp")
    skipped = []
    processed = []

    for filename in sorted(os.listdir(folder_path)):
        if not filename.lower().endswith(valid_extensions):
            continue

        input_path = os.path.join(folder_path, filename)
        output_name = os.path.splitext(filename)[0] + "_transparent.png"
        output_path = os.path.join(output_folder, output_name)

        bg = detect_background_color(input_path)
        if bg is None:
            skipped.append(f"{filename} (too small)")
            continue

        if bg[3] == 0:
            print(f"  [already transparent, checking fringe] -> {filename}")
            if fringe_only_pass(input_path, output_path):
                processed.append(f"{filename} (fringe stripped)")
            else:
                skipped.append(f"{filename} (already transparent)")
            continue

        remove_background(input_path, output_path, bg)
        processed.append(filename)

    print(f"\n--- Summary ---")
    print(f"Processed: {len(processed)}")
    print(f"Skipped:   {len(skipped)}")
    if skipped:
        print(f"\nSkipped files:")
        for s in skipped:
            print(f"  - {s}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  Single file:  python scripts/remove_background.py <input.png> [output.png]")
        print("  Directory:    python scripts/remove_background.py <input_dir/> [output_dir/]")
        sys.exit(1)

    target = sys.argv[1]

    if os.path.isfile(target):
        # Single file mode
        input_path = target
        if len(sys.argv) >= 3:
            output_path = sys.argv[2]
        else:
            base, ext = os.path.splitext(input_path)
            output_path = f"{base}_transparent{ext}"

        print(f"Processing single file: {os.path.basename(input_path)}")
        process_single_file(input_path, output_path)
        print(f"Output: {output_path}")

    elif os.path.isdir(target):
        # Directory mode
        folder_path = target
        output_folder = sys.argv[2] if len(sys.argv) >= 3 else None

        print(f"Target folder: {folder_path}")
        print("Detecting background colors from 12 corner pixels per corner (48 total)...\n")
        process_folder(folder_path, output_folder)

    else:
        print(f"Error: '{target}' is not a valid file or directory")
        sys.exit(1)
