// test_pico.mjs — pico.js가 실제 얼굴을 감지하고 노이즈는 기각하는지 검증
import fs from 'fs';

const src = fs.readFileSync('lib/pico.js', 'utf8');
const pico = new Function(src + '; return pico;')();

const cascadeBytes = new Int8Array(fs.readFileSync('models/facefinder'));
const classify = pico.unpack_cascade(cascadeBytes);

function detect(grayPath, w, h) {
  const pixels = new Uint8Array(fs.readFileSync(grayPath));
  const image = { pixels, nrows: h, ncols: w, ldim: w };
  const params = { shiftfactor: 0.1, minsize: 40, maxsize: 512, scalefactor: 1.1 };
  let dets = pico.run_cascade(image, classify, params);
  dets = pico.cluster_detections(dets, 0.2);
  return dets.filter(d => d[3] > 5.0); // q > 5.0 = 신뢰 임계
}

const faces = detect('test_face.gray', 512, 512);
const noise = detect('test_noise.gray', 512, 512);

console.log('실제 인물 사진 감지 수:', faces.length,
  faces.map(d => `(r=${d[0]|0}, c=${d[1]|0}, size=${d[2]|0}, q=${d[3].toFixed(1)})`).join(' '));
console.log('노이즈 이미지 감지 수:', noise.length);

if (faces.length >= 1 && noise.length === 0) {
  console.log('PASS: 얼굴 감지 정상 / 오탐 없음');
} else {
  console.log('FAIL');
  process.exit(1);
}
