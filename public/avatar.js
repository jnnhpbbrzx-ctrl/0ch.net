// Генерирует нарочито кривую "рожу" в виде SVG на основе имени.
// Никаких загрузок картинок — всё рисуется на лету, одинаково для одного и того же ника.

function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function generateAvatarSVG(seed, size = 48) {
  const rand = seededRandom(seed || 'default');

  const bgHue = Math.floor(rand() * 360);
  const bg = `hsl(${bgHue}, 55%, 60%)`;
  const faceColor = `hsl(${(bgHue + 40) % 360}, 60%, 75%)`;

  const eyeShapes = ['circle', 'rect', 'x'];
  const eyeShape = pick(rand, eyeShapes);
  const eyeCount = pick(rand, [2, 2, 2, 1, 3]); // почти всегда 2, иногда мутант
  const mouths = ['smile', 'flat', 'zigzag', 'open'];
  const mouth = pick(rand, mouths);
  const hasWart = rand() > 0.6;
  const hasHornsColor = `hsl(${Math.floor(rand() * 360)}, 70%, 40%)`;
  const hasHorns = rand() > 0.5;

  let eyes = '';
  const eyeY = 20;
  const spacing = 34 / (eyeCount + 1);
  for (let i = 0; i < eyeCount; i++) {
    const ex = 8 + spacing * (i + 1);
    if (eyeShape === 'circle') {
      eyes += `<circle cx="${ex}" cy="${eyeY}" r="3.2" fill="black"/>`;
    } else if (eyeShape === 'rect') {
      eyes += `<rect x="${ex - 3}" y="${eyeY - 3}" width="6" height="6" fill="black"/>`;
    } else {
      eyes += `<line x1="${ex-3}" y1="${eyeY-3}" x2="${ex+3}" y2="${eyeY+3}" stroke="black" stroke-width="2"/>
                <line x1="${ex-3}" y1="${eyeY+3}" x2="${ex+3}" y2="${eyeY-3}" stroke="black" stroke-width="2"/>`;
    }
  }

  let mouthSvg = '';
  if (mouth === 'smile') {
    mouthSvg = `<path d="M14 32 Q24 40 34 32" stroke="black" stroke-width="2.2" fill="none"/>`;
  } else if (mouth === 'flat') {
    mouthSvg = `<line x1="15" y1="34" x2="33" y2="34" stroke="black" stroke-width="2.2"/>`;
  } else if (mouth === 'zigzag') {
    mouthSvg = `<path d="M14 33 L19 37 L24 33 L29 37 L34 33" stroke="black" stroke-width="2" fill="none"/>`;
  } else {
    mouthSvg = `<ellipse cx="24" cy="34" rx="6" ry="4" fill="black"/>`;
  }

  const wart = hasWart
    ? `<circle cx="${pick(rand,[12,36])}" cy="26" r="2" fill="hsl(${Math.floor(rand()*360)},60%,40%)"/>`
    : '';

  const horns = hasHorns
    ? `<polygon points="6,6 12,-2 14,10" fill="${hasHornsColor}"/>
       <polygon points="42,6 36,-2 34,10" fill="${hasHornsColor}"/>`
    : '';

  return `
  <svg viewBox="-4 -6 56 56" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect x="-4" y="-6" width="56" height="56" fill="${bg}"/>
    ${horns}
    <circle cx="24" cy="24" r="19" fill="${faceColor}" stroke="black" stroke-width="1.5"/>
    ${eyes}
    ${mouthSvg}
    ${wart}
  </svg>`;
}
