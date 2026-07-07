"""테스트 이미지 일괄 생성 (pip install scikit-image 필요)

생성물:
  test_face.gray / test_noise.gray      — 512x512, test_pico.mjs 용
  e2e_full.gray / e2e_240.gray          — 두 얼굴 합성, test_e2e.mjs 용
  sim_solo0..7.gray / sim_two0..7.gray  — 320x240 열화 웹캠 시퀀스, test_webcam_sim.mjs 용

실행: python3 gen_test_images.py && node test_pico.mjs && node test_e2e.mjs && node test_webcam_sim.mjs
"""
from skimage import data
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

astro = Image.fromarray(data.astronaut())
face = astro.crop((150, 40, 310, 200))  # 160x160 얼굴 크롭


def gray(img):
    a = np.asarray(img.convert('RGB'))
    return (0.299*a[:, :, 0] + 0.587*a[:, :, 1] + 0.114*a[:, :, 2]).astype(np.uint8)


# 1) 단일 얼굴 / 노이즈 (512x512)
gray(astro).tofile('test_face.gray')
np.random.default_rng(42).integers(0, 256, (512, 512), dtype=np.uint8).tofile('test_noise.gray')

# 2) 두 얼굴 합성 (E2E) — 원본 512x384 + 분석 해상도 240x180
canvas = Image.new('RGB', (512, 384), (18, 26, 32))
canvas.paste(face.resize((190, 190)), (60, 120))   # 사용자
canvas.paste(face.resize((95, 95)), (360, 60))     # 제3자
g = gray(canvas)
g.tofile('e2e_full.gray')
np.asarray(Image.fromarray(g).resize((240, 180))).astype(np.uint8).tofile('e2e_240.gray')

# 3) 열화 웹캠 시퀀스 (320x240, 현실적 기하)
def degrade_seq(pil_img, prefix, n, rng):
    im = pil_img.convert('L')
    im = ImageEnhance.Brightness(im).enhance(0.5).filter(ImageFilter.GaussianBlur(1.0))
    base = np.asarray(im).astype(np.int16)
    for i in range(n):
        np.clip(base + rng.normal(0, 12, base.shape), 0, 255).astype(np.uint8).tofile(f'{prefix}{i}.gray')

rng = np.random.default_rng(11)
solo = Image.new('RGB', (320, 240), (18, 26, 32))
solo.paste(face.resize((140, 140)), (95, 60))            # 노트북 앞 사용자
degrade_seq(solo, 'sim_solo', 8, rng)

two = Image.new('RGB', (320, 240), (18, 26, 32))
two.paste(face.resize((140, 140)), (60, 70))             # 사용자
two.paste(face.resize((55, 55)), (235, 40))              # 1.5m 뒤 위협
degrade_seq(two, 'sim_two', 8, rng)

print('all test images written')
