# 从 AIGC 生成的图标原图制作安卓全套图标资源：
# - 中心裁切去掉角落水印
# - 传统 mipmap 各密度 ic_launcher / ic_launcher_round
# - 自适应图标前景（透明底、安全区内缩放）与背景色
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'visual', 'icon.png')
RES = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
BG = (0, 0, 0, 255)

img = Image.open(SRC).convert('RGBA')
w, h = img.size
# 中心 84% 裁切：去掉右下角平台水印，保留风筝主体与安全边距
crop = min(w, h) if '--no-crop' in sys.argv else int(min(w, h) * 0.84)
left = (w - crop) // 2
top = (h - crop) // 2
center = img.crop((left, top, left + crop, top + crop))

os.makedirs(RES, exist_ok=True)
for density, size in DENSITIES.items():
    folder = os.path.join(RES, f'mipmap-{density}')
    os.makedirs(folder, exist_ok=True)
    icon = center.resize((size, size), Image.LANCZOS)
    icon.save(os.path.join(folder, 'ic_launcher.png'))
    # 圆形图标
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    round_icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    round_icon.paste(icon, (0, 0), mask)
    round_icon.save(os.path.join(folder, 'ic_launcher_round.png'))

for density, size in FOREGROUND.items():
    folder = os.path.join(RES, f'mipmap-{density}')
    os.makedirs(folder, exist_ok=True)
    fg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = int(size * 0.66)
    art = center.resize((inner, inner), Image.LANCZOS)
    offset = (size - inner) // 2
    fg.paste(art, (offset, offset), art)
    fg.save(os.path.join(folder, 'ic_launcher_foreground.png'))

values = os.path.join(RES, 'values')
os.makedirs(values, exist_ok=True)
with open(os.path.join(values, 'ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#000000</color>\n</resources>\n')

mipmap_any = os.path.join(RES, 'mipmap-anydpi-v26')
os.makedirs(mipmap_any, exist_ok=True)
adaptive = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''
for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    with open(os.path.join(mipmap_any, name), 'w', encoding='utf-8') as f:
        f.write(adaptive)

# 启动屏 logo（复用中心裁切图）
drawable = os.path.join(RES, 'drawable')
os.makedirs(drawable, exist_ok=True)
center.resize((512, 512), Image.LANCZOS).save(os.path.join(drawable, 'splash_logo.png'))
print('ICONS_OK', RES)