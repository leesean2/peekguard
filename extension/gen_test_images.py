"""test_pico.mjs 용 테스트 이미지 생성 (scikit-image 필요: pip install scikit-image)"""
from skimage import data
import numpy as np
img = data.astronaut()
gray = (0.299*img[:,:,0] + 0.587*img[:,:,1] + 0.114*img[:,:,2]).astype(np.uint8)
gray.tofile('test_face.gray')
np.random.default_rng(42).integers(0,256,(512,512),dtype=np.uint8).tofile('test_noise.gray')
print('test images written (512x512 raw grayscale)')
