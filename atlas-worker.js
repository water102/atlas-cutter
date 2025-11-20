// atlas-worker.js
importScripts('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

// Parse atlas metadata
function manualParseAtlas(text, atlasName) {
  const lines = text.split(/\r?\n/);
  let regions = [];
  let cur = null;
  let imageFileName = null;
  let imageFileNameWithoutExt = null;
  let foundImageFile = false;

  const isImageFileName = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed || raw.startsWith(" ") || trimmed.includes(":")) {
      return false;
    }
    const imageExtRegex = /\.(png|jpg|jpeg)$/i;
    return imageExtRegex.test(trimmed);
  };

  const isSpriteName = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed || raw.startsWith(" ") || trimmed.includes(":")) {
      return false;
    }
    return !isImageFileName(trimmed);
  };

  const getBaseName = (filename) => {
    return filename.replace(/\.(png|jpg|jpeg)$/i, "");
  };

  lines.forEach((raw) => {
    const line = raw.trim();

    if (!foundImageFile && isImageFileName(raw)) {
      imageFileName = line;
      imageFileNameWithoutExt = getBaseName(line);
      foundImageFile = true;
      return;
    }

    if (isSpriteName(raw)) {
      if (imageFileName && (
        line === imageFileName || 
        line === imageFileNameWithoutExt
      )) {
        return;
      }

      cur && regions.push(cur);
      cur = {
        atlas: atlasName,
        name: line,
        rotate: false,
        xy: { x: 0, y: 0 },
        size: { w: 0, h: 0 }
      };
      return;
    }

    if (!cur) return;

    if (line.startsWith("rotate")) cur.rotate = line.includes("true");
    if (line.startsWith("xy:")) {
      const m = line.match(/xy:\s*(\d+),\s*(\d+)/);
      if (m) cur.xy = { x: +m[1], y: +m[2] };
    }
    if (line.startsWith("size:")) {
      const m = line.match(/size:\s*(\d+),\s*(\d+)/);
      if (m) cur.size = { w: +m[1], h: +m[2] };
    }
  });

  cur && regions.push(cur);
  return regions;
}

// Process atlas and extract sprites
async function processAtlas(atlasText, imageBitmap, atlasName) {
  const regions = manualParseAtlas(atlasText, atlasName);
  const sprites = [];

  for (const region of regions) {
    const { name, xy, size, rotate } = region;
    
    // Create OffscreenCanvas
    const canvas = new OffscreenCanvas(
      rotate ? size.h : size.w,
      rotate ? size.w : size.h
    );
    const ctx = canvas.getContext('2d');

    if (rotate) {
      // Unrotate: sprite in PNG is rotated 90° clockwise, so we rotate -90° (counter-clockwise) to restore
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(
        imageBitmap,
        xy.x, xy.y, size.w, size.h,
        -size.h / 2, -size.w / 2,
        size.h, size.w
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        imageBitmap,
        xy.x, xy.y, size.w, size.h,
        0, 0,
        size.w, size.h
      );
    }

    // Convert to blob
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await blob.arrayBuffer();

    sprites.push({
      name,
      atlas: atlasName,
      width: canvas.width,
      height: canvas.height,
      data: arrayBuffer
    });
  }

  return sprites;
}

// Create ZIP from sprites
async function createZip(sprites) {
  const zip = new JSZip();
  const folder = zip.folder("images");

  for (const sprite of sprites) {
    folder.file(`${sprite.name}.png`, sprite.data);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return blob;
}

// Message handler
self.onmessage = async function(e) {
  const { type, data, requestId } = e.data;

  try {
    if (type === 'processAtlas') {
      const { atlasText, imageBitmap, atlasName } = data;
      const sprites = await processAtlas(atlasText, imageBitmap, atlasName);
      self.postMessage({ type: 'atlasProcessed', sprites, atlasName, requestId });
    } else if (type === 'createZip') {
      const { sprites } = data;
      const zipBlob = await createZip(sprites);
      self.postMessage({ type: 'zipCreated', blob: zipBlob, requestId }, [zipBlob]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message, requestId });
  }
};

